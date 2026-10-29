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
export async function getPets() {
  const { data, error } = await client()
    .from('pets')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as Pet[]
}
export async function getPet(id: string) {
  const { data, error } = await client().from('pets').select('*').eq('id', id).single()
  if (error) throw new Error(error.code === 'PGRST116' ? 'PET_NOT_FOUND' : error.message)
  return data as Pet
}
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
export async function removePet(id: string) {
  const { error, data } = await client().from('pets').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('PET_NOT_FOUND')
  await cleanup()
}
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
export async function removeRecord(id: string) {
  const { data, error } = await client().from('records').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('记录不存在或无权删除。')
  await cleanup()
}
export async function getProfile() {
  const { data, error } = await client().from('users').select('*').eq('id', userId()).single()
  if (error) throw error
  return data as Profile
}
export async function saveProfile(value: { nickname: string; bio: string }) {
  const { error } = await client()
    .from('users')
    .update(profileSchema.parse(value))
    .eq('id', userId())
  if (error) throw error
}
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024
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
async function upload(file: File, prefix: string) {
  const ext = await validateImage(file)
  const path = `${userId()}/${prefix}/${crypto.randomUUID()}.${ext}`
  const { error } = await client()
    .storage.from('pet-media')
    .upload(path, file, { upsert: false, contentType: file.type })
  if (error) throw error
  return path
}
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
export async function signedImage(
  path: string,
  bucket: 'pet-media' | 'community-media' = 'pet-media',
) {
  const { data, error } = await client().storage.from(bucket).createSignedUrl(path, 300)
  if (error) throw error
  return data.signedUrl
}
export async function cleanup() {
  // Durable database queue survives tab closure; cleanup failure does not undo a saved action.
  try {
    await client().functions.invoke('storage-cleanup', { body: {} })
  } catch {
    /* queued for later retry */
  }
}
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
