<script setup lang="ts">
/**
 * 可复用的信息流：模式/作者/修订号变化时重载，按服务端偏移分页。
 * 排序随互动可能变化，按动态 ID 去重；version 防止较旧响应或卸载后的响应覆盖界面。
 */
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
/**
 * 新筛选清空列表并重置偏移；追加时按服务端返回行数推进，按 ID 合并去重。
 * 不把去重后的展示条数当作服务端偏移，否则推荐排序变化时容易重复翻页。
 */
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
