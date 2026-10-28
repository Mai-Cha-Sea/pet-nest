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
