<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { getPets, getProfile } from '../lib/api'
import { configured } from '../lib/supabase'
import { errorMessage } from '../lib/errors'
import type { Pet } from '../../shared/domain'
import Icon from '../components/Icon.vue'
import MediaImage from '../components/MediaImage.vue'
import Notice from '../components/Notice.vue'
import NestIllustration from '../components/NestIllustration.vue'
const pets = ref<Pet[]>([]),
  busy = ref(false),
  error = ref('')
const name = ref('养宠的你')
async function load() {
  if (!configured) return
  busy.value = true
  error.value = ''
  try {
    const [list, profile] = await Promise.all([getPets(), getProfile()])
    pets.value = list
    name.value = profile.nickname
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}
onMounted(load)
function age(p: Pet) {
  if (!p.birth_date) return '年龄待记录'
  if (p.date_kind === 'adoption') return `领养于 ${p.birth_date}`
  const months = Math.max(0, Math.floor((Date.now() - Date.parse(p.birth_date)) / 2629800000))
  return months >= 12 ? `${Math.floor(months / 12)} 岁 ${months % 12} 个月` : `${months} 个月`
}
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">OUR LITTLE FAMILY</span>
      <h1>我的宠物<span class="heading-dot">.</span></h1>
      <p>记录每一天的陪伴，照顾每一份小小的健康。</p>
    </div>
    <RouterLink to="/pets/new" class="button" :aria-disabled="pets.length >= 10"
      ><Icon name="plus" :size="18" />添加宠物</RouterLink
    >
  </div>
  <section class="welcome-card">
    <div class="welcome-copy">
      <span class="welcome-tag"><span class="status-dot"></span>陪伴，是最好的照顾</span>
      <h2>你好，{{ name }}<br />今天也要好好爱它们。</h2>
      <p>一顿好好吃的饭，一次细心的观察，<br />都在为它的小小世界，积攒大大的安心。</p>
      <RouterLink to="/records/new" class="hero-link"
        >记录今天的小日常 <Icon name="arrow" :size="17"
      /></RouterLink>
    </div>
    <NestIllustration />
  </section>
  <div class="dashboard-layout">
    <section>
      <div class="section-heading">
        <h2>
          家里的小成员 <span class="count-pill">{{ pets.length }} / 10</span>
        </h2>
        <span class="muted compact">每个小家伙，都有专属档案</span>
      </div>
      <Notice :error="error" /><button v-if="error" class="text-button" @click="load">
        重新加载
      </button>
      <p v-if="busy" class="muted" role="status">正在打开小窝…</p>
      <div v-else-if="!pets.length && !error" class="empty pets-empty">
        <div class="empty-icon"><Icon name="paw" :size="32" /></div>
        <h3>给它安一个小窝吧</h3>
        <p>从名字、生日到每一天的健康，<br />把关于它的小事，认真记下来。</p>
        <RouterLink to="/pets/new" class="button secondary"
          ><Icon name="plus" :size="16" />创建第一份档案</RouterLink
        ><span class="empty-foot">可添加猫咪、狗狗和其他可爱的小伙伴</span>
      </div>
      <div v-else class="pet-grid">
        <RouterLink v-for="pet in pets" :key="pet.id" :to="`/pets/${pet.id}`" class="pet-card"
          ><MediaImage :path="pet.avatar_path" :alt="pet.name" :species="pet.species" />
          <div class="pet-card-content">
            <div class="row between">
              <h3>{{ pet.name }}</h3>
              <span class="pet-sex">{{
                pet.gender === 'male' ? '♂' : pet.gender === 'female' ? '♀' : '♡'
              }}</span>
            </div>
            <p>
              {{ pet.breed || { cat: '猫咪', dog: '狗狗', other: '其他小伙伴' }[pet.species] }} ·
              {{ age(pet) }}
            </p>
            <div class="pet-card-footer">
              <span>{{ pet.weight ? `${pet.weight} kg` : '体重待记录' }}</span
              ><span>查看档案 <Icon name="right" :size="14" /></span>
            </div></div></RouterLink
        ><RouterLink v-if="pets.length < 10" to="/pets/new" class="add-pet-card"
          ><Icon name="plus" :size="28" /><span>迎接新成员</span></RouterLink
        >
      </div>
      <section class="daily-strip">
        <div class="daily-leaf"><Icon name="leaf" :size="25" /></div>
        <div>
          <strong>把关心，变成一个小习惯</strong>
          <p>保持记录，让细微的变化也能被看见。</p>
        </div>
        <RouterLink to="/timeline" class="text-button"
          >查看记录 <Icon name="arrow" :size="15"
        /></RouterLink>
      </section>
    </section>
    <aside class="right-column">
      <section class="panel quick-panel">
        <div class="section-heading">
          <h2>随手记一笔</h2>
          <Icon name="edit" :size="17" />
        </div>
        <p class="muted compact">小事认真记，照顾更安心</p>
        <div class="quick-grid">
          <RouterLink
            v-for="item in [
              { type: 'feeding', name: '喂食' },
              { type: 'weight', name: '体重' },
              { type: 'deworming', name: '驱虫' },
              { type: 'bath', name: '洗澡' },
              { type: 'medication', name: '用药' },
              { type: 'incident', name: '异常' },
            ]"
            :key="item.type"
            :to="`/records/new?type=${item.type}`"
            ><span class="quick-icon" :class="item.type"><Icon :name="item.type" :size="22" /></span
            >{{ item.name }}</RouterLink
          >
        </div>
      </section>
      <section class="ai-promo">
        <div class="row between">
          <span class="ai-mark"><Icon name="ai" :size="22" /></span
          ><span class="outline-tag">专属健康参考</span>
        </div>
        <h3>多了解它一点</h3>
        <p>结合档案与近期记录，<br />聊聊你关心的养护问题。</p>
        <RouterLink to="/ai">问问 AI 助手 <Icon name="arrow" :size="17" /></RouterLink
        ><span class="ai-promo-note">养护建议仅供参考，不替代兽医诊疗</span>
      </section>
    </aside>
  </div>
</template>
