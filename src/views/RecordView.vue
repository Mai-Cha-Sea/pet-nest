<script setup lang="ts">
/**
 * 六类日常记录表单；文字记录先保存，异常图片随后上传关联。
 * saved/partial 保留部分成功结果，图片失败重试不能再插入一条文字记录。
 */
import { ref, reactive, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getPets, addRecord, attachRecordImages, validateImage } from '../lib/api'
import { configured } from '../lib/supabase'
import { errorMessage } from '../lib/errors'
import { recordTypes, recordLabels, validateRecord } from '../../shared/domain'
import type { Pet, PetRecord, RecordType } from '../../shared/domain'
import Icon from '../components/Icon.vue'
import Notice from '../components/Notice.vue'
const route = useRoute(),
  router = useRouter(),
  pets = ref<Pet[]>([]),
  petId = ref(String(route.query.pet || '')),
  type = ref<RecordType>(
    recordTypes.includes(route.query.type as RecordType)
      ? (route.query.type as RecordType)
      : 'feeding',
  ),
  busy = ref(false),
  loading = ref(false),
  error = ref(''),
  files = ref<File[]>([]),
  saved = ref<PetRecord>(),
  partial = ref(false)
/**
 * datetime-local 使用本地墙钟时间；提交时再转 ISO，不能直接把 UTC 字符串填入控件。
 */
const now = new Date()
now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
const occurred = ref(now.toISOString().slice(0, 16))
/**
 * 固定本条记录的幂等键；文字保存与图片重试共享 saved 状态。
 */
const createId = crypto.randomUUID()
const form = reactive({
  food: '',
  amount: undefined as number | undefined,
  unit: 'g',
  weight: undefined as number | undefined,
  kind: 'both',
  name: '',
  dosage: '',
  description: '',
  note: '',
})
/**
 * 加载本人宠物并核对 URL 预选值，无有效选择时使用列表首项。
 */
async function load() {
  if (!configured) return
  loading.value = true
  try {
    pets.value = await getPets()
    if (!pets.value.some((p) => p.id === petId.value)) petId.value = pets.value[0]?.id || ''
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)
/**
 * 检查最多 9 张异常图片；任一文件失败则清空本次选择。
 */
async function choose(e: Event) {
  error.value = ''
  const list = Array.from((e.target as HTMLInputElement).files || [])
  try {
    if (list.length > 9) throw new Error('最多选择 9 张图片。')
    for (const f of list) await validateImage(f)
    files.value = list
  } catch (e) {
    error.value = errorMessage(e)
    files.value = []
  }
}
/**
 * 按所选类型只组装对应字段；用药剂量是用户原始记录，不在此生成建议。
 */
function content(): Record<string, unknown> {
  switch (type.value) {
    case 'feeding':
      return { food: form.food, amount: form.amount, unit: form.unit }
    case 'weight':
      return { weight: form.weight }
    case 'deworming':
      return { kind: form.kind, note: form.note }
    case 'bath':
      return { note: form.note }
    case 'medication':
      return { name: form.name, dosage: form.dosage, note: form.note }
    case 'incident':
      return { description: form.description }
  }
}
/**
 * 本地时间转 ISO 后验证，先保存文字再关联异常图片。
 * 部分成功保留 saved，使重试只完成图片步骤，并明确提示文字记录已存在。
 */
async function submit() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    if (!petId.value) throw new Error('请先选择宠物。')
    const at = new Date(occurred.value).toISOString()
    validateRecord(type.value, content(), at, type.value === 'incident' ? files.value.length : 0)
    if (!saved.value)
      saved.value = await addRecord(petId.value, type.value, content(), at, createId)
    if (type.value === 'incident' && files.value.length)
      await attachRecordImages(saved.value, files.value)
    await router.replace(`/pets/${petId.value}`)
  } catch (e) {
    partial.value = !!saved.value
    error.value =
      (partial.value
        ? '文字记录已保存，图片上传未完成。可重试上传，或前往档案查看已保存的记录。'
        : '') + errorMessage(e)
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <RouterLink to="/pets" class="back-link"><Icon name="back" :size="16" />返回小窝</RouterLink>
  <div class="page-heading">
    <div>
      <span class="eyebrow">THE LITTLE THINGS MATTER</span>
      <h1>记下今天的小日常<span class="heading-dot">.</span></h1>
      <p>每一个微小的变化，都是了解它多一点的机会。</p>
    </div>
  </div>
  <section class="panel form-panel">
    <Notice :error="error" /><button v-if="error && !pets.length" class="text-button" @click="load">
      重新加载宠物
    </button>
    <p v-if="loading">正在读取宠物…</p>
    <div v-else-if="configured && !pets.length && !error" class="empty small">
      <Icon name="paw" :size="36" />
      <h3>先给它创建一份档案吧</h3>
      <RouterLink to="/pets/new" class="button">添加宠物</RouterLink>
    </div>
    <form v-else @submit.prevent="submit">
      <fieldset :disabled="busy || partial">
        <label
          >这是哪位小朋友的日常？<select v-model="petId" required>
            <option disabled value="">选择宠物</option>
            <option v-for="pet in pets" :key="pet.id" :value="pet.id">{{ pet.name }}</option>
          </select></label
        ><span class="field-label">记录类型</span>
        <div class="record-type-grid">
          <button
            v-for="t in recordTypes"
            :key="t"
            type="button"
            :class="{ active: type === t }"
            @click="type = t"
          >
            <Icon :name="t" />{{ recordLabels[t] }}
          </button>
        </div>
        <label>发生时间<input v-model="occurred" type="datetime-local" required /></label
        ><template v-if="type === 'feeding'"
          ><label
            >粮型 / 食物<input
              v-model="form.food"
              required
              maxlength="100"
              placeholder="如：成猫干粮"
          /></label>
          <div class="form-grid">
            <label
              >喂食量<input
                v-model.number="form.amount"
                type="number"
                min="0.001"
                max="100000"
                step="any"
                required /></label
            ><label
              >单位<select v-model="form.unit">
                <option value="g">克（g）</option>
                <option value="ml">毫升（ml）</option>
              </select></label
            >
          </div></template
        ><label v-if="type === 'weight'"
          >体重（kg）<input
            v-model.number="form.weight"
            type="number"
            min="0.001"
            max="1000"
            step="0.001"
            required /></label
        ><label v-if="type === 'deworming'"
          >驱虫类型<select v-model="form.kind">
            <option value="internal">体内驱虫</option>
            <option value="external">体外驱虫</option>
            <option value="both">内外驱虫</option>
          </select></label
        ><template v-if="type === 'medication'"
          ><p class="notice">
            仅记录已由你或线下兽医确定的用药信息。AI 不提供药品品牌、剂量或处方建议。
          </p>
          <label>药品名称<input v-model="form.name" required maxlength="100" /></label
          ><label
            >实际使用剂量<input
              v-model="form.dosage"
              required
              maxlength="100"
              placeholder="如实填写兽医要求或实际使用情况" /></label></template
        ><template v-if="type === 'incident'"
          ><label
            >异常描述<textarea
              v-model="form.description"
              required
              maxlength="2000"
              rows="5"
              placeholder="发生了什么？持续多久？请尽量客观记录。"
            ></textarea></label
          ><label
            >图片（可选，最多 9 张）<input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              @change="choose"
            /><small>{{
              files.length
                ? `已选择 ${files.length} 张`
                : '每张最大 5 MB，图片仅自己可见。AI 当前只读取文字记录。'
            }}</small></label
          ></template
        ><label v-else-if="type !== 'feeding' && type !== 'weight'"
          >备注<textarea v-model="form.note" maxlength="500" rows="3"></textarea>
        </label>
      </fieldset>
      <div class="actions">
        <RouterLink :to="petId ? `/pets/${petId}` : '/pets'" class="button secondary">{{
          partial ? '查看已保存记录' : '取消'
        }}</RouterLink
        ><button class="button" :disabled="busy || !configured || !pets.length">
          {{ busy ? '正在保存…' : partial ? '重试上传图片' : '保存这条记录'
          }}<Icon name="check" :size="17" />
        </button>
      </div>
    </form>
  </section>
</template>
