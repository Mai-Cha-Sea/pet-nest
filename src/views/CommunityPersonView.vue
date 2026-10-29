<script setup lang="ts">
/**
 * 公开社区主页：动态、实际获赞、关注/粉丝及关注操作。
 * 只使用 community_person/people 的公开字段，不查询目标用户的私有资料。
 */
import { ref, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { getCommunityPerson, getCommunityPeople, setCommunityInteraction } from '../lib/community'
import type { CommunityPerson } from '../../shared/community'
import { session } from '../stores/auth'
import { configured } from '../lib/supabase'
import { errorMessage } from '../lib/errors'
import CommunityFeed from '../components/CommunityFeed.vue'
import Notice from '../components/Notice.vue'
import Icon from '../components/Icon.vue'
const id = String(useRoute().params.id),
  person = ref<CommunityPerson | null>(null),
  tab = ref<'posts' | 'following' | 'followers'>('posts'),
  people = ref<Pick<CommunityPerson, 'user_id' | 'nickname'>[]>([]),
  loading = ref(true),
  peopleBusy = ref(false),
  hasMore = ref(false),
  busy = ref(false),
  error = ref('')
let listVersion = 0
/**
 * 读取公开主页和实际统计；未开通社区资料统一提示 AUTHOR_NOT_FOUND。
 */
async function load() {
  if (!configured) {
    loading.value = false
    return
  }
  loading.value = true
  error.value = ''
  try {
    person.value = await getCommunityPerson(id)
    if (!person.value) throw new Error('AUTHOR_NOT_FOUND')
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)
/**
 * 设置与当前显示相反的目标关注状态，成功后以服务器回读统计为准。
 */
async function follow() {
  if (!person.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await setCommunityInteraction(id, 'follow', !person.value.is_following)
    person.value = await getCommunityPerson(id)
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}
/**
 * 分页读当前关注/粉丝标签；listVersion 防止快速切换时旧响应写回。
 */
async function loadPeople(more = false) {
  const list = tab.value,
    version = ++listVersion
  if (list === 'posts') return
  peopleBusy.value = true
  error.value = ''
  if (!more) people.value = []
  try {
    const rows = await getCommunityPeople(id, list, more ? people.value.length : 0)
    if (version === listVersion) {
      people.value = more ? [...people.value, ...rows] : rows
      hasMore.value = rows.length === 20
    }
  } catch (e) {
    if (version === listVersion) error.value = errorMessage(e)
  } finally {
    if (version === listVersion) peopleBusy.value = false
  }
}
watch(tab, () => loadPeople())
</script>
<template>
  <RouterLink to="/community" class="back-link"><Icon name="back" :size="16" />宠友社区</RouterLink
  ><Notice :error="error" /><button
    v-if="error"
    class="text-button"
    @click="tab === 'posts' ? load() : loadPeople()"
  >
    重新加载
  </button>
  <p v-if="loading" role="status">正在读取社区主页…</p>
  <template v-if="person">
    <section class="panel community-person">
      <div class="community-initial large">{{ person.nickname.slice(0, 1) }}</div>
      <div>
        <span class="eyebrow">A FRIEND OF LITTLE PAWS</span>
        <h1>{{ person.nickname }}</h1>
        <p class="muted">只分享主动发布的日常，私有宠物资料不会展示。</p>
        <div class="row wrap">
          <button class="text-button" @click="tab = 'following'">
            {{ person.following_count }} 关注</button
          ><button class="text-button" @click="tab = 'followers'">
            {{ person.follower_count }} 粉丝
          </button>
          <span class="community-like-total"
            ><Icon name="heart" :size="15" />{{ person.like_received_count ?? '—' }} 获赞</span
          >
        </div>
        <p class="muted compact">获赞为当前已发布动态收到的点赞合计。</p>
      </div>
      <button
        v-if="id !== session?.user.id"
        class="button secondary"
        :disabled="busy"
        :aria-pressed="person.is_following"
        @click="follow"
      >
        {{ busy ? '保存中…' : person.is_following ? '已关注 · 取消' : '关注这位宠友' }}</button
      ><RouterLink v-else to="/community" class="text-button">管理我的社区</RouterLink>
    </section>
    <div class="filter-row community-tabs">
      <button
        v-for="(label, key) in { posts: '分享的日常', following: '关注', followers: '粉丝' }"
        :key="key"
        :class="{ active: tab === key }"
        :aria-pressed="tab === key"
        @click="tab = key"
      >
        {{ label }}
      </button>
    </div>
    <CommunityFeed v-if="tab === 'posts'" mode="recommend" :author="id" />
    <section v-else class="panel">
      <p v-if="peopleBusy" role="status">正在读取列表…</p>
      <p v-else-if="!people.length" class="muted">这里还没有宠友。</p>
      <RouterLink
        v-for="p in people"
        :key="p.user_id"
        :to="`/community/people/${p.user_id}`"
        class="community-person-link"
        ><span class="community-initial">{{ p.nickname.slice(0, 1) }}</span
        >{{ p.nickname }}<Icon name="right" :size="16" /></RouterLink
      ><button
        v-if="hasMore"
        class="button secondary"
        :disabled="peopleBusy"
        @click="loadPeople(true)"
      >
        加载更多宠友
      </button>
    </section>
  </template>
</template>
