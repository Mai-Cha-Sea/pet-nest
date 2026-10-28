import assert from 'node:assert/strict'

const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_ANON_KEY
assert.ok(url && key, '请先配置 .env.local 的 Supabase 公开连接信息。')
const response = await fetch(`${url}/auth/v1/settings`, {
  headers: { apikey: key },
  signal: AbortSignal.timeout(15000),
})
assert.ok(response.ok, `Auth 设置读取失败：HTTP ${response.status}`)
const settings = await response.json()
assert.equal(settings.external?.email, true, '邮箱登录未启用。')
assert.equal(settings.external?.phone, true, '手机号登录未启用。')
assert.equal(settings.mailer_autoconfirm, false, '邮箱必须完成真实验证。')
assert.equal(settings.phone_autoconfirm, false, '手机号自动确认仍开启，必须先修复云端配置。')
console.log('PASS: 云端邮箱与手机号登录已启用，均要求真实验证；没有发送短信或邮件。')
