// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import AccountBindings from '../src/components/AccountBindings.vue'
const api = vi.hoisted(() => ({
  getAccount: vi.fn(),
  requestPhoneBinding: vi.fn(),
  confirmPhoneBinding: vi.fn(),
  requestEmailBinding: vi.fn(),
}))
vi.mock('../src/lib/account', () => api)
vi.mock('../src/lib/supabase', () => ({ configured: true }))
vi.mock('../src/stores/auth', () => ({ session: { value: { user: { id: 'owner-a' } } } }))
const user = {
  id: 'owner-a',
  email: 'existing@example.com',
  email_confirmed_at: '2026-10-01',
  phone: '',
  phone_confirmed_at: null,
}
const wrappers: ReturnType<typeof mount>[] = []
async function render() {
  const wrapper = mount(AccountBindings)
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}
beforeEach(() => {
  vi.resetAllMocks()
  api.getAccount.mockResolvedValue(user)
})
afterEach(() => wrappers.splice(0).forEach((w) => w.unmount()))
describe('account binding forms and verification states', () => {
  it('shows the fixed +86 phone input and confirmed email separately', async () => {
    const w = await render()
    expect(w.get('.phone-prefix').text()).toBe('+86')
    expect(w.text()).toContain('未绑定中国大陆手机号')
    expect(w.text()).toContain('已绑定：existing@example.com')
    expect(w.get('input[autocomplete="one-time-code"]').isVisible()).toBe(true)
    expect(w.get('.binding-verification button').attributes('disabled')).toBeDefined()
  })
  it('requires the phone_change verification before declaring a phone bound', async () => {
    api.requestPhoneBinding.mockResolvedValue({
      user: { ...user, new_phone: '8613900001234' },
      phone: '+8613900001234',
    })
    api.confirmPhoneBinding.mockResolvedValue({
      ...user,
      phone: '8613900001234',
      phone_confirmed_at: '2026-10-28',
    })
    const w = await render()
    await w.get('input[type="tel"]').setValue('13900001234')
    await w.findAll('form')[0]!.trigger('submit')
    await flushPromises()
    expect(w.text()).toContain('尚未生效')
    expect(w.text()).not.toContain('手机号绑定成功')
    await w.get('input[autocomplete="one-time-code"]').setValue('654321')
    await w.get('.binding-verification').trigger('submit')
    await flushPromises()
    expect(api.confirmPhoneBinding).toHaveBeenCalledWith('13900001234', '654321')
    expect(w.text()).toContain('已绑定：+8613900001234')
    expect(w.text()).toContain('手机号绑定成功')
  })
  it('keeps an added email pending until a verified refresh and preserves the phone', async () => {
    const phoneOnly = {
      ...user,
      email: '',
      email_confirmed_at: null,
      phone: '8613900001234',
      phone_confirmed_at: '2026-10-28',
    }
    api.getAccount.mockResolvedValue(phoneOnly)
    api.requestEmailBinding.mockResolvedValue({
      user: { ...phoneOnly, new_email: 'new@example.com' },
      email: 'new@example.com',
    })
    const w = await render()
    await w.get('input[type="email"]').setValue('new@example.com')
    await w.get('form[aria-label="绑定邮箱"]').trigger('submit')
    await flushPromises()
    expect(w.text()).toContain('尚未绑定邮箱')
    expect(w.text()).toContain('待验证：new@example.com')
    api.getAccount.mockResolvedValue({
      ...phoneOnly,
      email: 'new@example.com',
      email_confirmed_at: '2026-10-28',
    })
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(w.text()).toContain('已绑定：new@example.com')
    expect(w.text()).toContain('已绑定：+8613900001234')
    expect(w.text()).not.toContain('待验证：new@example.com')
  })
  it('does not show a sent code or bound phone when the SMS service rejects the request', async () => {
    api.requestPhoneBinding.mockRejectedValue(new Error('Unable to get SMS provider'))
    const w = await render()
    await w.get('input[type="tel"]').setValue('13900001234')
    await w.findAll('form')[0]!.trigger('submit')
    await flushPromises()
    expect(w.get('[role="alert"]').text()).toContain('短信服务尚未配置')
    expect(w.get('input[autocomplete="one-time-code"]').isVisible()).toBe(true)
    expect(w.text()).not.toContain('验证码请求已提交')
  })
  it('restores pending phone verification from the server after reopening the page', async () => {
    api.getAccount.mockResolvedValue({ ...user, new_phone: '8613900001234' })
    const w = await render()
    expect(w.find('.binding-verification').exists()).toBe(true)
    expect(w.get<HTMLInputElement>('input[type="tel"]').element.value).toBe('13900001234')
    expect(api.requestPhoneBinding).not.toHaveBeenCalled()
  })
  it('retains a sent target and entered code when a focus refresh omits new_phone', async () => {
    api.requestPhoneBinding.mockResolvedValue({ user, phone: '+8613900001234' })
    const w = await render()
    await w.get('input[type="tel"]').setValue('13900001234')
    await w.get('form').trigger('submit')
    await flushPromises()
    await w.get('input[autocomplete="one-time-code"]').setValue('654321')
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(w.text()).toContain('待验证：+86 13900001234')
    expect(w.get<HTMLInputElement>('input[autocomplete="one-time-code"]').element.value).toBe(
      '654321',
    )
    expect(api.requestPhoneBinding).toHaveBeenCalledOnce()
  })
  it('can verify an already received code after reopening, without sending another SMS', async () => {
    api.confirmPhoneBinding.mockResolvedValue({
      ...user,
      phone: '8613900001234',
      phone_confirmed_at: '2026-10-28',
    })
    const w = await render()
    await w.get('input[type="tel"]').setValue('13900001234')
    await w.get('input[autocomplete="one-time-code"]').setValue('654321')
    await w.get('.binding-verification').trigger('submit')
    await flushPromises()
    expect(api.confirmPhoneBinding).toHaveBeenCalledWith('13900001234', '654321')
    expect(api.requestPhoneBinding).not.toHaveBeenCalled()
    expect(w.text()).toContain('手机号绑定成功')
  })
  it('keeps verification fields usable while refreshing the loaded account', async () => {
    const w = await render()
    let finish!: (value: typeof user) => void
    api.getAccount.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(w.get('input[autocomplete="one-time-code"]').isVisible()).toBe(true)
    expect(w.get('input[type="tel"]').attributes('disabled')).toBeUndefined()
    finish(user)
    await flushPromises()
  })
  it('clears the previous code when changing the phone number before verification', async () => {
    api.getAccount.mockResolvedValue({ ...user, new_phone: '8613900001234' })
    const w = await render()
    await w.get('input[autocomplete="one-time-code"]').setValue('654321')
    await w.get('input[type="tel"]').setValue('13900005678')
    expect(w.get<HTMLInputElement>('input[autocomplete="one-time-code"]').element.value).toBe('')
    await w.get('.binding-verification').trigger('submit')
    expect(api.confirmPhoneBinding).not.toHaveBeenCalled()
  })
})
