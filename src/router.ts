/**
 * 页面路由及登录入口保护；页面按需加载以减少首屏资源。
 * public 只表示允许匿名进入页面，真实数据权限仍由 Auth、RLS 和服务端执行。
 * 新增公开页面必须显式声明 meta.public，并补充 tests/router.test.ts。
 */
import { createRouter, createWebHistory } from 'vue-router'
import { authPromise, session } from './stores/auth'
import { configured } from './lib/supabase'
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/pets' },
    { path: '/auth', component: () => import('./views/AuthView.vue'), meta: { public: true } },
    {
      path: '/terms',
      component: () => import('./views/LegalView.vue'),
      props: { kind: 'terms' },
      meta: { public: true },
    },
    {
      path: '/privacy',
      component: () => import('./views/LegalView.vue'),
      props: { kind: 'privacy' },
      meta: { public: true },
    },
    { path: '/pets', component: () => import('./views/PetsView.vue') },
    { path: '/pets/new', component: () => import('./views/PetEditView.vue') },
    { path: '/pets/:id', component: () => import('./views/PetDetailView.vue') },
    { path: '/pets/:id/edit', component: () => import('./views/PetEditView.vue') },
    { path: '/records/new', component: () => import('./views/RecordView.vue') },
    { path: '/timeline', component: () => import('./views/TimelineView.vue') },
    { path: '/ai', component: () => import('./views/AIView.vue') },
    { path: '/community', component: () => import('./views/CommunityView.vue') },
    { path: '/community/new', component: () => import('./views/CommunityComposeView.vue') },
    { path: '/community/posts/:id', component: () => import('./views/CommunityPostView.vue') },
    { path: '/community/people/:id', component: () => import('./views/CommunityPersonView.vue') },
    { path: '/profile', component: () => import('./views/ProfileView.vue') },
    {
      path: '/settings',
      component: () => import('./views/SettingsView.vue'),
      meta: { public: true },
    },
    {
      path: '/:pathMatch(.*)*',
      component: () => import('./views/NotFoundView.vue'),
      meta: { public: true },
    },
  ],
})
// 等待启动时的会话恢复后再判断页面访问；redirect 由登录页限制为站内路径。
router.beforeEach(async (to) => {
  await authPromise
  if (configured && !to.meta.public && !session.value)
    return { path: '/auth', query: { redirect: to.fullPath } }
})
