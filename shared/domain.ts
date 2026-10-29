/**
 * 前端与 AI Edge 共用的 P0 类型及字段校验。
 * 体重单位 kg，喂食量单位 g/ml；用药字段仅记录用户输入。
 * 这里的校验用于请求边界，数据库仍独立执行约束，不能只靠界面验证。
 */
import { z } from 'zod'

export const recordTypes = [
  'feeding',
  'weight',
  'deworming',
  'bath',
  'medication',
  'incident',
] as const
export type RecordType = (typeof recordTypes)[number]
export const recordLabels: Record<RecordType, string> = {
  feeding: '喂食',
  weight: '体重',
  deworming: '驱虫',
  bath: '洗澡',
  medication: '用药',
  incident: '异常',
}
const text = (n: number) => z.string().trim().max(n)
const positive = z.number().finite().positive().max(1000)
export const petSchema = z.object({
  name: text(32).min(1, '请填写宠物名称'),
  species: z.enum(['cat', 'dog', 'other']),
  breed: text(64),
  gender: z.enum(['unknown', 'male', 'female']),
  date_kind: z.enum(['birth', 'adoption']),
  birth_date: z.string().refine((v) => !v || validDate(v), '日期应为有效的过去日期'),
  weight: positive.nullable(),
  sterilized: z.boolean(),
  remark: text(1000),
})
export const profileSchema = z.object({ nickname: text(64).min(1, '请填写昵称'), bio: text(128) })
/**
 * 校验 YYYY-MM-DD 日历日期、排除不存在的日期，并以北京时间判断是否晚于今天。
 */
export function validDate(v: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    !Number.isNaN(Date.parse(v)) &&
    new Date(v).toISOString().slice(0, 10) === v &&
    v <= new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
  )
}
export const contentSchemas = {
  feeding: z.object({
    food: text(100).min(1),
    amount: z.number().positive().max(100000),
    unit: z.enum(['g', 'ml']),
  }),
  weight: z.object({ weight: positive }),
  deworming: z.object({ kind: z.enum(['internal', 'external', 'both']), note: text(500) }),
  bath: z.object({ note: text(500) }),
  medication: z.object({ name: text(100).min(1), dosage: text(100).min(1), note: text(500) }),
  incident: z.object({ description: text(2000).min(1) }),
}
/**
 * 按六类记录 schema 校验内容、发生时间与图片数量；失败直接抛错。
 * 时间最多容忍 60 秒时钟偏差；只有异常记录可关联图片，最多 9 张。
 * 函数不返回清洗后的副本，持久化格式还受数据库约束。
 */
export function validateRecord(
  type: RecordType,
  content: unknown,
  occurredAt: string,
  imageCount = 0,
) {
  contentSchemas[type].parse(content)
  if (!Number.isFinite(Date.parse(occurredAt)) || Date.parse(occurredAt) > Date.now() + 60000)
    throw new Error('记录时间无效或晚于现在')
  if (imageCount > 9 || imageCount < 0 || (type !== 'incident' && imageCount > 0))
    throw new Error('仅异常记录可上传图片，最多 9 张')
}
/**
 * 严格限制 AI 请求字段，不接受浏览器额外传入 owner 或模型配置。
 */
export const aiRequestSchema = z
  .object({
    pet_id: z.uuid(),
    session_id: z.uuid(),
    request_id: z.uuid(),
    question: text(2000).min(1),
  })
  .strict()
export type PetInput = z.infer<typeof petSchema>
export interface Pet extends Omit<PetInput, 'birth_date'> {
  id: string
  user_id: string
  birth_date: string | null
  avatar_path: string | null
  created_at: string
  updated_at: string
}
export interface PetRecord {
  id: string
  pet_id: string
  user_id: string
  type: RecordType
  content: Record<string, unknown>
  image_paths: string[]
  occurred_at: string
  created_at: string
}
export interface Profile {
  id: string
  nickname: string
  bio: string
  avatar_path: string | null
}
export interface Conversation {
  id: string
  request_id: string
  session_id: string
  pet_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}
/**
 * 将已校验的记录内容转为时间轴摘要；不解释症状或生成用药建议。
 */
export function recordSummary(record: Pick<PetRecord, 'type' | 'content'>) {
  const c = record.content
  switch (record.type) {
    case 'feeding':
      return `${c.food} · ${c.amount} ${c.unit}`
    case 'weight':
      return `${c.weight} kg`
    case 'deworming':
      return `${({ internal: '体内驱虫', external: '体外驱虫', both: '内外驱虫' } as Record<string, string>)[String(c.kind)]} ${c.note || ''}`
    case 'bath':
      return String(c.note || '干干净净，又是香香的一天')
    case 'medication':
      return `${c.name} · ${c.dosage}${c.note ? ` · ${c.note}` : ''}`
    case 'incident':
      return String(c.description)
  }
}
