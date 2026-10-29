/**
 * P0 共享字段与记录校验的纯函数测试，涵盖单位、日期、图片限制和 AI 请求结构。
 * 这里只验证应用边界，数据库约束的独立执行见 database.test.ts。
 */
import { describe, it, expect } from 'vitest'
import {
  petSchema,
  profileSchema,
  validateRecord,
  validDate,
  aiRequestSchema,
  recordSummary,
} from '../shared/domain'
describe('shared validation', () => {
  const pet = {
    name: ' 团子 ',
    species: 'cat',
    breed: '',
    gender: 'unknown',
    date_kind: 'birth',
    birth_date: '',
    weight: null,
    sterilized: false,
    remark: '',
  }
  it('trims names and accepts unknown optional facts', () =>
    expect(petSchema.parse(pet).name).toBe('团子'))
  it('rejects empty name, invalid weight, dates and long bios', () => {
    expect(() => petSchema.parse({ ...pet, name: ' ' })).toThrow()
    expect(() => petSchema.parse({ ...pet, weight: -1 })).toThrow()
    expect(validDate('2026-02-31')).toBe(false)
    expect(validDate('2999-01-01')).toBe(false)
    expect(() => profileSchema.parse({ nickname: '友', bio: 'x'.repeat(129) })).toThrow()
  })
  it('validates all six types', () => {
    for (const [type, c] of Object.entries({
      feeding: { food: '粮', amount: 30, unit: 'g' },
      weight: { weight: 3 },
      deworming: { kind: 'internal', note: '' },
      bath: { note: '' },
      medication: { name: '用户填写', dosage: '用户填写', note: '' },
      incident: { description: '异常' },
    }))
      expect(() =>
        validateRecord(type as Parameters<typeof validateRecord>[0], c, new Date().toISOString()),
      ).not.toThrow()
  })
  it('rejects future dates and excess or misplaced pictures', () => {
    expect(() => validateRecord('weight', { weight: 3 }, '2999-01-01')).toThrow()
    expect(() => validateRecord('bath', { note: '' }, new Date().toISOString(), 1)).toThrow()
    expect(() =>
      validateRecord('incident', { description: 'x' }, new Date().toISOString(), 10),
    ).toThrow()
  })
  it('rejects forged IDs, blank questions and unexpected AI parameters', () => {
    const req = {
      pet_id: crypto.randomUUID(),
      session_id: crypto.randomUUID(),
      request_id: crypto.randomUUID(),
      question: '今天好吗？',
    }
    expect(aiRequestSchema.safeParse(req).success).toBe(true)
    for (const value of [
      { ...req, pet_id: 'bad' },
      { ...req, question: ' ' },
      { ...req, question: 'x'.repeat(2001) },
      { ...req, user_id: crypto.randomUUID() },
    ])
      expect(aiRequestSchema.safeParse(value).success).toBe(false)
  })
  it('formats a factual feeding summary', () =>
    expect(
      recordSummary({ type: 'feeding', content: { food: '干粮', amount: 40, unit: 'g' } }),
    ).toBe('干粮 · 40 g'))
})
