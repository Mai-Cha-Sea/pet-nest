<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { CommunityPost, CommunityComment } from '../../shared/community'
import { commentSchema } from '../../shared/community'
import {
  getCommunityPost,
  getComments,
  addComment,
  deleteComment,
  reportContent,
} from '../lib/community'
import { configured } from '../lib/supabase'
import { session } from '../stores/auth'
import { errorMessage } from '../lib/errors'
import CommunityPostCard from '../components/CommunityPostCard.vue'
import Notice from '../components/Notice.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import Icon from '../components/Icon.vue'
const route = useRoute(),
  router = useRouter(),
  id = String(route.params.id)
const post = ref<CommunityPost>(),
  comments = ref<CommunityComment[]>([]),
  loading = ref(true),
  busy = ref(false),
  commentsBusy = ref(false),
  error = ref(''),
  commentsError = ref(''),
  success = ref(''),
  body = ref(''),
  reply = ref<CommunityComment>(),
  hasMore = ref(false),
  removing = ref<CommunityComment>(),
  reporting = ref<{ post?: string; comment?: string }>(),
  reason = ref('')
let commentId = crypto.randomUUID(),
  commentAttempt: { body: string; parent?: string } | undefined
async function load() {
  if (!configured) {
    loading.value = false
    return
  }
  loading.value = true
  error.value = ''
  try {
    post.value = await getCommunityPost(id)
    if (post.value.status === 'published') await loadComments()
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}
async function loadComments(more = false) {
  commentsBusy.value = true
  commentsError.value = ''
  try {
    const rows = await getComments(id, more ? comments.value.length : 0)
    comments.value = more ? [...comments.value, ...rows] : rows
    hasMore.value = rows.length === 50
    if (commentAttempt && comments.value.some((c) => c.id === commentId)) resetComment()
  } catch (e) {
    commentsError.value = errorMessage(e)
  } finally {
    commentsBusy.value = false
  }
}
function resetComment() {
  body.value = ''
  reply.value = undefined
  commentAttempt = undefined
  commentId = crypto.randomUUID()
}
onMounted(load)
async function send() {
  if (busy.value) return
  busy.value = true
  commentsError.value = ''
  success.value = ''
  try {
    if (!commentAttempt)
      commentAttempt = { body: commentSchema.parse(body.value), parent: reply.value?.id }
    await addComment(commentId, id, commentAttempt.body, commentAttempt.parent)
    resetComment()
    success.value = '评论已发表。'
    await loadComments()
    post.value = await getCommunityPost(id)
  } catch (e) {
    commentsError.value = errorMessage(e)
    if (
      e &&
      typeof e === 'object' &&
      'message' in e &&
      /CONTENT_BLOCKED|INVALID_COMMENT|INVALID_REPLY|COMMUNITY_PROFILE_REQUIRED/.test(
        String(e.message),
      )
    ) {
      commentAttempt = undefined
    }
  } finally {
    busy.value = false
  }
}
async function removeComment() {
  if (!removing.value || busy.value) return
  busy.value = true
  commentsError.value = ''
  try {
    await deleteComment(removing.value.id)
    await loadComments()
    post.value = await getCommunityPost(id)
  } catch (e) {
    commentsError.value = errorMessage(e)
  } finally {
    busy.value = false
    removing.value = undefined
  }
}
async function report() {
  if (!reporting.value || busy.value) return
  busy.value = true
  error.value = ''
  success.value = ''
  try {
    await reportContent(crypto.randomUUID(), reason.value, reporting.value)
    reporting.value = undefined
    reason.value = ''
    success.value = '举报已提交，等待管理员人工复审。'
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <RouterLink to="/community" class="back-link"><Icon name="back" :size="16" />宠友社区</RouterLink>
  <div class="page-heading">
    <div>
      <span class="eyebrow">ONE LITTLE STORY</span>
      <h1>日常里的小美好<span class="heading-dot">.</span></h1>
    </div>
  </div>
  <Notice :error="error" :success="success" /><button
    v-if="error && !post"
    class="text-button"
    @click="load"
  >
    重新加载动态
  </button>
  <p v-if="loading" role="status">正在读取动态…</p>
  <CommunityPostCard
    v-if="post"
    :post="post"
    detail
    @changed="post = $event"
    @removed="router.replace('/community')"
    @report="reporting = { post: id }"
  />
  <form v-if="reporting" class="panel community-report" @submit.prevent="report">
    <h2>举报不适宜内容</h2>
    <label
      >举报原因<textarea
        v-model="reason"
        required
        maxlength="200"
        rows="3"
        :disabled="busy"
        placeholder="请说明具体问题，便于人工复审"
      />
    </label>
    <div class="row">
      <button class="button" :disabled="busy">{{ busy ? '提交中…' : '提交举报' }}</button
      ><button type="button" class="text-button" :disabled="busy" @click="reporting = undefined">
        取消
      </button>
    </div>
  </form>
  <section v-if="post?.status === 'published'" class="panel community-comments">
    <h2>
      聊聊这份日常 <small>{{ post.comment_count }} 条</small>
    </h2>
    <Notice :error="commentsError" /><button
      v-if="commentsError"
      class="text-button"
      :disabled="commentsBusy"
      @click="loadComments()"
    >
      刷新评论
    </button>
    <form @submit.prevent="send">
      <label
        >{{ reply ? `回复 ${reply.author.nickname}` : '写下你的评论'
        }}<textarea
          v-model="body"
          required
          maxlength="500"
          rows="3"
          :readonly="busy || !!commentAttempt"
          placeholder="友善交流，让小窝更温暖。"
        />
      </label>
      <div class="row wrap">
        <button class="button" :disabled="busy">
          {{ busy ? '发表中…' : commentAttempt ? '重试这条评论' : '发表评论' }}</button
        ><button
          v-if="reply && !commentAttempt"
          type="button"
          class="text-button"
          @click="reply = undefined"
        >
          取消回复</button
        ><small class="muted">最多 500 字 · 支持一层回复</small>
      </div>
    </form>
    <p v-if="commentsBusy" role="status" class="muted">正在读取评论…</p>
    <p v-else-if="!comments.length && !commentsError" class="muted">第一句友善的话，等你来说。</p>
    <article
      v-for="c in comments"
      :id="`comment-${c.id}`"
      :key="c.id"
      class="community-comment"
      :class="{ reply: !!c.parent_id }"
    >
      <div class="row between wrap">
        <RouterLink :to="`/community/people/${c.user_id}`"
          ><strong>{{ c.author.nickname }}</strong></RouterLink
        ><time :datetime="c.created_at">{{ new Date(c.created_at).toLocaleString('zh-CN') }}</time>
      </div>
      <small v-if="c.parent_id" class="muted"
        >回复
        {{
          comments.find((parent) => parent.id === c.parent_id)?.author.nickname || '一条评论'
        }}</small
      >
      <p class="community-body">{{ c.body }}</p>
      <div class="row wrap">
        <button
          v-if="!c.parent_id"
          class="text-button"
          :disabled="busy || !!commentAttempt"
          @click="reply = c"
        >
          回复</button
        ><button
          v-if="c.user_id === session?.user.id"
          class="text-button danger-text"
          :disabled="busy"
          @click="removing = c"
        >
          删除</button
        ><button class="text-button muted" @click="reporting = { comment: c.id }">举报</button>
      </div>
    </article>
    <button
      v-if="hasMore"
      class="button secondary"
      :disabled="commentsBusy"
      @click="loadComments(true)"
    >
      加载更多评论
    </button>
  </section>
  <p v-else-if="post" class="panel community-publish-note">
    这条动态尚未公开，只有你能查看。图片需要管理员人工审核；可返回“我的动态”查看状态。
  </p>
  <p class="community-disclaimer">社区分享不构成诊疗意见，涉及症状或用药请联系线下宠物医院。</p>
  <ConfirmDialog
    v-if="removing"
    title="删除这条评论？"
    message="删除后无法恢复。如果它有回复，回复也会一起删除。"
    :busy="busy"
    danger
    @cancel="removing = undefined"
    @confirm="removeComment"
  />
</template>
