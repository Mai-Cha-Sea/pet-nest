/**
 * 当前开发项目的少量只读计时采样：记录请求耗时和页面/接口状态。
 * 结果受本机网络影响，不代表压测、真实 4G 首屏/LCP 或持续 48 小时稳定性结论。
 * 不修改数据、不发模型/短信，读取配置与报告均留在本机忽略文件。
 */
// Small read-only sample, not a load test or a 4G/LCP measurement.
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
process.loadEnvFile('.env.test.local')
const url = process.env.TEST_SUPABASE_URL
assert.equal(new URL(url).hostname, 'httzsurpqbbqwazrunsu.supabase.co')
const db = createClient(url, process.env.TEST_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20000) }) },
})
const checked = ({ data, error }) => {
  if (error)
    throw new Error(`Read-only benchmark failed (${error.code || error.status || 'unknown'})`)
  return data
}
const report = {
  created_at: new Date().toISOString(),
  sample: [],
  checks: [],
  modelCalls: 0,
  smsSent: false,
}
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
try {
  checked(
    await db.auth.signInWithPassword({
      email: process.env.TEST_USER_A_EMAIL,
      password: process.env.TEST_USER_A_PASSWORD,
    }),
  )
  for (const kind of ['pets', 'community_feed']) {
    const samples = []
    for (let i = 0; i < 10; i++) {
      const start = performance.now()
      checked(
        await (kind === 'pets'
          ? db.from('pets').select('id').limit(10)
          : db.rpc('community_feed', { p_mode: 'recommend', p_offset: 0 })),
      )
      samples.push(Math.round(performance.now() - start))
    }
    const sorted = [...samples].sort((a, b) => a - b)
    const mean = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length)
    report.sample.push({
      endpoint: kind,
      samples_ms: samples,
      mean_ms: mean,
      p95_ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
      meets_500ms_sample_mean: mean <= 500,
    })
  }
  const origin = 'https://pet-nest-mobile.pages.dev'
  const page = await fetch(origin + '/auth', { signal: AbortSignal.timeout(20000) })
  assert.equal(page.status, 200)
  const bytes = Buffer.from(await page.arrayBuffer())
  report.checks.push({
    name: 'Pages HTTPS auth',
    http: page.status,
    nosniff: page.headers.get('x-content-type-options') === 'nosniff',
    frameDenied: page.headers.get('x-frame-options') === 'DENY',
    matchesCurrentLocalBuild: hash(bytes) === hash(await fs.readFile('dist/index.html')),
  })
  const redirect = await fetch('http://pet-nest-mobile.pages.dev/auth', {
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
  })
  report.checks.push({
    name: 'HTTP redirects to HTTPS',
    http: redirect.status,
    passed:
      [301, 302, 307, 308].includes(redirect.status) &&
      redirect.headers.get('location')?.startsWith(origin),
  })
  for (const slug of ['ai-chat', 'storage-cleanup']) {
    const preflight = await fetch(`${url}/functions/v1/${slug}`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,apikey,content-type',
      },
      signal: AbortSignal.timeout(20000),
    })
    assert.ok([200, 204].includes(preflight.status))
    assert.equal(preflight.headers.get('access-control-allow-origin'), origin)
    const unauth = await fetch(`${url}/functions/v1/${slug}`, {
      method: 'POST',
      headers: {
        Origin: origin,
        apikey: process.env.TEST_SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: '{}',
      signal: AbortSignal.timeout(20000),
    })
    assert.equal(unauth.status, 401)
    report.checks.push({
      name: `${slug} Pages CORS/unauthenticated`,
      preflight: preflight.status,
      unauthorized: unauth.status,
      passed: true,
    })
  }
  report.completed = true
  console.log(JSON.stringify(report, null, 2))
} finally {
  await db.auth.signOut({ scope: 'local' }).catch(() => {})
  await fs.mkdir('test-results', { recursive: true })
  await fs.writeFile('test-results/full-performance.json', JSON.stringify(report, null, 2))
}
