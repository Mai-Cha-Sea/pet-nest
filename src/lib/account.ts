import type { User } from '@supabase/supabase-js'
import { client } from './supabase'
import { session, userId } from '../stores/auth'
import { chinaPhone, loginEmail, verificationCode } from '../../shared/auth'

async function acceptUser(user: User | null, expected: string): Promise<User> {
  if (!user || user.id !== expected || session.value?.user.id !== expected) {
    await client().auth.signOut({ scope: 'local' })
    session.value = null
    throw new Error('IDENTITY_MISMATCH')
  }
  session.value = { ...session.value, user }
  return user
}

export async function getAccount() {
  const expected = userId()
  const { data, error } = await client().auth.getUser()
  if (error) throw error
  return acceptUser(data.user, expected)
}

export async function requestPhoneBinding(value: string) {
  const phone = chinaPhone(value)
  const before = await getAccount()
  if (before.phone?.replace(/^\+/, '') === phone.slice(1) && before.phone_confirmed_at)
    throw new Error('此手机号已经绑定，无需重复验证。')
  const { data, error } = await client().auth.updateUser({ phone })
  if (error) throw error
  return { user: await acceptUser(data.user, before.id), phone }
}

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
