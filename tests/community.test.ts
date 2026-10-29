/**
 * 社区共享标签规则的纯函数回归：输入分隔、数量、去重、长度和控制字符。
 * 敏感词最终检查位于 SQL，不由这些前端测试替代。
 */
import { describe, expect, it } from 'vitest'
import { parseTags, tagsSchema } from '../shared/community'
describe('community tag validation', () => {
  it('accepts optional tags and normalizes comma-separated user input', () => {
    expect(parseTags('')).toEqual([])
    expect(parseTags(' #猫咪日常，晒太阳, 小窝 ')).toEqual(['猫咪日常', '晒太阳', '小窝'])
  })
  it('rejects duplicate, excessive, overlong and control-character tags', () => {
    for (const text of ['a,b,c,d', 'cat,cat', 'x'.repeat(21)])
      expect(() => parseTags(text)).toThrow()
    expect(() => tagsSchema.parse(['a\nb'])).toThrow()
  })
})
