<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue'
import { getWeightRecords } from '../lib/api'
import { growthDays, weightPlot, weightPoints, type GrowthPeriod } from '../../shared/growth'
import type { PetRecord } from '../../shared/domain'
import { errorMessage } from '../lib/errors'
import Notice from './Notice.vue'
import Icon from './Icon.vue'
const props = defineProps<{ petId: string; revision?: number }>()
const period = ref<GrowthPeriod>('month'),
  records = ref<PetRecord[]>([]),
  busy = ref(false),
  error = ref(''),
  limited = ref(false)
const points = computed(() => weightPoints(records.value)),
  plot = computed(() => weightPlot(points.value))
const difference = computed(() =>
  (points.value.at(-1)!.weight - points.value[0]!.weight).toFixed(2),
)
const date = (time: number) =>
  new Date(time).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
let version = 0
async function load() {
  const current = ++version
  busy.value = true
  error.value = ''
  records.value = []
  try {
    const data = await getWeightRecords(props.petId, growthDays[period.value])
    if (current === version) {
      records.value = data.records
      limited.value = data.limited
    }
  } catch (e) {
    if (current === version) error.value = errorMessage(e)
  } finally {
    if (current === version) busy.value = false
  }
}
watch([() => props.petId, () => props.revision, period], load, { immediate: true })
onUnmounted(() => {
  version++
})
</script>
<template>
  <section class="panel growth-panel" aria-labelledby="growth-title">
    <div class="section-heading wrap">
      <div>
        <span class="eyebrow">GROWING TOGETHER</span>
        <h2 id="growth-title">体重成长曲线</h2>
      </div>
      <div class="filter-row" aria-label="体重时间范围">
        <button
          v-for="(label, key) in { week: '近一周', month: '近一月', year: '近一年' }"
          :key="key"
          :aria-pressed="period === key"
          :class="{ active: period === key }"
          @click="period = key"
        >
          {{ label }}
        </button>
      </div>
    </div>
    <Notice :error="error" /><button v-if="error" class="text-button" @click="load">
      重新加载曲线
    </button>
    <p v-if="busy" role="status" class="muted">正在读取体重记录…</p>
    <div v-else-if="!error && points.length < 3" class="empty small">
      <Icon name="weight" :size="32" />
      <h3>让成长，慢慢连成一条线</h3>
      <p>所选时间内有 {{ points.length }} 条体重记录，至少 3 条后展示曲线。</p>
      <RouterLink :to="`/records/new?pet=${petId}&type=weight`" class="button secondary"
        >记录一次体重</RouterLink
      >
    </div>
    <template v-else-if="!error && points.length >= 3">
      <div class="growth-summary">
        <strong>{{ points.at(-1)!.weight }} <small>kg</small></strong
        ><span
          >本范围变化 {{ Number(difference) > 0 ? '+' : '' }}{{ difference }} kg ·
          {{ points.length }} 次记录</span
        >
      </div>
      <svg
        class="weight-chart"
        viewBox="0 0 632 224"
        role="img"
        aria-label="体重随时间变化折线图，单位千克；下方可展开查看完整数值"
      >
        <g v-for="tick in plot.ticks" :key="tick.y">
          <line x1="52" x2="600" :y1="tick.y" :y2="tick.y" class="chart-grid" />
          <text x="43" :y="tick.y + 4" text-anchor="end">{{ tick.label }}</text>
        </g>
        <polyline :points="plot.dots.map((d) => `${d.x},${d.y}`).join(' ')" class="chart-line" />
        <circle
          v-for="point in plot.dots"
          :key="point.id"
          :cx="point.x"
          :cy="point.y"
          r="3.5"
          class="chart-dot"
        >
          <title>{{ new Date(point.time).toLocaleString('zh-CN') }}：{{ point.weight }} kg</title>
        </circle>
        <text x="52" y="214">{{ date(points[0]!.time) }}</text>
        <text x="600" y="214" text-anchor="end">{{ date(points.at(-1)!.time) }}</text>
      </svg>
      <details class="growth-data">
        <summary>查看 {{ points.length }} 条原始数值</summary>
        <div class="growth-table">
          <table>
            <thead>
              <tr>
                <th>记录时间</th>
                <th>体重（kg）</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in points" :key="p.id">
                <td>{{ new Date(p.time).toLocaleString('zh-CN') }}</td>
                <td>{{ p.weight }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
      <p v-if="limited" class="muted">本范围记录较多，展示最新 2000 条，请缩短时间范围查看。</p>
      <p class="muted growth-note">
        仅展示实际体重记录，不使用档案体重补点。曲线用于日常观察，不能用于诊断。
      </p>
    </template>
  </section>
</template>
