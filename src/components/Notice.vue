<script setup lang="ts">
defineProps<{ error?: string; success?: string }>()
</script>
<template>
  <p v-if="error" class="notice error" role="alert">
    <slot>{{ error }}</slot>
  </p>
  <p v-if="success" class="notice success" role="status">{{ success }}</p>
</template>
