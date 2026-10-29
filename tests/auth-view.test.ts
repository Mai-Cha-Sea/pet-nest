// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import AuthView from '../src/views/AuthView.vue'
const auth = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  verifyOtp: vi.fn(),
  resend: vi.fn(),
}))
vi.mock('../src/lib/supabase', () => ({ configured: true, client: () => ({ auth }) }))
vi.mock('../src/stores/auth', () => ({ session: { value: null } }))
const wrappers: ReturnType<typeof mount>[] = []
const success = { data: { session: { user: { id: 'auth-test-user' } } }, error: null }
const consent = { accepted: true, terms_version: '2026-10-29', privacy_version: '2026-10-29' }
async function render(path = '/auth') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
  })
  await router.push(path)
  const wrapper = mount(AuthView, { global: { plugins: [router] } })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}
beforeEach(() => {
  vi.resetAllMocks()
  auth.signInWithPassword.mockResolvedValue(success)
  auth.signUp.mockResolvedValue({ data: { session: null }, error: null })
  auth.verifyOtp.mockResolvedValue(success)
  auth.resend.mockResolvedValue({ error: null })
})
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()))
describe('email and phone password sign-in through Supabase Auth', () => {
  it('preserves email sign-in and redirects to the requested private page', async () => {
    const { wrapper, router } = await render('/auth?redirect=/ai')
    await wrapper.get('input[type="email"]').setValue('tester@example.com')
    await wrapper.get('input[type="password"]').setValue('UnitTest!Pass9')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'tester@example.com',
      password: 'UnitTest!Pass9',
    })
    expect(router.currentRoute.value.path).toBe('/ai')
  })
  it('adds the fixed +86 prefix and authenticates with the phone field only', async () => {
    const { wrapper, router } = await render()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '手机号登录')!
      .trigger('click')
    await wrapper.get('input[type="tel"]').setValue('13900001234')
    await wrapper.get('input[type="password"]').setValue('UnitTest!Pass9')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      phone: '+8613900001234',
      password: 'UnitTest!Pass9',
    })
    expect(wrapper.find('input[type="email"]').exists()).toBe(false)
    expect(router.currentRoute.value.path).toBe('/pets')
  })
  it('rejects a non-mainland phone before calling Auth', async () => {
    const { wrapper } = await render()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '手机号登录')!
      .trigger('click')
    await wrapper.get('input[type="tel"]').setValue('07700900101')
    await wrapper.get('input[type="password"]').setValue('UnitTest!Pass9')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(auth.signInWithPassword).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toContain('中国大陆 11 位')
  })
  it('shows a shared invalid-credential error without disclosing whether the phone exists', async () => {
    auth.signInWithPassword.mockResolvedValueOnce({
      data: { session: null },
      error: new Error('Invalid login credentials'),
    })
    const { wrapper } = await render()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '手机号登录')!
      .trigger('click')
    await wrapper.get('input[type="tel"]').setValue('13900001234')
    await wrapper.get('input[type="password"]').setValue('wrong-password')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('邮箱、手机号或密码不正确。')
  })
  it('keeps registration on the verified email flow after switching away from phone sign-in', async () => {
    const { wrapper } = await render()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '手机号登录')!
      .trigger('click')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '注册')!
      .trigger('click')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '邮箱注册')!
      .trigger('click')
    await wrapper.get('input[autocomplete="nickname"]').setValue('测试者')
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper.get('input[type="email"]').setValue('tester@example.com')
    await wrapper.get('input[type="password"]').setValue('UnitTest!Pass9')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(auth.signUp).toHaveBeenCalledWith({
      email: 'tester@example.com',
      password: 'UnitTest!Pass9',
      options: {
        data: { nickname: '测试者', legal_consent: consent },
        emailRedirectTo: window.location.origin + '/auth',
      },
    })
    expect(wrapper.find('input[type="tel"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('请打开注册邮箱')
  })
  it('blocks duplicate sign-in while a request is in progress', async () => {
    let resolve!: (value: typeof success) => void
    auth.signInWithPassword.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const { wrapper } = await render()
    await wrapper.get('input[type="email"]').setValue('tester@example.com')
    await wrapper.get('input[type="password"]').setValue('UnitTest!Pass9')
    await wrapper.get('form').trigger('submit')
    await wrapper.get('form').trigger('submit')
    expect(auth.signInWithPassword).toHaveBeenCalledOnce()
    expect(wrapper.get('button.full').attributes('disabled')).toBeDefined()
    resolve(success)
    await flushPromises()
  })
  it('keeps phone registration pending until Supabase verifies the SMS code', async () => {
    const { wrapper, router } = await render()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '注册')!
      .trigger('click')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '手机号注册')!
      .trigger('click')
    await wrapper.get('input[autocomplete="nickname"]').setValue('手机用户')
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper.get('input[type="tel"]').setValue('13900001234')
    await wrapper.get('input[type="password"]').setValue('UnitTest!Pass9')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(auth.signUp).toHaveBeenCalledWith({
      phone: '+8613900001234',
      password: 'UnitTest!Pass9',
      options: { data: { nickname: '手机用户', legal_consent: consent } },
    })
    expect(router.currentRoute.value.path).toBe('/auth')
    expect(wrapper.text()).toContain('通过短信验证后才会完成注册')
    await wrapper.get('input[autocomplete="one-time-code"]').setValue('654321')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      phone: '+8613900001234',
      token: '654321',
      type: 'sms',
    })
    expect(router.currentRoute.value.path).toBe('/pets')
  })
  it('does not claim that a code was sent when phone registration fails', async () => {
    auth.signUp.mockResolvedValueOnce({
      data: { session: null },
      error: new Error('Unable to get SMS provider'),
    })
    const { wrapper, router } = await render()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '注册')!
      .trigger('click')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '手机号注册')!
      .trigger('click')
    await wrapper.get('input[autocomplete="nickname"]').setValue('手机用户')
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper.get('input[type="tel"]').setValue('13900001234')
    await wrapper.get('input[type="password"]').setValue('UnitTest!Pass9')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('短信服务尚未配置')
    expect(wrapper.find('input[autocomplete="one-time-code"]').exists()).toBe(false)
    expect(router.currentRoute.value.path).toBe('/auth')
  })
  it('reopens registration verification for an existing SMS without signing up or resending', async () => {
    const { wrapper, router } = await render()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '注册')!
      .trigger('click')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '手机号注册')!
      .trigger('click')
    await wrapper.get('input[type="tel"]').setValue('13900001234')
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '已有验证码，继续验证')!
      .trigger('click')
    expect(wrapper.get('input[autocomplete="one-time-code"]').isVisible()).toBe(true)
    expect(wrapper.text()).not.toContain('验证码请求已提交')
    expect(auth.signUp).not.toHaveBeenCalled()
    expect(auth.resend).not.toHaveBeenCalled()
    await wrapper.get('input[autocomplete="one-time-code"]').setValue('654321')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      phone: '+8613900001234',
      token: '654321',
      type: 'sms',
    })
    expect(router.currentRoute.value.path).toBe('/pets')
  })
  it('requires explicit consent for either registration channel and leaves legal links available', async () => {
    const { wrapper } = await render()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '注册')!
      .trigger('click')
    expect((wrapper.get('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(false)
    for (const method of ['邮箱注册', '手机号注册']) {
      await wrapper
        .findAll('button')
        .find((b) => b.text() === method)!
        .trigger('click')
      await wrapper.get('form').trigger('submit')
      await flushPromises()
      expect(auth.signUp).not.toHaveBeenCalled()
      expect(wrapper.get('[role="alert"]').text()).toContain('同意用户协议')
    }
    for (const path of ['/terms', '/privacy']) {
      const link = wrapper.get(`a[href="${path}"]`)
      expect(link.attributes('target')).toBe('_blank')
      expect(link.attributes('rel')).toContain('noopener')
    }
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '登录')!
      .trigger('click')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '注册')!
      .trigger('click')
    expect((wrapper.get('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(false)
  })
})
