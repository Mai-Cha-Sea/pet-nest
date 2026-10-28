<script setup lang="ts">
const value = defineModel<string>({ required: true })
defineProps<{ label?: string; disabled?: boolean }>()
</script>
<template>
  <label
    >{{ label || '手机号' }}
    <span class="phone-input">
      <span class="phone-prefix" aria-hidden="true">+86</span>
      <input
        v-model="value"
        type="tel"
        inputmode="tel"
        autocomplete="tel-national"
        :aria-label="label || '手机号'"
        :disabled="disabled"
        required
        maxlength="18"
        placeholder="请输入 11 位手机号"
      />
    </span>
    <small>仅支持中国大陆手机号，区号固定为 +86。</small>
  </label>
</template>
