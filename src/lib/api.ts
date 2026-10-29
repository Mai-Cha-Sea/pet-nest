/**
 * P0 数据访问边界：宠物、记录、个人资料、私有图片和 AI 调用。
 * 页面只处理交互；数据库 RLS/约束和 Edge 鉴权负责最终归属与额度检查。
 * 写入重试保留创建 UUID；图片关联结果不确定时先查引用，避免误删已保存文件。
 */
import { client } from './supabase'
import { userId, session } from '../stores/auth'
import { petSchema, profileSchema, validateRecord } from '../../shared/domain'
import type {
  Pet,
  PetInput,
  PetRecord,
  Profile,
  RecordType,
  Conversation,
} from '../../shared/domain'
/**
 * 读取 RLS 可见的本人宠物，按创建时间倒序返回。
 */
export async function getPets() {
  const { data, error } = await client()
    .from('pets')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as Pet[]
}
/**
 * 按 UUID 读取单只可访问宠物；不存在与无权访问统一为 PET_NOT_FOUND。
 */
export async function getPet(id: string) {
  const { data, error } = await client().from('pets').select('*').eq('id', id).single()
  if (error) throw new Error(error.code === 'PGRST116' ? 'PET_NOT_FOUND' : error.message)
  return data as Pet
}
/**
 * 校验并新增/更新宠物，返回数据库保存的档案。
 * createId 必须在同一次创建及其重试中保持不变；同 ID 且内容一致时读取已有结果，
 * 内容冲突则报错，避免丢失响应后再建一只。10 只上限由数据库并发锁强制执行。
 */
export async function savePet(input: PetInput, id?: string, createId = crypto.randomUUID()) {
  const parsed = petSchema.parse(input)
  const payload = { ...parsed, birth_date: parsed.birth_date || null }
  const query = id
    ? client().from('pets').update(payload).eq('id', id)
    : client()
        .from('pets')
        .insert({ ...payload, id: createId, user_id: userId() })
  const { data, error } = await query.select().single()
  if (!id && error?.code === '23505') {
    const existing = await getPet(createId)
    if (Object.entries(payload).every(([key, value]) => existing[key as keyof Pet] === value))
      return existing
    throw new Error(
      '上一次提交可能已保存，内容与本次不同。请返回宠物列表核对后编辑，避免重复创建。',
    )
  }
  if (error) throw error
  return data as Pet
}
/**
 * 删除本人宠物并尽力触发图片队列清理；关联记录/会话由数据库级联删除。
 * 调用页面须先确认；零行删除视为不存在/无权访问，不显示虚假成功。
 */
export async function removePet(id: string) {
  const { error, data } = await client().from('pets').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('PET_NOT_FOUND')
  await cleanup()
}
/**
 * 读取单只宠物的记录，可按类型筛选；from 为零起点偏移，每页 50 条。
 * 发生时间与 ID 均倒序，确保相同时间的记录排序稳定。
 */
export async function getRecords(petId: string, type?: RecordType, from = 0) {
  let q = client()
    .from('records')
    .select('*')
    .eq('pet_id', petId)
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, from + 49)
  if (type) q = q.eq('type', type)
  const { data, error } = await q
  if (error) throw error
  return data as PetRecord[]
}
/**
 * 读取近 days 天的体重记录，每页 500、最多 2000 条；达到上限返回 limited。
 * 首行时间作为后续页上界，降低新增数据导致的翻页漂移；这不是事务级快照。
 */
export async function getWeightRecords(petId: string, days: number) {
  const since = new Date(Date.now() - days * 86400000).toISOString()
  const records: PetRecord[] = []
  let anchor: string | undefined
  for (let from = 0; from < 2000; from += 500) {
    let query = client()
      .from('records')
      .select('*')
      .eq('pet_id', petId)
      .eq('type', 'weight')
      .gte('occurred_at', since)
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
    if (anchor) query = query.lte('occurred_at', anchor)
    const { data, error } = await query.range(from, from + 499)
    if (error) throw error
    if (!anchor && data.length) anchor = data[0].occurred_at
    records.push(...(data as PetRecord[]))
    if (data.length < 500) return { records, limited: false }
  }
  return { records, limited: true }
}
/**
 * 新增一条经过校验且关联本人宠物的记录，返回保存后的行。
 * 重试复用 createId；遇主键冲突先核对原内容，禁止同 ID 悄悄覆盖另一条记录。
 */
export async function addRecord(
  petId: string,
  type: RecordType,
  content: Record<string, unknown>,
  occurredAt: string,
  createId = crypto.randomUUID(),
) {
  validateRecord(type, content, occurredAt)
  const { data, error } = await client()
    .from('records')
    .insert({
      id: createId,
      user_id: userId(),
      pet_id: petId,
      type,
      content,
      occurred_at: occurredAt,
    })
    .select()
    .single()
  if (error?.code === '23505') {
    const { data: existing, error: readError } = await client()
      .from('records')
      .select('*')
      .eq('id', createId)
      .single()
    if (readError) throw readError
    if (
      existing.pet_id === petId &&
      existing.type === type &&
      Date.parse(existing.occurred_at) === Date.parse(occurredAt) &&
      Object.keys(existing.content).length === Object.keys(content).length &&
      Object.entries(content).every(([k, v]) => existing.content[k] === v)
    )
      return existing as PetRecord
    throw new Error('上一次提交可能已保存，请返回宠物档案核对记录，避免重复创建。')
  }
  if (error) throw error
  return data as PetRecord
}
/**
 * 删除可访问记录并触发图片清理；RLS 过滤后的零行删除视为失败。
 */
export async function removeRecord(id: string) {
  const { data, error } = await client().from('records').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('记录不存在或无权删除。')
  await cleanup()
}
/**
 * 读取当前身份的私人资料；不读取社区公开昵称。
 */
export async function getProfile() {
  const { data, error } = await client().from('users').select('*').eq('id', userId()).single()
  if (error) throw error
  return data as Profile
}
/**
 * 只更新 schema 允许的昵称与简介；头像和注册声明不通过此方法修改。
 */
export async function saveProfile(value: { nickname: string; bio: string }) {
  const { error } = await client()
    .from('users')
    .update(profileSchema.parse(value))
    .eq('id', userId())
  if (error) throw error
}
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024
/**
 * 检查 MIME、非空/5 MiB 大小及 JPG/PNG/WebP 文件头，返回对象文件扩展名。
 * 只做文件格式检查，不识别图片画面或恶意语义；Storage 仍需独立限制类型和大小。
 */
export async function validateImage(file: File) {
  const extensions: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  }
  if (!extensions[file.type]) throw new Error('仅支持 JPG、PNG、WebP 图片。')
  if (file.size > MAX_IMAGE_SIZE || !file.size) throw new Error('每张图片需大于 0 且不超过 5 MB。')
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const valid =
    file.type === 'image/jpeg'
      ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : file.type === 'image/png'
        ? [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)
        : String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
          String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  if (!valid) throw new Error('文件内容与图片类型不符。')
  return extensions[file.type]
}
/**
 * 上传到当前用户的私有 pet-media 目录，返回对象路径；不在此关联数据库行。
 */
async function upload(file: File, prefix: string) {
  const ext = await validateImage(file)
  const path = `${userId()}/${prefix}/${crypto.randomUUID()}.${ext}`
  const { error } = await client()
    .storage.from('pet-media')
    .upload(path, file, { upsert: false, contentType: file.type })
  if (error) throw error
  return path
}
/**
 * 上传关联请求失败后的核对步骤：只删除已确认没有数据库引用的对象。
 * 返回所有路径是否均已关联；再次查询失败时返回 false 并保留对象供后续核查。
 */
async function reconcileUpload(paths: string[], table: 'pets' | 'users' | 'records', id: string) {
  // An HTTP failure may arrive AFTER a committed DB update. Read before deleting
  // uploaded objects, so a lost response cannot delete an already-linked image.
  const field = table === 'records' ? 'image_paths' : 'avatar_path'
  const { data, error } = await client().from(table).select(field).eq('id', id).maybeSingle()
  if (error) return false // Uncertain: retain files for later inspection rather than risk data loss.
  const row = data as unknown as { image_paths?: string[]; avatar_path?: string | null } | null
  const referenced = table === 'records' ? row?.image_paths || [] : [row?.avatar_path]
  const unused = paths.filter((path) => !referenced.includes(path))
  if (unused.length) await client().storage.from('pet-media').remove(unused)
  return paths.every((path) => referenced.includes(path))
}
/**
 * 先上传，再更新宠物/个人头像关联，返回已确认的路径。
 * 关联响应丢失时回查；清理旧头像交给数据库队列，不能直接按前端旧值删除。
 */
export async function uploadAvatar(file: File, petId?: string) {
  const path = await upload(file, petId ? `pets/${petId}/avatar` : 'profile')
  const q = petId
    ? client().from('pets').update({ avatar_path: path }).eq('id', petId)
    : client().from('users').update({ avatar_path: path }).eq('id', userId())
  const { error, data } = await q.select('id')
  if (error || !data?.length) {
    const saved = await reconcileUpload([path], petId ? 'pets' : 'users', petId || userId())
    if (!saved) throw error || new Error('头像关联未确认，请刷新资料后检查。')
  }
  await cleanup()
  return path
}
/**
 * 为异常记录逐个上传并关联图片；发生部分失败时核对已上传路径的引用。
 * 文字记录已由调用者保存，此函数失败不撤销文字记录，页面需保留原记录用于重试。
 */
export async function attachRecordImages(record: PetRecord, files: File[]) {
  validateRecord(record.type, record.content, record.occurred_at, files.length)
  for (const file of files) await validateImage(file)
  const paths: string[] = []
  try {
    for (const file of files)
      paths.push(await upload(file, `pets/${record.pet_id}/records/${record.id}`))
    const { data, error } = await client()
      .from('records')
      .update({ image_paths: paths })
      .eq('id', record.id)
      .select('id')
    if (error || !data?.length) throw error || new Error('图片关联失败。')
  } catch (e) {
    if (paths.length && (await reconcileUpload(paths, 'records', record.id))) return
    throw e
  }
}
/**
 * 为指定 bucket 的对象申请 300 秒签名 URL；URL 不写回数据库。
 * 拿到 URL 的人可在有效期查看，调用方不能将其当作永久公开图片地址。
 */
export async function signedImage(
  path: string,
  bucket: 'pet-media' | 'community-media' = 'pet-media',
) {
  const { data, error } = await client().storage.from(bucket).createSignedUrl(path, 300)
  if (error) throw error
  return data.signedUrl
}
/**
 * 尽力触发本人两个存储 bucket 的持久队列处理，不让清理失败撤销已完成业务。
 * 此方法不保证队列已经清空，未确认结果由后续登录/操作重试。
 */
export async function cleanup() {
  // Durable database queue survives tab closure; cleanup failure does not undo a saved action.
  try {
    await client().functions.invoke('storage-cleanup', { body: {} })
  } catch {
    /* queued for later retry */
  }
}
/**
 * 分页读取此宠物近 30 天的消息和请求状态；消息升序、请求状态保持倒序。
 * 每页 500 条，首行作为时间上界；不能依赖 SDK 默认行数限制，否则较多历史会截断。
 */
export async function history(petId: string) {
  const since = new Date(Date.now() - 30 * 86400000).toISOString()
  async function pages<T extends { created_at: string }>(
    table: string,
    columns: string,
  ): Promise<T[]> {
    const all: T[] = []
    let until: string | undefined
    for (let from = 0; ; from += 500) {
      let query = client()
        .from(table)
        .select(columns)
        .eq('pet_id', petId)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
      // Anchor later pages to the database's newest row, not the browser clock.
      // A slightly slow local clock must not hide an answer just saved by the server.
      if (until) query = query.lte('created_at', until)
      const { data, error } = await query.range(from, from + 499)
      if (error) throw error
      const rows = data as unknown as T[]
      if (from === 0 && rows.length) until = rows[0]!.created_at
      all.push(...rows)
      if (data.length < 500) return all
    }
  }
  type RequestRow = {
    id: string
    session_id: string
    status: string
    error_code: string | null
    created_at: string
    question: string
  }
  const [messages, requests] = await Promise.all([
    pages<Conversation>('ai_conversations', '*'),
    pages<RequestRow>('ai_requests', 'id,session_id,status,error_code,created_at,question'),
  ])
  return {
    messages: messages.reverse(),
    requests,
  }
}
/**
 * 读取北京时间当天的本人用量供 UI 展示；实际受理和并发 20 次上限由服务器决定。
 */
export async function usage() {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
  const { data, error } = await client()
    .from('ai_daily_usage')
    .select('used')
    .eq('usage_date', day)
    .maybeSingle()
  if (error) throw error
  return data?.used ?? 0
}
/**
 * 刷新 SDK 会话后调用本项目 ai-chat，返回已保存的回答和请求标识。
 * body 中 request_id 是幂等键，重试必须复用；错误转换为业务码供统一提示处理。
 * 前端不传模型密钥、owner 或上下文，后端自行查询已验证用户的数据。
 */
export async function askAI(body: {
  pet_id: string
  session_id: string
  request_id: string
  question: string
}) {
  const { data: auth, error: authError } = await client().auth.refreshSession()
  if (authError || !auth.session) throw new Error('UNAUTHORIZED')
  session.value = auth.session
  const { data, error } = await client().functions.invoke('ai-chat', { body })
  if (error) {
    if (error.context instanceof Response) {
      const result = await error.context.json().catch(() => null)
      throw new Error(result?.error?.code || 'UPSTREAM_UNAVAILABLE')
    }
    throw error
  }
  return data as { answer: string; request_id: string; used?: number }
}
