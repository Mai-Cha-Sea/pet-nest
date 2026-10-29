<script setup lang="ts">
/**
 * 动态卡片与详情共用展示、图片预览、点赞/收藏和本人删除。
 * 成功互动后回查服务器计数并通知父组件，不用前端加减猜测最终统计。
 */
import { ref, watch } from 'vue'
import type { CommunityPost } from '../../shared/community'
import { communityStatus } from '../../shared/community'
import { setCommunityInteraction, getCommunityPost, deleteCommunityPost } from '../lib/community'
import { session } from '../stores/auth'
import { errorMessage } from '../lib/errors'
import Icon from './Icon.vue'
import Notice from './Notice.vue'
import MediaImage from './MediaImage.vue'
import ConfirmDialog from './ConfirmDialog.vue'
const props = defineProps<{ post: CommunityPost; detail?: boolean }>()
const emit = defineEmits<{ removed: []; changed: [CommunityPost]; report: [] }>()
const item = ref(props.post),
  busy = ref(false),
  error = ref(''),
  confirm = ref(false)
const viewer = ref<HTMLDialogElement>(),
  viewerOpen = ref(false),
  selectedImage = ref(0)
/**
 * 用原生 dialog 预览选择的图片；图片 URL 的权限和续期由 MediaImage 管理。
 */
function openImage(index: number) {
  selectedImage.value = index
  viewerOpen.value = true
  viewer.value?.showModal()
}
watch(
  () => props.post,
  (value) => {
    item.value = value
  },
)
/**
 * 防止连点，发送目标状态并回查计数；changed 让父组件同步卡片。
 */
async function interact(kind: 'like' | 'favorite') {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await setCommunityInteraction(
      item.value.id,
      kind,
      !(kind === 'like' ? item.value.liked : item.value.favorited),
    )
    item.value = await getCommunityPost(item.value.id)
    emit('changed', item.value)
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}
/**
 * 确认后请求删除本人动态；服务器成功才通知父级移除卡片。
 */
async function remove() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await deleteCommunityPost(item.value.id)
    emit('removed')
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
    confirm.value = false
  }
}
</script>
<template>
  <article class="panel community-card">
    <header class="row between">
      <RouterLink :to="`/community/people/${item.user_id}`" class="community-author"
        ><span class="community-initial">{{ item.nickname.slice(0, 1) }}</span
        ><span
          ><strong>{{ item.nickname }}</strong
          ><time :datetime="item.created_at">{{
            new Date(item.created_at).toLocaleString('zh-CN')
          }}</time></span
        ></RouterLink
      >
      <button
        v-if="item.user_id === session?.user.id"
        class="icon-button"
        aria-label="删除动态"
        :disabled="busy"
        @click="confirm = true"
      >
        <Icon name="trash" :size="17" />
      </button>
    </header>
    <p v-if="item.status !== 'published'" class="community-status" role="status">
      {{ communityStatus[item.status]
      }}{{ item.moderation_note ? ` · ${item.moderation_note}` : '' }}
    </p>
    <p v-if="item.pet_label" class="community-pet">
      <Icon name="paw" :size="14" />和 {{ item.pet_label }} 的日常
    </p>
    <p class="community-body">{{ item.body }}</p>
    <div v-if="item.tags?.length" class="community-tags" aria-label="动态标签">
      <span v-for="tag in item.tags" :key="tag">#{{ tag }}</span>
    </div>
    <div
      v-if="item.image_paths.length"
      class="community-images"
      :class="{ single: item.image_paths.length === 1 }"
    >
      <button
        v-for="(path, i) in item.image_paths"
        :key="path"
        type="button"
        class="community-image-button"
        :aria-label="`查看第 ${i + 1} 张大图`"
        @click="openImage(i)"
      >
        <MediaImage
          :path="path"
          bucket="community-media"
          :alt="`${item.nickname} 分享的图片 ${i + 1}`"
        />
      </button>
    </div>
    <dialog
      ref="viewer"
      class="community-lightbox"
      aria-label="动态图片预览"
      @close="viewerOpen = false"
      @click="
        (e) => {
          if (e.target === viewer) viewer?.close()
        }
      "
    >
      <div class="row between">
        <span>图片 {{ selectedImage + 1 }} / {{ item.image_paths.length }}</span
        ><button
          type="button"
          class="icon-button"
          aria-label="关闭图片预览"
          autofocus
          @click="viewer?.close()"
        >
          <Icon name="close" />
        </button>
      </div>
      <MediaImage
        v-if="viewerOpen && item.image_paths[selectedImage]"
        :path="item.image_paths[selectedImage]"
        bucket="community-media"
        :alt="`动态大图 ${selectedImage + 1}`"
      />
      <div class="row between">
        <button
          type="button"
          class="text-button"
          :disabled="selectedImage === 0"
          @click="selectedImage--"
        >
          上一张</button
        ><button
          type="button"
          class="text-button"
          :disabled="selectedImage >= item.image_paths.length - 1"
          @click="selectedImage++"
        >
          下一张
        </button>
      </div>
    </dialog>
    <Notice :error="error" />
    <footer v-if="item.status === 'published'" class="community-actions">
      <button
        :disabled="busy"
        :aria-pressed="item.liked"
        :class="{ active: item.liked }"
        @click="interact('like')"
      >
        <Icon name="heart" :size="18" /><span>赞 {{ item.like_count }}</span>
      </button>
      <RouterLink v-if="!detail" :to="`/community/posts/${item.id}`"
        ><Icon name="comment" :size="18" />评论 {{ item.comment_count }}</RouterLink
      ><span v-else class="muted">{{ item.comment_count }} 条评论</span>
      <button
        :disabled="busy"
        :aria-pressed="item.favorited"
        :class="{ active: item.favorited }"
        @click="interact('favorite')"
      >
        <Icon name="bookmark" :size="18" />{{ item.favorited ? '已收藏' : '收藏' }}
      </button>
      <RouterLink v-if="!detail" :to="`/community/posts/${item.id}`" class="community-more"
        >详情</RouterLink
      ><button v-else class="community-more" @click="emit('report')">举报</button>
    </footer>
    <RouterLink v-else-if="!detail" :to="`/community/posts/${item.id}`" class="text-button"
      >查看提交状态</RouterLink
    >
    <ConfirmDialog
      v-if="confirm"
      title="删除这条动态？"
      message="动态、评论、点赞和收藏将一并删除，关联图片进入清理队列，删除后无法恢复。"
      :busy="busy"
      danger
      @cancel="confirm = false"
      @confirm="remove"
    />
  </article>
</template>
