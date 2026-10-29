<script setup lang="ts">
/**
 * 私有对象路径的短时签名图片，支持 pet-media/community-media。
 * 签名有效 5 分钟，本组件每 4 分钟刷新；卸载释放定时器并使未完成响应失效。
 */
import { ref, watch, onUnmounted } from 'vue'
import { signedImage } from '../lib/api'
import Icon from './Icon.vue'
const props = defineProps<{
  path?: string | null
  alt: string
  species?: string
  bucket?: 'pet-media' | 'community-media'
}>()
const url = ref(''),
  failed = ref(false)
let revision = 0
/**
 * 重新申请签名并只接受最新版本的响应；路径改变或卸载后旧签名不能覆盖新图片。
 */
async function refresh() {
  const version = ++revision
  if (!props.path) {
    url.value = ''
    return
  }
  try {
    const next = await signedImage(props.path, props.bucket)
    if (version === revision) {
      url.value = next
      failed.value = false
    }
  } catch {
    if (version === revision) failed.value = true
  }
}
watch([() => props.path, () => props.bucket], refresh, { immediate: true })
const timer = setInterval(refresh, 240000)
onUnmounted(() => {
  clearInterval(timer)
  revision++
})
</script>
<template>
  <div class="media-image" :class="species">
    <img v-if="url && !failed" :src="url" :alt="alt" loading="lazy" @error="failed = true" />
    <div v-else class="media-placeholder">
      <Icon name="paw" :size="44" /><span v-if="failed">图片暂不可用</span>
    </div>
  </div>
</template>
