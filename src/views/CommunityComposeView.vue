<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { getPets, validateImage } from '../lib/api'
import {
  getCommunityPerson,
  createCommunityPost,
  uploadCommunityImage,
  publishCommunityPost,
} from '../lib/community'
import { userId } from '../stores/auth'
import { configured } from '../lib/supabase'
import { postSchema, parseTags } from '../../shared/community'
import type { Pet } from '../../shared/domain'
import { errorMessage } from '../lib/errors'
import Icon from '../components/Icon.vue'
import Notice from '../components/Notice.vue'
const router = useRouter(),
  body = ref(''),
  pet = ref(''),
  tagText = ref(''),
  pets = ref<Pet[]>([]),
  files = ref<File[]>([]),
  previews = ref<string[]>([]),
  busy = ref(false),
  loading = ref(true),
  ready = ref(false),
  error = ref(''),
  progress = ref(''),
  started = ref(false)
const id = crypto.randomUUID(),
  paths: string[] = []
let mounted = true,
  created = false
async function load() {
  if (!configured) {
    loading.value = false
    return
  }
  loading.value = true
  error.value = ''
  try {
    const [person, list] = await Promise.all([getCommunityPerson(userId()), getPets()])
    ready.value = !!person
    pets.value = list
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)
function release() {
  previews.value.forEach((url) => URL.revokeObjectURL(url))
  previews.value = []
}
onUnmounted(() => {
  mounted = false
  release()
})
async function choose(e: Event) {
  const input = e.target as HTMLInputElement,
    selected = Array.from(input.files || [])
  error.value = ''
  try {
    if (selected.length + files.value.length > 9) throw new Error('每条动态最多上传 9 张图片。')
    for (const file of selected) await validateImage(file)
    if (!mounted) return
    files.value.push(...selected)
    previews.value.push(...selected.map((f) => URL.createObjectURL(f)))
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    input.value = ''
  }
}
function remove(index: number) {
  URL.revokeObjectURL(previews.value[index]!)
  previews.value.splice(index, 1)
  files.value.splice(index, 1)
}
async function submit() {
  if (busy.value || !ready.value) return
  busy.value = true
  error.value = ''
  try {
    postSchema.parse(body.value)
    const tags = parseTags(tagText.value)
    for (const file of files.value) await validateImage(file)
    started.value = true
    progress.value = '正在保存这份日常…'
    await createCommunityPost(id, body.value, pet.value || undefined, tags)
    created = true
    for (let i = paths.length; i < files.value.length; i++) {
      progress.value = `正在上传第 ${i + 1} / ${files.value.length} 张图片…`
      paths.push(await uploadCommunityImage(files.value[i]!, id))
    }
    progress.value = '正在提交…'
    await publishCommunityPost(id, paths)
    router.replace(`/community/posts/${id}`)
  } catch (e) {
    error.value = errorMessage(e)
    if (
      !created &&
      e &&
      typeof e === 'object' &&
      'message' in e &&
      /CONTENT_BLOCKED|INVALID_POST|INVALID_TAGS|PET_NOT_FOUND|COMMUNITY_PROFILE_REQUIRED|COMMUNITY_RATE_LIMIT/.test(
        String(e.message),
      )
    )
      started.value = false
  } finally {
    busy.value = false
    progress.value = ''
  }
}
</script>
<template>
  <RouterLink to="/community" class="back-link"><Icon name="back" :size="16" />宠友社区</RouterLink>
  <div class="page-heading">
    <div>
      <span class="eyebrow">A MOMENT WORTH KEEPING</span>
      <h1>分享一份日常<span class="heading-dot">.</span></h1>
      <p>平凡的小瞬间，也有被喜欢的理由。</p>
    </div>
  </div>
  <Notice :error="error" />
  <p v-if="loading" role="status">正在准备发布…</p>
  <button v-if="!ready && error" class="text-button" @click="load">重新加载</button>
  <div v-else-if="!loading && !ready" class="panel empty">
    <p>请先设置社区公开昵称。</p>
    <RouterLink to="/community" class="button">开通社区主页</RouterLink>
  </div>
  <form v-else-if="ready" class="panel community-compose" @submit.prevent="submit">
    <fieldset :disabled="busy || started">
      <label
        >今天想分享什么？<textarea
          v-model="body"
          required
          maxlength="1000"
          rows="7"
          placeholder="比如：它今天终于学会握手啦…"
        />
      </label>
      <div class="community-char-count">{{ body.length }} / 1000</div>
      <label
        >日常标签（可选）<input
          v-model="tagText"
          maxlength="128"
          placeholder="例如：猫咪日常，晒太阳"
        /><small>用逗号分隔，最多 3 个，每个最多 20 字。</small></label
      >
      <label
        >这次日常的主角（可选）<select v-model="pet">
          <option value="">不选择宠物</option>
          <option v-for="p in pets" :key="p.id" :value="p.id">{{ p.name }}</option></select
        ><small>只分享所选宠物的名称，不公开档案、头像或健康记录。</small></label
      >
      <label
        >添加图片<input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          :disabled="files.length >= 9 || started || busy"
          @change="choose"
        /><small>最多 9 张，每张不超过 5 MB；支持 JPG、PNG、WebP。</small></label
      >
      <div class="compose-previews">
        <div v-for="(url, i) in previews" :key="url">
          <img :src="url" :alt="`待发布图片 ${i + 1}`" /><button
            type="button"
            :aria-label="`移除第 ${i + 1} 张图片`"
            @click="remove(i)"
          >
            <Icon name="close" :size="16" />
          </button>
        </div>
      </div>
    </fieldset>
    <p class="community-publish-note">
      配文和标签通过自动检查后发布。请确认图片适合公开分享；当前不识别图片中的文字和画面，请勿上传他人隐私或不属于你的图片。
    </p>
    <p v-if="busy" role="status">{{ progress }}</p>
    <p v-else-if="started && error" class="muted">
      本次内容已锁定，可用同一请求重试。若要改写，请返回“我的动态”核对并删除草稿后重新发布。
    </p>
    <div class="row wrap">
      <button class="button" :disabled="busy || !configured">
        {{ busy ? '提交中…' : started && error ? '重试这次提交' : '发布日常' }}</button
      ><RouterLink to="/community" class="text-button">返回社区</RouterLink>
    </div>
  </form>
</template>
