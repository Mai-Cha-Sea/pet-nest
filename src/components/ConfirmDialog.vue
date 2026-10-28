<script setup lang="ts">
import { onMounted, ref } from 'vue'
defineProps<{ title: string; message: string; busy?: boolean; danger?: boolean }>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()
const dialog = ref<HTMLDialogElement>()
onMounted(() => dialog.value?.showModal())
</script>
<template>
  <dialog ref="dialog" class="confirm-dialog" @cancel.prevent="!busy && emit('cancel')">
    <h2>{{ title }}</h2>
    <p>{{ message }}</p>
    <div class="actions">
      <button :disabled="busy" class="button secondary" autofocus @click="emit('cancel')">
        取消</button
      ><button :disabled="busy" class="button" :class="{ danger }" @click="emit('confirm')">
        {{ busy ? '处理中…' : '确认' }}
      </button>
    </div>
  </dialog>
</template>
