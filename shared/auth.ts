/**
 * 认证标识的纯校验函数，不发送验证码或登录请求。
 * 中国大陆手机号统一输出 +86 格式，注册、密码登录与绑定共用同一规则。
 */
import { z } from 'zod'

/**
 * 接受本地 11 位、+86 或 86 前缀，去除空格/短横线后输出 +86 号码。
 * 格式不合法则抛错；不验证号码是否真实存在或是否属于当前用户。
 */
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

/**
 * 只接受去掉首尾空白后的 6 位数字；验证码真伪和到期状态交由 Auth 校验。
 */
export function verificationCode(value: string) {
  const code = value.trim()
  if (!/^\d{6}$/.test(code)) throw new Error('请填写短信中的 6 位数字验证码。')
  return code
}

/**
 * 修剪邮箱输入并按邮箱格式和 128 字符上限校验；失败抛 ZodError。
 */
export function loginEmail(value: string) {
  return z.email('请填写有效的邮箱地址。').max(128).parse(value.trim())
}
