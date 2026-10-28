<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getPet, removePet } from '../lib/api'
import { configured } from '../lib/supabase'
import { errorMessage } from '../lib/errors'
import type { Pet } from '../../shared/domain'
import Icon from '../components/Icon.vue'
import Notice from '../components/Notice.vue'
import MediaImage from '../components/MediaImage.vue'
import RecordList from '../components/RecordList.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
const route = useRoute(),
  router = useRouter(),
  pet = ref<Pet>(),
  error = ref(''),
  busy = ref(false),
  confirm = ref(false),
  deleting = ref(false)
async function load() {
  if (!configured) return
  busy.value = true
  error.value = ''
  try {
    pet.value = await getPet(String(route.params.id))
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}
onMounted(load)
async function remove() {
  if (!pet.value) return
  deleting.value = true
  try {
    await removePet(pet.value.id)
    router.replace('/pets')
  } catch (e) {
    error.value = errorMessage(e)
    confirm.value = false
  } finally {
    deleting.value = false
  }
}
</script>
<template>
  <RouterLink to="/pets" class="back-link"><Icon name="back" :size="16" />我的宠物</RouterLink
  ><Notice :error="error" /><button v-if="error" class="text-button" @click="load">重新加载</button>
  <p v-if="busy" role="status">正在读取档案…</p>
  <template v-if="pet"
    ><section class="pet-profile panel">
      <MediaImage :path="pet.avatar_path" :alt="pet.name" :species="pet.species" />
      <div class="pet-profile-info">
        <span class="eyebrow">MY LITTLE COMPANION</span>
        <h1>{{ pet.name }}</h1>
        <p>
          {{ pet.breed || { cat: '猫咪', dog: '狗狗', other: '其他' }[pet.species] }} ·
          {{ { unknown: '性别未知', male: '公', female: '母' }[pet.gender] }} ·
          {{ pet.sterilized ? '已绝育' : '未绝育' }}
        </p>
        <div class="pet-facts">
          <span
            ><small>{{ pet.date_kind === 'birth' ? '出生日期' : '领养日期' }}</small
            >{{ pet.birth_date || '待记录' }}</span
          ><span><small>档案体重</small>{{ pet.weight ? `${pet.weight} kg` : '待记录' }}</span
          ><span><small>资料权限</small>仅自己可见</span>
        </div>
        <p v-if="pet.remark" class="pet-remark">{{ pet.remark }}</p>
        <div class="row wrap">
          <RouterLink :to="`/pets/${pet.id}/edit`" class="button secondary"
            ><Icon name="edit" :size="16" />编辑档案</RouterLink
          ><button class="text-button danger-text" @click="confirm = true">删除档案</button>
        </div>
      </div>
    </section>
    <div class="section-heading detail-heading">
      <h2>日常时间轴</h2>
      <div class="row wrap">
        <RouterLink :to="`/ai?pet=${pet.id}`" class="button secondary"
          ><Icon name="ai" :size="17" />问问 AI</RouterLink
        ><RouterLink :to="`/records/new?pet=${pet.id}`" class="button"
          ><Icon name="plus" :size="17" />记一笔</RouterLink
        >
      </div>
    </div>
    <section class="panel"><RecordList :pet-id="pet.id" /></section>
    <ConfirmDialog
      v-if="confirm"
      title="确定删除这个小窝？"
      :message="`将永久删除 ${pet.name} 的档案、全部日常记录、AI 会话与调用日志，关联图片进入清理队列。每日已消耗的 AI 额度不返还。此操作无法恢复。`"
      :busy="deleting"
      danger
      @cancel="confirm = false"
      @confirm="remove"
  /></template>
</template>
