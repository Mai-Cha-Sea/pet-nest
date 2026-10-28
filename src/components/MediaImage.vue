<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import { signedImage } from '../lib/api'
import Icon from './Icon.vue'
const props = defineProps<{ path?: string | null; alt: string; species?: string }>()
const url = ref(''),
  failed = ref(false)
let revision = 0
async function refresh() {
  const version = ++revision
  if (!props.path) {
    url.value = ''
    return
  }
  try {
    const next = await signedImage(props.path)
    if (version === revision) {
      url.value = next
      failed.value = false
    }
  } catch {
    if (version === revision) failed.value = true
  }
}
watch(() => props.path, refresh, { immediate: true })
const timer = setInterval(refresh, 240000)
onUnmounted(() => {
  clearInterval(timer)
  revision++
})
</script>
<template>
  <div class="media-image" :class="species">
    <img v-if="url && !failed" :src="url" :alt="alt" @error="failed = true" />
    <div v-else class="media-placeholder">
      <Icon name="paw" :size="44" /><span v-if="failed">图片暂不可用</span>
    </div>
  </div>
</template>
