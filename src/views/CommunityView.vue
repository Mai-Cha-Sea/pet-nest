<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { getCommunityPerson, saveCommunityProfile } from '../lib/community'
import type { CommunityPerson, FeedMode } from '../../shared/community'
import { userId } from '../stores/auth'
import { configured } from '../lib/supabase'
import { errorMessage } from '../lib/errors'
import Icon from '../components/Icon.vue'
import Notice from '../components/Notice.vue'
import CommunityFeed from '../components/CommunityFeed.vue'
const mode = ref<FeedMode>('recommend'),
  person = ref<CommunityPerson | null>(null),
  nickname = ref(''),
  error = ref(''),
  loading = ref(true),
  busy = ref(false),
  editing = ref(false),
  revision = ref(0)
async function load() {
  if (!configured) {
    loading.value = false
    return
  }
  loading.value = true
  error.value = ''
  try {
    person.value = await getCommunityPerson(userId())
    nickname.value = person.value?.nickname || ''
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)
async function save() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await saveCommunityProfile(nickname.value)
    await load()
    editing.value = false
    revision.value++
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
      <span class="eyebrow">LITTLE MOMENTS, SHARED</span>
      <h1>宠友社区<span class="heading-dot">.</span></h1>
      <p>和懂你的人，分享有它的每一天。</p>
    </div>
    <RouterLink v-if="person" to="/community/new" class="button"
      ><Icon name="plus" :size="18" />分享日常</RouterLink
    >
  </div>
  <Notice :error="error" /><button v-if="error" class="text-button" @click="load">
    重新读取社区资料
  </button>
  <section v-if="!loading && (!person || editing)" class="panel community-onboard">
    <h2>{{ person ? '修改社区昵称' : '用一个昵称，认识新宠友' }}</h2>
    <p>
      这个昵称及你主动发布的内容对已登录的宠友可见。邮箱、手机号、私有头像、宠物档案和健康记录不会公开。
    </p>
    <form class="community-profile-form" @submit.prevent="save">
      <label
        >社区公开昵称<input
          v-model="nickname"
          required
          maxlength="32"
          placeholder="给社区里的自己取个名字"
          :disabled="busy" /></label
      ><button class="button" :disabled="busy || !configured">
        {{ busy ? '保存中…' : person ? '保存社区昵称' : '开通社区主页' }}</button
      ><button v-if="person" type="button" class="text-button" @click="editing = false">
        取消
      </button>
    </form>
  </section>
  <div v-else-if="person" class="community-identity row wrap">
    <RouterLink :to="`/community/people/${person.user_id}`"
      ><strong>{{ person.nickname }}</strong> · 我的社区主页</RouterLink
    ><button class="text-button" @click="editing = true">修改公开昵称</button>
  </div>
  <div class="filter-row community-tabs" aria-label="社区信息流">
    <button
      v-for="(label, key) in {
        recommend: '推荐',
        following: '关注',
        favorites: '我的收藏',
        mine: '我的动态',
      }"
      :key="key"
      :aria-pressed="mode === key"
      :class="{ active: mode === key }"
      @click="mode = key"
    >
      {{ label }}
    </button>
  </div>
  <CommunityFeed :mode="mode" :revision="revision" />
  <p class="community-disclaimer">
    社区内容为用户分享，仅供交流，不构成诊疗意见。身体不适或用药问题请联系线下宠物医院。
  </p>
</template>
