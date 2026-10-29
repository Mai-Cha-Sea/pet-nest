/**
 * 生产构建后的静态产物检查：递归扫描 HTML/JS/CSS/map 中的服务端配置名与直连地址。
 * 这只是泄漏防线之一，不等同于穷尽所有真实密钥；实际发布还需核对上传目录和凭据排除。
 */
import { readdir, readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const forbidden = [
  'DEEPSEEK_API_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ALIBABA_CLOUD_ACCESS_KEY_SECRET',
  'SEND_SMS_HOOK_SECRET',
  'https://dypnsapi.aliyuncs.com',
  'https://api.deepseek.com/chat/completions',
]
let files = 0
/**
 * 递归读取允许扫描的构建文本；任何禁用标识命中都立即失败，不自动修剪或替换产物。
 */
async function check(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) await check(path)
    else if (/\.(js|html|css|map)$/.test(entry.name)) {
      const source = await readFile(path, 'utf8')
      files++
      for (const word of forbidden)
        assert.ok(!source.includes(word), `前端产物包含服务端配置或调用地址：${word}`)
    }
  }
}
await check('dist')
console.log(`PASS: ${files} 个前端产物未包含服务端密钥变量或上游直连地址。`)
