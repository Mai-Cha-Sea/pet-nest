import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
export default defineConfig({
  plugins: [vue()],
  test: { include: ['tests/**/*.test.ts'], testTimeout: 30000, hookTimeout: 60000 },
  build: { sourcemap: false },
})
