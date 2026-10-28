import { z } from 'zod'

export function chinaPhone(value: string) {
  const compact = value.trim().replace(/[\s-]/g, '')
  const local = compact.startsWith('+86')
    ? compact.slice(3)
    : compact.startsWith('86') && compact.length === 13
      ? compact.slice(2)
      : compact
  if (!/^1[3-9]\d{9}$/.test(local)) throw new Error('请填写中国大陆 11 位手机号，区号固定为 +86。')
  return `+86${local}`
}

export function verificationCode(value: string) {
  const code = value.trim()
  if (!/^\d{6}$/.test(code)) throw new Error('请填写短信中的 6 位数字验证码。')
  return code
}

export function loginEmail(value: string) {
  return z.email('请填写有效的邮箱地址。').max(128).parse(value.trim())
}
