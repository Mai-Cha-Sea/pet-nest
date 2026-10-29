<script setup lang="ts">
/**
 * 统一错误/成功消息展示；错误使用 alert，成功使用 status。
 * 通过文本插值渲染，不将外部错误当 HTML 执行。
 */
defineProps<{ error?: string; success?: string }>()
</script>
<template>
  <p v-if="error" class="notice error" role="alert">
    <slot>{{ error }}</slot>
  </p>
  <p v-if="success" class="notice success" role="status">{{ success }}</p>
</template>
