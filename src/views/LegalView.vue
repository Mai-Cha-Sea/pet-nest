<script setup lang="ts">
import { computed } from 'vue'
import { legalDocuments, providerLinks } from '../content/legal'
const props = defineProps<{ kind: 'terms' | 'privacy' }>()
const document = computed(() => legalDocuments[props.kind])
</script>
<template>
  <article class="panel legal-document">
    <RouterLink to="/auth" class="back-link">返回登录 / 注册</RouterLink>
    <span class="eyebrow">PET NEST · COURSE PROJECT</span>
    <h1>{{ document.title }}</h1>
    <p class="muted">版本与生效日期：{{ document.version }} · 课设测试版</p>
    <p>{{ document.introduction }}</p>
    <nav class="legal-links" aria-label="协议切换">
      <RouterLink to="/terms" :aria-current="kind === 'terms' ? 'page' : undefined"
        >用户协议</RouterLink
      >
      <RouterLink to="/privacy" :aria-current="kind === 'privacy' ? 'page' : undefined"
        >隐私政策</RouterLink
      >
    </nav>
    <section v-for="(section, index) in document.sections" :key="section.title">
      <h2>{{ index + 1 }}. {{ section.title }}</h2>
      <p v-for="paragraph in section.paragraphs" :key="paragraph">{{ paragraph }}</p>
    </section>
    <section v-if="kind === 'privacy'">
      <h2>服务提供方的官方说明</h2>
      <ul>
        <li v-for="link in providerLinks" :key="link.href">
          <a :href="link.href" target="_blank" rel="noopener noreferrer"
            >{{ link.name }}（新标签页）</a
          >
        </li>
      </ul>
    </section>
    <p class="muted">阅读本页不会自动勾选同意或创建账号，请返回注册页自主选择。</p>
  </article>
</template>
