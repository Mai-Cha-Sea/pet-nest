// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { Component } from 'vue'
import CommunityComposeView from '../src/views/CommunityComposeView.vue'
import CommunityPostView from '../src/views/CommunityPostView.vue'
import CommunityPostCard from '../src/components/CommunityPostCard.vue'
import CommunityView from '../src/views/CommunityView.vue'
import type { CommunityPost } from '../shared/community'
const mocks = vi.hoisted(() => ({
  getCommunityPerson: vi.fn(),
  saveCommunityProfile: vi.fn(),
  createCommunityPost: vi.fn(),
  uploadCommunityImage: vi.fn(),
  publishCommunityPost: vi.fn(),
  getFeed: vi.fn(),
  getCommunityPost: vi.fn(),
  setCommunityInteraction: vi.fn(),
  deleteCommunityPost: vi.fn(),
  getComments: vi.fn(),
  addComment: vi.fn(),
  deleteComment: vi.fn(),
  reportContent: vi.fn(),
  getPets: vi.fn(),
  validateImage: vi.fn(),
}))
vi.mock('../src/lib/community', () => mocks)
vi.mock('../src/lib/api', () => mocks)
vi.mock('../src/lib/supabase', () => ({ configured: true }))
vi.mock('../src/stores/auth', async () => ({
  userId: () => '11111111-1111-4111-8111-111111111111',
  session: (await import('vue')).ref({ user: { id: '11111111-1111-4111-8111-111111111111' } }),
}))
const post: CommunityPost = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  user_id: '11111111-1111-4111-8111-111111111111',
  nickname: '测试宠友',
  body: '<img src=x onerror=alert(1)> 今天的小快乐',
  pet_label: null,
  tags: ['猫咪日常'],
  image_paths: [],
  status: 'published',
  moderation_note: '',
  created_at: '2026-10-28T10:00:00Z',
  liked: false,
  favorited: false,
  like_count: 0,
  comment_count: 0,
}
const wrappers: ReturnType<typeof mount>[] = []
async function render(component: Component, path = '/community/new', props = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/community/posts/:id', component: { template: '<div />' } },
      { path: '/:pathMatch(.*)*', component: { template: '<div />' } },
    ],
  })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(component, {
    props,
    global: { plugins: [router], stubs: { MediaImage: true } },
  })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.getCommunityPerson.mockResolvedValue({
    user_id: post.user_id,
    nickname: '测试宠友',
    following_count: 0,
    follower_count: 0,
    is_following: false,
  })
  mocks.getPets.mockResolvedValue([])
  mocks.getFeed.mockResolvedValue([])
  mocks.getCommunityPost.mockResolvedValue({ ...post })
  mocks.getComments.mockResolvedValue([])
  mocks.createCommunityPost.mockResolvedValue(post.id)
  mocks.publishCommunityPost.mockResolvedValue('published')
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() }),
  )
})
afterEach(() => {
  wrappers.splice(0).forEach((w) => w.unmount())
  vi.unstubAllGlobals()
})
describe('P1 real Vue interaction flows with mocked transport', () => {
  it('asks for explicit public nickname setup and cannot publish before membership', async () => {
    mocks.getCommunityPerson.mockResolvedValue(null)
    const { wrapper } = await render(CommunityView, '/community')
    expect(wrapper.text()).toContain('邮箱、手机号、私有头像')
    expect(mocks.saveCommunityProfile).not.toHaveBeenCalled()
    expect(wrapper.find('a[href="/community/new"]').exists()).toBe(false)
    await wrapper.get('input').setValue('小窝测试')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(mocks.saveCommunityProfile).toHaveBeenCalledWith('小窝测试')
  })
  it('escapes user content and uses set-to-state likes with an in-flight guard', async () => {
    let finish: () => void = () => {}
    mocks.setCommunityInteraction.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const { wrapper } = await render(CommunityPostCard, '/community', { post })
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>')
    const like = wrapper.get('button[aria-pressed]')
    await like.trigger('click')
    await like.trigger('click')
    expect(mocks.setCommunityInteraction).toHaveBeenCalledTimes(1)
    expect(mocks.setCommunityInteraction).toHaveBeenCalledWith(post.id, 'like', true)
    finish()
    await flushPromises()
  })
  it('reuses the post UUID and already uploaded paths when publishing response is lost', async () => {
    mocks.publishCommunityPost.mockRejectedValueOnce(new Error('Failed to fetch'))
    const { wrapper, router } = await render(CommunityComposeView)
    await wrapper.get('textarea').setValue('今天晒太阳')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('重试这次提交')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    const ids = mocks.createCommunityPost.mock.calls.map((args) => args[0])
    expect(ids[0]).toBe(ids[1])
    expect(ids[0]).toMatch(/^[a-f0-9-]{36}$/)
    expect(router.currentRoute.value.path).toBe(`/community/posts/${ids[0]}`)
  })
  it('unlocks a definitively rejected post so the author can correct text', async () => {
    mocks.createCommunityPost.mockRejectedValueOnce(new Error('CONTENT_BLOCKED'))
    const { wrapper } = await render(CommunityComposeView)
    await wrapper.get('textarea').setValue('不适宜文字')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('请调整后提交')
    expect(wrapper.get('fieldset').attributes('disabled')).toBeUndefined()
    expect(mocks.publishCommunityPost).not.toHaveBeenCalled()
  })
  it('rejects ten images before creating a server draft', async () => {
    const { wrapper } = await render(CommunityComposeView)
    const input = wrapper.get('input[type="file"]')
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: Array.from({ length: 10 }, () => new File(['x'], 'test.png', { type: 'image/png' })),
    })
    await input.trigger('change')
    await flushPromises()
    expect(wrapper.text()).toContain('最多上传 9 张')
    expect(mocks.createCommunityPost).not.toHaveBeenCalled()
  })
  it('shows a newly saved comment immediately and preserves the same UUID across a failed attempt', async () => {
    mocks.addComment
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockImplementationOnce(async (id, post_id, body) => {
        mocks.getComments.mockResolvedValue([
          {
            id,
            post_id,
            body,
            user_id: post.user_id,
            parent_id: null,
            created_at: post.created_at,
            author: { nickname: post.nickname },
          },
        ])
        return id
      })
    const { wrapper } = await render(CommunityPostView, `/community/posts/${post.id}`)
    await wrapper.get('textarea').setValue('小家伙真可爱')
    await wrapper.get('.community-comments form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('重试这条评论')
    await wrapper.get('.community-comments form').trigger('submit')
    await flushPromises()
    expect(mocks.addComment.mock.calls[0]![0]).toBe(mocks.addComment.mock.calls[1]![0])
    expect(wrapper.get('.community-comment').text()).toContain('小家伙真可爱')
    expect(wrapper.text()).toContain('评论已发表')
  })
  it('keeps legacy pending posts private until their author requests automatic rechecking', async () => {
    mocks.getCommunityPost.mockResolvedValue({ ...post, status: 'pending' })
    const { wrapper } = await render(CommunityPostView, `/community/posts/${post.id}`)
    expect(wrapper.text()).toContain('待重新提交审核')
    expect(wrapper.find('.community-comments').exists()).toBe(false)
    expect(mocks.getComments).not.toHaveBeenCalled()
    mocks.getCommunityPost.mockResolvedValue({ ...post, status: 'published' })
    await wrapper.get('button.button.secondary').trigger('click')
    await flushPromises()
    expect(mocks.publishCommunityPost).toHaveBeenCalledWith(post.id, [])
    expect(wrapper.find('.community-comments').exists()).toBe(true)
  })
  it('submits at most three tags and explains that image semantics are not inspected', async () => {
    const { wrapper } = await render(CommunityComposeView)
    await wrapper.get('textarea').setValue('和小猫一起晒太阳')
    const tags = wrapper.get('input[placeholder="例如：猫咪日常，晒太阳"]')
    await tags.setValue('a,b,c,d')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('最多 3 个标签')
    expect(mocks.createCommunityPost).not.toHaveBeenCalled()
    await tags.setValue('#猫咪日常，晒太阳')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(mocks.createCommunityPost.mock.calls[0]![3]).toEqual(['猫咪日常', '晒太阳'])
    expect(wrapper.text()).toContain('当前不识别图片中的文字和画面')
  })
})
