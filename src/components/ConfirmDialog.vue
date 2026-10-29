<script setup lang="ts">
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
