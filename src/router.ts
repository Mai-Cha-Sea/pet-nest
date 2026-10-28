import { createRouter, createWebHistory } from 'vue-router'
import { authPromise, session } from './stores/auth'
import { configured } from './lib/supabase'
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/pets' },
    { path: '/auth', component: () => import('./views/AuthView.vue'), meta: { public: true } },
    { path: '/pets', component: () => import('./views/PetsView.vue') },
    { path: '/pets/new', component: () => import('./views/PetEditView.vue') },
    { path: '/pets/:id', component: () => import('./views/PetDetailView.vue') },
    { path: '/pets/:id/edit', component: () => import('./views/PetEditView.vue') },
    { path: '/records/new', component: () => import('./views/RecordView.vue') },
    { path: '/timeline', component: () => import('./views/TimelineView.vue') },
    { path: '/ai', component: () => import('./views/AIView.vue') },
    { path: '/profile', component: () => import('./views/ProfileView.vue') },
    { path: '/settings', component: () => import('./views/SettingsView.vue') },
    {
      path: '/:pathMatch(.*)*',
      component: () => import('./views/NotFoundView.vue'),
      meta: { public: true },
    },
  ],
})
router.beforeEach(async (to) => {
  await authPromise
  if (configured && !to.meta.public && !session.value)
    return { path: '/auth', query: { redirect: to.fullPath } }
})
