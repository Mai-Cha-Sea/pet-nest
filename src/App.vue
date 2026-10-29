<script setup lang="ts">
/**
 * 应用布局、桌面/手机导航及会话变化后的页面隔离。
 * RouterView 按用户 ID 与路径重建，避免切换账号后复用上一账号的组件状态。
 */
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from './components/Icon.vue'
import { configured } from './lib/supabase'
import { session, signOut } from './stores/auth'
import { cleanup } from './lib/api'
const route = useRoute(),
  router = useRouter()
const active = computed(() =>
  route.path.startsWith('/ai')
    ? 'ai'
    : route.path.startsWith('/community')
      ? 'community'
      : /^\/(profile|settings)/.test(route.path)
        ? 'profile'
        : 'pets',
)
/**
 * 会话退出时离开受保护内容；登录后尽力处理本人的待清理图片队列。
 */
watch(session, (next, old) => {
  if (old && !next && route.path !== '/auth') router.replace('/auth')
  if (next) void cleanup()
})
/**
 * 侧栏退出入口；发生错误转入设置页，让用户继续核对连接和账号状态。
 */
async function logout() {
  try {
    await signOut()
    router.replace('/auth')
  } catch {
    router.push('/settings')
  }
}
</script>
<template>
  <div v-if="route.path === '/auth'" class="auth-shell"><RouterView /></div>
  <div v-else class="app-shell">
    <aside class="sidebar">
      <RouterLink to="/pets" class="brand"
        ><span class="brand-icon"><Icon name="paw" :size="25" /></span
        ><span>宠物小窝<small>PET NEST</small></span></RouterLink
      >
      <div class="sidebar-caption">每一份陪伴，都值得被记录</div>
      <nav class="main-nav" aria-label="主导航">
        <RouterLink to="/pets" :class="{ selected: active === 'pets' }"
          ><Icon name="grid" />我的宠物<Icon
            name="right"
            class="nav-chevron"
            :size="15" /></RouterLink
        ><RouterLink to="/ai" :class="{ selected: active === 'ai' }"
          ><Icon name="ai" />AI 健康助手<span class="nav-badge">AI</span></RouterLink
        ><RouterLink to="/community" :class="{ selected: active === 'community' }"
          ><Icon name="community" />宠友社区</RouterLink
        ><RouterLink to="/profile" :class="{ selected: active === 'profile' }"
          ><Icon name="user" />个人主页</RouterLink
        >
      </nav>
      <div class="sidebar-note">
        <Icon name="heart" :size="24" />
        <p>小小的记录<br />是长长久久的关心。</p>
        <span>一起照顾好我们的家人</span>
        <div class="note-paw"><Icon name="paw" :size="54" /></div>
      </div>
      <div class="sidebar-bottom">
        <RouterLink to="/settings"><Icon name="settings" :size="18" />设置与帮助</RouterLink
        ><button v-if="session" @click="logout"><Icon name="logout" :size="18" />退出登录</button>
        <div class="private-label">
          <Icon name="deworming" :size="14" />你的宠物资料，仅自己可见
        </div>
      </div>
    </aside>
    <div class="main-column">
      <header class="topbar">
        <div class="breadcrumb">
          <span>我的小窝</span><Icon name="right" :size="14" /><strong>{{
            active === 'ai'
              ? 'AI 健康助手'
              : active === 'community'
                ? '宠友社区'
                : active === 'profile'
                  ? '个人中心'
                  : '宠物与日常'
          }}</strong>
        </div>
        <div class="row">
          <span class="status-dot"></span
          ><span class="topbar-note">{{
            configured ? '用心陪伴，安心记录' : '本地预览 · 等待连接'
          }}</span
          ><RouterLink :to="session ? '/profile' : '/auth'" class="top-avatar" aria-label="个人主页"
            ><Icon name="user" :size="19"
          /></RouterLink>
        </div>
      </header>
      <main id="main-content">
        <div v-if="!configured" class="setup-banner" role="status">
          <Icon name="deworming" :size="18" /><span
            >尚未连接 Supabase。页面可预览；登录、保存和 AI 需要先完成环境配置。</span
          ><RouterLink to="/settings">查看配置 <span aria-hidden="true">↗</span></RouterLink>
        </div>
        <RouterView :key="`${session?.user.id || 'guest'}:${route.path}`" />
      </main>
      <footer class="page-footer">
        <span>宠物小窝 · 让陪伴有迹可循</span
        ><span><Icon name="heart" :size="12" />为每一个小生命，记录每一天</span>
      </footer>
    </div>
    <nav class="mobile-nav" aria-label="手机主导航">
      <RouterLink to="/pets" :class="{ selected: active === 'pets' }"
        ><Icon name="paw" />宠物</RouterLink
      ><RouterLink to="/ai" :class="{ selected: active === 'ai' }"
        ><Icon name="ai" />AI 助手</RouterLink
      ><RouterLink to="/community" :class="{ selected: active === 'community' }"
        ><Icon name="community" />社区</RouterLink
      ><RouterLink to="/profile" :class="{ selected: active === 'profile' }"
        ><Icon name="user" />我的</RouterLink
      >
    </nav>
  </div>
</template>
