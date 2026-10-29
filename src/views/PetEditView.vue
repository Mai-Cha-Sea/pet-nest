<script setup lang="ts">
/**
 * 共用的创建/编辑表单；编辑需确认，头像上传在档案写入成功后进行。
 * createId 维持新增重试幂等，savedId 避免头像失败后重复创建宠物。
 */
import { ref, reactive, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getPet, savePet, uploadAvatar, validateImage } from '../lib/api'
import { configured } from '../lib/supabase'
import { errorMessage } from '../lib/errors'
import { petSchema } from '../../shared/domain'
import type { PetInput } from '../../shared/domain'
import Icon from '../components/Icon.vue'
import Notice from '../components/Notice.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
const route = useRoute(),
  router = useRouter(),
  id = computed(() => (route.params.id ? String(route.params.id) : undefined)),
  busy = ref(false),
  loading = ref(false),
  error = ref(''),
  confirm = ref(false),
  file = ref<File>(),
  savedId = ref<string>(),
  loadFailed = ref(false)
const form = reactive<PetInput>({
  name: '',
  species: 'cat',
  breed: '',
  gender: 'unknown',
  date_kind: 'birth',
  birth_date: '',
  weight: null,
  sterilized: false,
  remark: '',
})
/**
 * 在页面创建时固定新增 UUID，网络重试不能生成第二个宠物 ID。
 */
const createId = crypto.randomUUID()
/**
 * 编辑模式回填真实档案；读取失败用 loadFailed 阻止把空表单覆盖原数据。
 */
async function load() {
  if (!id.value || !configured) return
  loading.value = true
  loadFailed.value = false
  try {
    const p = await getPet(id.value)
    Object.assign(form, { ...p, birth_date: p.birth_date || '' })
  } catch (e) {
    error.value = errorMessage(e)
    loadFailed.value = true
  } finally {
    loading.value = false
  }
}
onMounted(load)
/**
 * 预检单张头像文件，非法选择清除待上传文件并提示。
 */
async function choose(e: Event) {
  error.value = ''
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  try {
    await validateImage(f)
    file.value = f
  } catch (e) {
    error.value = errorMessage(e)
    file.value = undefined
  }
}
/**
 * 先校验输入；已有档案需确认，新建直接进入提交。
 */
function requestSave() {
  try {
    petSchema.parse(form)
    if (id.value) confirm.value = true
    else void submit()
  } catch (e) {
    error.value = errorMessage(e)
  }
}
/**
 * 保存档案后再上传头像。savedId 表示档案已持久化，之后重试只更新该档案。
 */
async function submit() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const p = await savePet(form, id.value || savedId.value, createId)
    savedId.value = p.id
    if (file.value) await uploadAvatar(file.value, p.id)
    await router.replace(`/pets/${p.id}`)
  } catch (e) {
    error.value =
      (savedId.value ? '档案已保存，头像未完成；重试会更新同一档案。' : '') + errorMessage(e)
  } finally {
    busy.value = false
    confirm.value = false
  }
}
</script>
<template>
  <RouterLink :to="id ? `/pets/${id}` : '/pets'" class="back-link"
    ><Icon name="back" :size="16" />返回{{ id ? '档案' : '我的宠物' }}</RouterLink
  >
  <div class="page-heading">
    <div>
      <span class="eyebrow">A HOME OF THEIR OWN</span>
      <h1>{{ id ? '编辑宠物档案' : '认识家里的新成员' }}<span class="heading-dot">.</span></h1>
      <p>填下它的小小资料，开启有迹可循的陪伴。</p>
    </div>
  </div>
  <section class="panel form-panel">
    <Notice :error="error" />
    <p v-if="loading">正在读取档案…</p>
    <button v-if="loadFailed" class="button secondary" @click="load">重试加载</button>
    <form v-else-if="!loading" @submit.prevent="requestSave">
      <div class="form-grid">
        <label
          >宠物名称 <span class="required">*</span
          ><input v-model="form.name" required maxlength="32" placeholder="它叫什么名字？" /></label
        ><label
          >物种<select v-model="form.species">
            <option value="cat">猫咪</option>
            <option value="dog">狗狗</option>
            <option value="other">其他</option>
          </select></label
        ><label
          >品种<input v-model="form.breed" maxlength="64" placeholder="如：中华田园猫" /></label
        ><label
          >性别<select v-model="form.gender">
            <option value="unknown">未知</option>
            <option value="male">公</option>
            <option value="female">母</option>
          </select></label
        ><label
          >日期类型<select v-model="form.date_kind">
            <option value="birth">出生日期</option>
            <option value="adoption">领养日期</option>
          </select></label
        ><label
          >{{ form.date_kind === 'birth' ? '出生' : '领养' }}日期<input
            v-model="form.birth_date"
            type="date"
            :max="new Date().toLocaleDateString('en-CA')" /></label
        ><label
          >档案体重（kg）<input
            v-model.number="form.weight"
            type="number"
            min="0.001"
            max="1000"
            step="0.001"
            placeholder="可暂不填写"
            @change="form.weight = typeof form.weight === 'number' ? form.weight : null" /></label
        ><label
          >绝育状态<select v-model="form.sterilized">
            <option :value="false">未绝育</option>
            <option :value="true">已绝育</option>
          </select></label
        >
      </div>
      <span class="field-label">头像</span
      ><label class="file-picker"
        ><Icon name="image" />{{ file?.name || '选择 JPG / PNG / WebP 图片，最大 5 MB'
        }}<input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-label="上传宠物头像"
          @change="choose" /></label
      ><label
        >备注<textarea
          v-model="form.remark"
          rows="4"
          maxlength="1000"
          placeholder="性格、过敏史，或其他需要记住的小事…"
        ></textarea>
      </label>
      <p class="privacy-line">
        <Icon
          name="deworming"
          :size="15"
        />这份档案仅你自己可见。体重日常变化请在「体重记录」中记录。
      </p>
      <div class="actions">
        <RouterLink :to="id ? `/pets/${id}` : '/pets'" class="button secondary">取消</RouterLink
        ><button class="button" :disabled="busy || !configured">
          {{ busy ? '正在保存…' : '保存档案' }}<Icon name="check" :size="17" />
        </button>
      </div>
    </form>
  </section>
  <ConfirmDialog
    v-if="confirm"
    title="保存档案修改？"
    message="新的资料将用于之后的 AI 养护参考。原有日常记录不会被修改。"
    :busy="busy"
    @cancel="confirm = false"
    @confirm="submit"
  />
</template>
