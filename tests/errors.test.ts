/** 短信回执超时的兼容识别；明确拒绝和普通网络错误不能被转成待确认状态。 */
import { describe, expect, it } from 'vitest'
import { errorMessage, isSmsHookTimeout } from '../src/lib/errors'

describe('SMS hook confirmation timeout classification', () => {
  it('keeps hook service failure as an error and explains it in Chinese', () => {
    const failure = {
      code: 'unexpected_failure',
      message: 'Service currently unavailable due to hook',
    }
    expect(isSmsHookTimeout(failure)).toBe(false)
    expect(errorMessage(failure)).toContain('验证消息服务暂时不可用')
    expect(errorMessage(failure)).not.toContain('如已收到短信')
  })
  it.each([
    { code: 'hook_timeout', message: 'Hook timed out' },
    { code: 'hook_timeout_after_retry', message: 'Hook retry timed out' },
    new Error('Failed to reach hook within maximum time of 5.000000 seconds'),
    new Error('Failed to call hook after 5.0000 seconds'),
  ])('recognizes the Auth confirmation timeout %j', (error) => {
    expect(isSmsHookTimeout(error)).toBe(true)
  })
  it.each([
    { code: 'sms_send_failed', message: 'SMS send failed after 5 seconds' },
    { code: 'over_sms_send_rate_limit', message: 'Too many requests' },
    new Error('Unable to get SMS provider'),
    new Error('Failed to fetch'),
    new Error('Request timed out after 5 seconds'),
    null,
  ])('keeps real failures and unrelated timeouts out of the SMS pending flow %j', (error) => {
    expect(isSmsHookTimeout(error)).toBe(false)
  })
  it('still explains provider rejection and rate limits as errors', () => {
    expect(errorMessage({ code: 'sms_send_failed', message: 'rejected' })).toContain(
      '短信未发送成功',
    )
    expect(errorMessage({ code: 'over_sms_send_rate_limit', message: 'limited' })).toContain(
      '过于频繁',
    )
  })
})
