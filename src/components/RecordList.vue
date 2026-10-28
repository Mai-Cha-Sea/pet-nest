<script setup lang="ts">
import { ref, watch } from 'vue'
import type { RecordType, PetRecord } from '../../shared/domain'
import { recordTypes, recordLabels, recordSummary } from '../../shared/domain'
import { getRecords, removeRecord } from '../lib/api'
import { errorMessage } from '../lib/errors'
import Icon from './Icon.vue'
import Notice from './Notice.vue'
import MediaImage from './MediaImage.vue'
import ConfirmDialog from './ConfirmDialog.vue'
const props = defineProps<{ petId: string }>()
const filter = ref<RecordType | ''>(''),
  records = ref<PetRecord[]>([]),
  busy = ref(false),
  error = ref(''),
  hasMore = ref(false),
  deleting = ref<PetRecord | null>(null),
  deletingBusy = ref(false)
let generation = 0
async function load(more = false) {
  const current = ++generation
  busy.value = true
  error.value = ''
  try {
    const result = await getRecords(
      props.petId,
      filter.value || undefined,
      more ? records.value.length : 0,
    )
    if (current === generation) {
      records.value = more ? [...records.value, ...result] : result
      hasMore.value = result.length === 50
    }
  } catch (e) {
    if (current === generation) error.value = errorMessage(e)
  } finally {
    if (current === generation) busy.value = false
  }
}
watch(
  [() => props.petId, filter],
  () => {
    records.value = []
    load()
  },
  { immediate: true },
)
async function confirmDelete() {
  if (!deleting.value) return
  deletingBusy.value = true
  try {
    await removeRecord(deleting.value.id)
    deleting.value = null
    await load()
  } catch (e) {
    error.value = errorMessage(e)
    deleting.value = null
  } finally {
    deletingBusy.value = false
  }
}
const date = (v: string) =>
  new Date(v).toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
</script>
<template>
  <div class="timeline">
    <div class="filter-row" aria-label="记录类型筛选">
      <button :class="{ active: !filter }" @click="filter = ''">全部记录</button
      ><button
        v-for="type in recordTypes"
        :key="type"
        :class="{ active: filter === type }"
        @click="filter = type"
      >
        {{ recordLabels[type] }}
      </button>
    </div>
    <Notice :error="error" /><button v-if="error" class="text-button" @click="load()">
      重新加载
    </button>
    <p v-if="busy && !records.length" class="muted" role="status">正在读取记录…</p>
    <div v-else-if="!records.length && !error" class="empty small">
      <Icon name="leaf" :size="32" />
      <h3>日常的小事，也值得记住</h3>
      <p>从一顿饭、一次称重开始，留下照顾它的足迹。</p>
      <RouterLink :to="`/records/new?pet=${petId}`" class="button secondary">记下第一条</RouterLink>
    </div>
    <article v-for="record in records" :key="record.id" class="timeline-item">
      <div class="record-icon" :class="record.type"><Icon :name="record.type" /></div>
      <div class="record-body">
        <div class="row between">
          <strong>{{ recordLabels[record.type] }}</strong
          ><button
            class="icon-button"
            :aria-label="`删除${recordLabels[record.type]}记录`"
            @click="deleting = record"
          >
            <Icon name="trash" :size="16" />
          </button>
        </div>
        <p>{{ recordSummary(record) }}</p>
        <div v-if="record.image_paths.length" class="record-images">
          <MediaImage
            v-for="(path, i) in record.image_paths"
            :key="path"
            :path="path"
            :alt="`异常图片 ${i + 1}`"
          />
        </div>
        <time :datetime="record.occurred_at">{{ date(record.occurred_at) }}</time>
      </div>
    </article>
    <button v-if="hasMore" class="button secondary" :disabled="busy" @click="load(true)">
      {{ busy ? '正在加载…' : '加载更多' }}</button
    ><ConfirmDialog
      v-if="deleting"
      title="删除这条记录？"
      message="删除后无法恢复，关联图片也会进入清理队列。"
      :busy="deletingBusy"
      danger
      @cancel="deleting = null"
      @confirm="confirmDelete"
    />
  </div>
</template>
