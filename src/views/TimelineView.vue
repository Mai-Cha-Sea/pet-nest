<script setup lang="ts">
/**
 * 按本人宠物选择的时间轴入口，类型筛选和分页复用 RecordList。
 * URL 的 pet 只是预选值，需与真实宠物列表核对后使用。
 */
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { getPets } from '../lib/api'
import { configured } from '../lib/supabase'
import { errorMessage } from '../lib/errors'
import type { Pet } from '../../shared/domain'
import RecordList from '../components/RecordList.vue'
import Notice from '../components/Notice.vue'
const pets = ref<Pet[]>([]),
  petId = ref(String(useRoute().query.pet || '')),
  error = ref(''),
  busy = ref(false)
/**
 * 读取可访问宠物并校正 URL 选择；记录查询由 RecordList 按 petId 执行。
 */
async function load() {
  if (!configured) return
  busy.value = true
  try {
    pets.value = await getPets()
    if (!pets.value.some((p) => p.id === petId.value)) petId.value = pets.value[0]?.id || ''
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}
onMounted(load)
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">EVERYDAY MEMORIES</span>
      <h1>日常时间轴<span class="heading-dot">.</span></h1>
      <p>把照顾它的每一步，串成温柔的日常。</p>
    </div>
    <RouterLink to="/records/new" class="button">记一笔</RouterLink>
  </div>
  <Notice :error="error" /><button v-if="error" class="text-button" @click="load">重新加载</button>
  <p v-if="busy">正在读取宠物…</p>
  <section v-else class="panel">
    <label class="pet-select"
      >查看谁的日常？<select v-model="petId">
        <option value="" disabled>选择宠物</option>
        <option v-for="pet in pets" :key="pet.id" :value="pet.id">{{ pet.name }}</option>
      </select></label
    ><RecordList v-if="petId" :key="petId" :pet-id="petId" />
    <div v-else class="empty small">
      <h3>还没有可以回看的日常</h3>
      <p>先创建宠物档案，再为它记录第一天。</p>
      <RouterLink to="/pets/new" class="button secondary">创建档案</RouterLink>
    </div>
  </section>
</template>
