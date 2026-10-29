// @vitest-environment jsdom
/**
 * 路由守卫回归：匿名协议/设置可读，宠物、AI 和社区仍要求会话。
 * 认证启动 Promise 与会话是隔离夹具，不执行真实登录或导航到外网。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
const auth = vi.hoisted(() => ({ session: { value: null as null | { user: { id: string } } } }))
vi.mock('../src/stores/auth', () => ({
  session: auth.session,
  authPromise: Promise.resolve(),
  signOut: vi.fn(),
  userId: vi.fn(),
}))
vi.mock('../src/lib/supabase', () => ({ configured: true, client: vi.fn() }))
import { router } from '../src/router'
beforeEach(async () => {
  auth.session.value = null
  await router.push('/auth')
})
describe('public privacy help and authenticated route boundary', () => {
  it('allows a logged-out visitor to read settings/privacy', async () => {
    await router.push('/settings')
    expect(router.currentRoute.value.path).toBe('/settings')
    expect(router.currentRoute.value.meta.public).toBe(true)
  })
  it('continues to protect pets, AI and community and preserves the return path', async () => {
    for (const path of ['/pets', '/ai', '/community']) {
      await router.push(path)
      expect(router.currentRoute.value.path).toBe('/auth')
      expect(router.currentRoute.value.query.redirect).toBe(path)
    }
  })
  it('lets anonymous visitors read both complete legal documents', async () => {
    for (const path of ['/terms', '/privacy']) {
      await router.push(path)
      expect(router.currentRoute.value.path).toBe(path)
      expect(router.currentRoute.value.meta.public).toBe(true)
    }
  })
  it('allows an authenticated user to open their private route', async () => {
    auth.session.value = { user: { id: 'test-user' } }
    await router.push('/pets')
    expect(router.currentRoute.value.path).toBe('/pets')
  })
  it('shows the public missing-page route without a login redirect', async () => {
    await router.push('/missing-test-page')
    expect(router.currentRoute.value.path).toBe('/missing-test-page')
    expect(router.currentRoute.value.meta.public).toBe(true)
  })
})
