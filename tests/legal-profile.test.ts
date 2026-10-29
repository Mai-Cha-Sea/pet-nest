// @vitest-environment jsdom
/**
 * 协议全文和两个主页获赞统计的真实组件回归，数据访问边界使用 mock。
 * 统计值必须来自响应，错误不能伪装成 0；真实数据库计数/留存另由 SQL 与云端检查。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { Component } from 'vue'
import ProfileView from '../src/views/ProfileView.vue'
import CommunityPersonView from '../src/views/CommunityPersonView.vue'
import LegalView from '../src/views/LegalView.vue'
const id = '11111111-1111-4111-8111-111111111111'
const mocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  getPets: vi.fn(),
  getCommunityPerson: vi.fn(),
  getCommunityPeople: vi.fn(),
  setCommunityInteraction: vi.fn(),
  getFeed: vi.fn(),
  saveProfile: vi.fn(),
  uploadAvatar: vi.fn(),
  validateImage: vi.fn(),
}))
vi.mock('../src/lib/api', () => mocks)
vi.mock('../src/lib/community', () => mocks)
vi.mock('../src/lib/supabase', () => ({ configured: true }))
vi.mock('../src/stores/auth', async () => ({
  session: (await import('vue')).ref({ user: { id: '11111111-1111-4111-8111-111111111111' } }),
}))
const wrappers: ReturnType<typeof mount>[] = []
async function render(component: Component, props = {}, path = '/profile') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/community/people/:id', component: { template: '<div />' } },
      { path: '/:pathMatch(.*)*', component: { template: '<div />' } },
    ],
  })
  await router.push(path)
  const wrapper = mount(component, {
    props,
    global: {
      plugins: [router],
      stubs: { MediaImage: true, AccountBindings: true, CommunityFeed: true },
    },
  })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.getProfile.mockResolvedValue({ id, nickname: '测试者', bio: '', avatar_path: null })
  mocks.getPets.mockResolvedValue([])
  mocks.getCommunityPerson.mockResolvedValue({
    user_id: id,
    nickname: '社区测试者',
    following_count: 2,
    follower_count: 3,
    like_received_count: 7,
    is_following: false,
  })
})
afterEach(() => wrappers.splice(0).forEach((w) => w.unmount()))
describe('legal pages and received-like profile totals', () => {
  it.each(['terms', 'privacy'] as const)(
    'renders the complete %s document and a way back to registration',
    async (kind) => {
      const wrapper = await render(LegalView, { kind }, '/' + kind)
      expect(wrapper.get('h1').text()).toBe(kind === 'terms' ? '用户协议' : '隐私政策')
      expect(wrapper.findAll('h2').length).toBeGreaterThanOrEqual(6)
      expect(wrapper.text()).toContain('2026-10-29')
      expect(wrapper.get('a[href="/auth"]').text()).toContain('注册')
      if (kind === 'privacy') expect(wrapper.text()).toContain('本项目不把测试数据整理为训练集')
    },
  )
  it('shows server totals on the main profile and refreshes after likes change', async () => {
    const wrapper = await render(ProfileView)
    expect(wrapper.findAll('dd').map((e) => e.text())).toEqual(['7', '2', '3'])
    mocks.getCommunityPerson.mockResolvedValueOnce({
      like_received_count: 8,
      following_count: 2,
      follower_count: 3,
    })
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '刷新统计')!
      .trigger('click')
    await flushPromises()
    expect(wrapper.findAll('dd')[0]!.text()).toBe('8')
  })
  it('keeps private-profile forms usable when stats fail and offers an honest retry', async () => {
    mocks.getCommunityPerson.mockRejectedValueOnce(new Error('Failed to fetch'))
    const wrapper = await render(ProfileView)
    expect(wrapper.get('input[placeholder="怎么称呼你？"]').element).toHaveProperty(
      'value',
      '测试者',
    )
    expect(wrapper.find('dd').exists()).toBe(false)
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '重试统计')!
      .trigger('click')
    await flushPromises()
    expect(wrapper.findAll('dd')[0]!.text()).toBe('7')
  })
  it('shows legitimate zero totals before the user opens a community profile', async () => {
    mocks.getCommunityPerson.mockResolvedValueOnce(null)
    const wrapper = await render(ProfileView)
    expect(wrapper.findAll('dd').map((e) => e.text())).toEqual(['0', '0', '0'])
  })
  it('also shows the received total on the public community profile', async () => {
    const wrapper = await render(CommunityPersonView, {}, '/community/people/' + id)
    expect(wrapper.text()).toContain('7 获赞')
    expect(wrapper.text()).toContain('当前已发布动态')
  })
})
