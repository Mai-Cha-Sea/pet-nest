<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { getProfile, getPets, saveProfile, uploadAvatar, validateImage } from '../lib/api'
import { configured } from '../lib/supabase'
import { session } from '../stores/auth'
import { getCommunityPerson } from '../lib/community'
import type { CommunityPerson } from '../../shared/community'
import { errorMessage } from '../lib/errors'
import type { Profile, Pet } from '../../shared/domain'
import Icon from '../components/Icon.vue'
import Notice from '../components/Notice.vue'
import MediaImage from '../components/MediaImage.vue'
import AccountBindings from '../components/AccountBindings.vue'
const profile = ref<Profile>({ id: '', nickname: '', bio: '', avatar_path: null }),
  pets = ref<Pet[]>([]),
  error = ref(''),
  success = ref(''),
  busy = ref(false),
  loading = ref(false),
  loadFailed = ref(false),
  file = ref<File>()
const community = ref<CommunityPerson | null>(null),
  statsLoading = ref(configured),
  statsError = ref('')
async function loadStats() {
  if (!configured || !session.value) return
  statsLoading.value = true
  statsError.value = ''
  try {
    community.value = await getCommunityPerson(session.value.user.id)
  } catch (e) {
    statsError.value = errorMessage(e)
  } finally {
    statsLoading.value = false
  }
}
async function load() {
  if (!configured) return
  loading.value = true
  loadFailed.value = false
  try {
    ;[profile.value, pets.value] = await Promise.all([getProfile(), getPets()])
  } catch (e) {
    error.value = errorMessage(e)
    loadFailed.value = true
  } finally {
    loading.value = false
  }
}
onMounted(load)
onMounted(loadStats)
async function choose(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f)
    try {
      await validateImage(f)
      file.value = f
    } catch (e) {
      error.value = errorMessage(e)
      file.value = undefined
    }
}
async function save() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  success.value = ''
  try {
    await saveProfile(profile.value)
    if (file.value) {
      profile.value.avatar_path = await uploadAvatar(file.value)
      file.value = undefined
    }
    success.value = '个人资料已保存。'
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">THE PERSON BEHIND THE LOVE</span>
      <h1>我的小天地<span class="heading-dot">.</span></h1>
      <p>照顾它的你，也值得被好好认识。</p>
    </div>
    <RouterLink to="/settings" class="button secondary"
      ><Icon name="settings" :size="17" />设置</RouterLink
    >
  </div>
  <Notice :error="error" :success="success" />
  <section class="panel profile-social-panel" aria-label="社区互动统计">
    <div class="section-heading">
      <h2>我的社区</h2>
      <button class="text-button" :disabled="statsLoading || !configured" @click="loadStats">
        刷新统计
      </button>
    </div>
    <p v-if="!configured" class="muted">连接服务后可查看社区统计。</p>
    <p v-else-if="statsLoading" role="status">正在读取社区统计…</p>
    <template v-else-if="statsError"
      ><Notice :error="statsError" /><button class="text-button" @click="loadStats">
        重试统计
      </button></template
    >
    <template v-else>
      <dl class="profile-social-stats">
        <div>
          <dt>累计获赞</dt>
          <dd>{{ community ? (community.like_received_count ?? '—') : 0 }}</dd>
        </div>
        <div>
          <dt>关注</dt>
          <dd>{{ community?.following_count ?? 0 }}</dd>
        </div>
        <div>
          <dt>粉丝</dt>
          <dd>{{ community?.follower_count ?? 0 }}</dd>
        </div>
      </dl>
      <p class="muted compact">仅统计当前已发布动态收到的点赞，取消点赞或删除、下架动态后更新。</p>
    </template>
  </section>
  <RouterLink to="/community" class="panel community-profile-entry"
    ><Icon name="community" /><span
      ><strong>我的社区日常</strong><small>动态、获赞、收藏、关注与粉丝</small></span
    ><Icon name="right" :size="17"
  /></RouterLink>
  <p v-if="loading">正在读取个人资料…</p>
  <button v-if="loadFailed" class="button secondary" @click="load">重新加载</button>
  <div v-else-if="!loading" class="profile-layout">
    <section class="panel">
      <div class="profile-avatar"><MediaImage :path="profile.avatar_path" alt="我的头像" /></div>
      <form @submit.prevent="save">
        <label
          >昵称<input
            v-model="profile.nickname"
            required
            maxlength="64"
            placeholder="怎么称呼你？" /></label
        ><label
          >个人简介<textarea
            v-model="profile.bio"
            maxlength="128"
            rows="3"
            placeholder="和你的小伙伴们，简单打个招呼吧。"
          ></textarea></label
        ><label
          >更新头像<input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            @change="choose"
          /><small>{{ file?.name || 'JPG / PNG / WebP，最大 5 MB' }}</small></label
        ><label>登录邮箱<input :value="session?.user.email || '尚未绑定邮箱'" disabled /></label
        ><button class="button" :disabled="busy || !configured">
          {{ busy ? '保存中…' : '保存个人资料' }}
        </button>
      </form>
    </section>
    <section class="panel">
      <div class="section-heading">
        <h2>我的小家庭</h2>
        <span class="count-pill">{{ pets.length }} 位成员</span>
      </div>
      <RouterLink v-for="pet in pets" :key="pet.id" :to="`/pets/${pet.id}`" class="profile-pet-link"
        ><Icon name="paw" /><span>{{ pet.name }}</span
        ><Icon name="right" :size="16"
      /></RouterLink>
      <div v-if="!pets.length" class="empty small">
        <Icon name="heart" :size="30" />
        <p>你的小家庭，等待第一位成员。</p>
        <RouterLink to="/pets/new" class="button secondary">添加宠物</RouterLink>
      </div>
    </section>
  </div>
  <AccountBindings v-if="!loading && !loadFailed" />
</template>
