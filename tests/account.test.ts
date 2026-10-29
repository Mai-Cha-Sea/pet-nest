// @vitest-environment jsdom
/**
 * 账号绑定 API 边界回归：模拟 Auth，验证同账号复核、phone_change、待确认标识和失败行为。
 * 不触达真实认证服务，不发验证码；不是实际收件或号码归属验收。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({
  session: { value: { user: { id: 'owner-a' } } as Record<string, unknown> | null },
}))
const auth = vi.hoisted(() => ({
  getUser: vi.fn(),
  updateUser: vi.fn(),
  verifyOtp: vi.fn(),
  signOut: vi.fn(),
}))
vi.mock('../src/lib/supabase', () => ({ client: () => ({ auth }) }))
vi.mock('../src/stores/auth', () => ({ session: state.session, userId: () => 'owner-a' }))
import {
  getAccount,
  requestPhoneBinding,
  confirmPhoneBinding,
  requestEmailBinding,
} from '../src/lib/account'
import { chinaPhone } from '../shared/auth'
const user = {
  id: 'owner-a',
  email: 'existing@example.com',
  email_confirmed_at: '2026-10-01',
  phone: '',
  phone_confirmed_at: null,
}
beforeEach(() => {
  vi.resetAllMocks()
  state.session.value = { user: { id: 'owner-a' } }
  auth.getUser.mockResolvedValue({ data: { user }, error: null })
  auth.updateUser.mockResolvedValue({ data: { user }, error: null })
  auth.signOut.mockResolvedValue({ error: null })
})
describe('authenticated binding preserves the current Supabase user', () => {
  it.each(['13900001234', '+8613900001234', '86 13900001234'])(
    'normalizes mainland input %s',
    (value) => expect(chinaPhone(value)).toBe('+8613900001234'),
  )
  it.each(['+447700900101', '123', '+85291234567'])(
    'rejects other regions or invalid input %s',
    (value) => expect(() => chinaPhone(value)).toThrow('中国大陆'),
  )
  it('requests a phone change on the existing user, without creating another account', async () => {
    await requestPhoneBinding('13900001234')
    expect(auth.updateUser).toHaveBeenCalledWith({ phone: '+8613900001234' })
    expect(auth.verifyOtp).not.toHaveBeenCalled()
  })
  it('verifies phone_change and rechecks the confirmed phone on the same user', async () => {
    const bound = { ...user, phone: '8613900001234', phone_confirmed_at: '2026-10-28' }
    auth.verifyOtp.mockResolvedValue({ data: { user: bound }, error: null })
    auth.getUser
      .mockResolvedValueOnce({ data: { user }, error: null })
      .mockResolvedValueOnce({ data: { user: bound }, error: null })
    expect((await confirmPhoneBinding('13900001234', '654321')).id).toBe(user.id)
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      phone: '+8613900001234',
      token: '654321',
      type: 'phone_change',
    })
  })
  it('does not mark an unconfirmed phone as bound', async () => {
    auth.verifyOtp.mockResolvedValue({ data: { user }, error: null })
    await expect(confirmPhoneBinding('13900001234', '654321')).rejects.toThrow('尚未完成验证')
  })
  it('refuses a verify response for a different account and clears that local session', async () => {
    auth.verifyOtp.mockResolvedValue({ data: { user: { ...user, id: 'owner-b' } }, error: null })
    await expect(confirmPhoneBinding('13900001234', '654321')).rejects.toThrow('IDENTITY_MISMATCH')
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(state.session.value).toBeNull()
  })
  it('adds an email to a phone-only account with an explicit confirmation redirect', async () => {
    const phoneOnly = {
      ...user,
      email: '',
      email_confirmed_at: null,
      phone: '8613900001234',
      phone_confirmed_at: '2026-10-28',
    }
    auth.getUser.mockResolvedValue({ data: { user: phoneOnly }, error: null })
    auth.updateUser.mockResolvedValue({
      data: { user: { ...phoneOnly, new_email: 'new@example.com' } },
      error: null,
    })
    const result = await requestEmailBinding('new@example.com')
    expect(result.user.id).toBe(user.id)
    expect(result.user.email).toBe('')
    expect(auth.updateUser).toHaveBeenCalledWith(
      { email: 'new@example.com' },
      { emailRedirectTo: window.location.origin + '/profile' },
    )
  })
  it('preserves provider errors for an already occupied email', async () => {
    const error = { code: 'email_exists', message: 'Email already exists' }
    auth.updateUser.mockResolvedValue({ data: { user: null }, error })
    await expect(requestEmailBinding('occupied@example.com')).rejects.toEqual(error)
  })
})
