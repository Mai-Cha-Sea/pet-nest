<script setup lang="ts">
/**
 * 手机号输入展示组件：固定 +86 前缀，v-model 保存用户输入的本地号码。
 * 最终规范化由 shared/auth.ts 完成；此组件不发送验证码或验证号码归属。
 */
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
