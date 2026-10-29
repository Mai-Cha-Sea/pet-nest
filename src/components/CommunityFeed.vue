<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import type { CommunityPost, FeedMode } from '../../shared/community'
import { getFeed } from '../lib/community'
import { errorMessage } from '../lib/errors'
import { configured } from '../lib/supabase'
import CommunityPostCard from './CommunityPostCard.vue'
import Notice from './Notice.vue'
import Icon from './Icon.vue'
const props = defineProps<{ mode: FeedMode; author?: string; revision?: number }>()
const items = ref<CommunityPost[]>([]),
  busy = ref(false),
  error = ref(''),
  hasMore = ref(false)
let version = 0,
  offset = 0
async function load(more = false) {
  if (!configured) return
  const current = ++version
  busy.value = true
  error.value = ''
  if (!more) {
    offset = 0
    items.value = []
  }
  try {
    const rows = await getFeed(props.mode, more ? offset : 0, props.author)
    if (current !== version) return
    const seen = new Map((more ? [...items.value, ...rows] : rows).map((p) => [p.id, p]))
    items.value = [...seen.values()]
    offset += rows.length
    hasMore.value = rows.length === 20 && offset < 10000
  } catch (e) {
    if (current === version) error.value = errorMessage(e)
  } finally {
    if (current === version) busy.value = false
  }
}
watch([() => props.mode, () => props.author, () => props.revision], () => load(), {
  immediate: true,
})
onUnmounted(() => {
  version++
})
</script>
<template>
  <Notice :error="error" /><button v-if="error" class="text-button" @click="load()">
    重新加载动态
  </button>
  <p v-if="busy && !items.length" class="muted" role="status">正在看看小伙伴们的日常…</p>
  <div v-else-if="!items.length && !error" class="panel empty">
    <Icon name="community" :size="38" />
    <h3>
      {{
        mode === 'following'
          ? '关注一些宠友，日常就会出现在这里'
          : mode === 'favorites'
            ? '遇见喜欢的日常，收藏起来'
            : '第一份分享，等你来写'
      }}
    </h3>
    <p>记录属于你和毛孩子的小小快乐。</p>
  </div>
  <div class="community-feed">
    <CommunityPostCard
      v-for="post in items"
      :key="post.id"
      :post="post"
      @removed="items = items.filter((item) => item.id !== post.id)"
    />
  </div>
  <button
    v-if="hasMore"
    class="button secondary load-community"
    :disabled="busy"
    @click="load(true)"
  >
    {{ busy ? '加载中…' : '加载更多动态' }}
  </button>
</template>
