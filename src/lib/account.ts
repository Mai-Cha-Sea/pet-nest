/**
 * 当前账号的手机/邮箱绑定，全部使用 Supabase Auth 管理身份。
 * 更新标识不创建第二个业务账号；每次响应都复核用户 ID。
 * 注册短信使用 sms，已登录用户改绑使用 phone_change，两种验证码不能混用。
 */
import type { User } from '@supabase/supabase-js'
import { client } from './supabase'
import { session, userId } from '../stores/auth'
import { chinaPhone, loginEmail, verificationCode } from '../../shared/auth'

/**
 * 保证绑定前后仍为同一个已登录账号。
 * 若响应用户或本地会话身份变化，主动退出本地会话并抛 IDENTITY_MISMATCH。
 */
async function acceptUser(user: User | null, expected: string): Promise<User> {
  if (!user || user.id !== expected || session.value?.user.id !== expected) {
    await client().auth.signOut({ scope: 'local' })
    session.value = null
    throw new Error('IDENTITY_MISMATCH')
  }
  session.value = { ...session.value, user }
  return user
}

/**
 * 从 Auth 服务读取当前用户的已确认/待确认标识，并复核身份。
 */
export async function getAccount() {
  const expected = userId()
  const { data, error } = await client().auth.getUser()
  if (error) throw error
  return acceptUser(data.user, expected)
}

/**
 * 请求当前账号绑定中国大陆手机号；返回目标号码及 Auth 用户。
 * 请求被接受不代表验证码已确认；后续必须调用 confirmPhoneBinding。
 */
export async function requestPhoneBinding(value: string) {
  const phone = chinaPhone(value)
  const before = await getAccount()
  if (before.phone?.replace(/^\+/, '') === phone.slice(1) && before.phone_confirmed_at)
    throw new Error('此手机号已经绑定，无需重复验证。')
  const { data, error } = await client().auth.updateUser({ phone })
  if (error) throw error
  return { user: await acceptUser(data.user, before.id), phone }
}

/**
 * 用 phone_change 验证码确认绑定，再向 Auth 重新读取并核对目标号码。
 * 只有服务端确认完成才返回成功；不会改密码或合并其他账号的数据。
 */
export async function confirmPhoneBinding(phone: string, code: string) {
  const target = chinaPhone(phone)
  const before = await getAccount()
  const { data, error } = await client().auth.verifyOtp({
    phone: target,
    token: verificationCode(code),
    type: 'phone_change',
  })
  if (error) throw error
  await acceptUser(data.user, before.id)
  const current = await getAccount()
  if (!current.phone_confirmed_at || current.phone?.replace(/^\+/, '') !== target.slice(1))
    throw new Error('手机号尚未完成验证，请检查验证码或刷新绑定状态。')
  return current
}

/**
 * 请求绑定邮箱并设置确认后的 /profile 回跳。
 * 返回值可能仍含待确认邮箱，页面应在用户完成邮件验证后刷新。
 */
export async function requestEmailBinding(value: string) {
  const email = loginEmail(value)
  const before = await getAccount()
  if (before.email?.toLowerCase() === email.toLowerCase() && before.email_confirmed_at)
    throw new Error('此邮箱已经绑定，无需重复验证。')
  const { data, error } = await client().auth.updateUser(
    { email },
    { emailRedirectTo: window.location.origin + '/profile' },
  )
  if (error) throw error
  return { user: await acceptUser(data.user, before.id), email }
}
