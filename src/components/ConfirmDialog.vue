<script setup lang="ts">
/**
 * 基于原生 dialog 的确认层，父组件通过挂载/卸载控制显示。
 * confirm/cancel 只通知父组件；busy 阻止取消或重复确认；useId 为多实例生成独立无障碍标识。
 */
import { onMounted, ref, useId } from 'vue'
defineProps<{ title: string; message: string; busy?: boolean; danger?: boolean }>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()
const dialog = ref<HTMLDialogElement>()
const labelId = useId(),
  descriptionId = useId()
onMounted(() => dialog.value?.showModal())
</script>
<template>
  <dialog
    ref="dialog"
    class="confirm-dialog"
    :aria-labelledby="labelId"
    :aria-describedby="descriptionId"
    @cancel.prevent="!busy && emit('cancel')"
  >
    <h2 :id="labelId">{{ title }}</h2>
    <p :id="descriptionId">{{ message }}</p>
    <div class="actions">
      <button :disabled="busy" class="button secondary" autofocus @click="emit('cancel')">
        取消</button
      ><button :disabled="busy" class="button" :class="{ danger }" @click="emit('confirm')">
        {{ busy ? '处理中…' : '确认' }}
      </button>
    </div>
  </dialog>
</template>
