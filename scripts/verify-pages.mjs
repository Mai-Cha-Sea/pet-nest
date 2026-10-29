import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'

const origin = new URL(process.argv[2] || 'https://pet-nest-mobile.pages.dev').origin
assert.equal(new URL(origin).protocol, 'https:', '部署地址必须使用 HTTPS。')
const backend = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_ANON_KEY
assert.ok(backend && key, '请载入 .env.local 的前端公开配置。')
const checks = []
const digest = (data) => createHash('sha256').update(data).digest('hex')
async function get(path) {
  return fetch(origin + path, { signal: AbortSignal.timeout(20000) })
}
try {
  const expectedHtml = await fs.readFile('dist/index.html')
  const pages = await Promise.allSettled(
    [
      '/',
      '/auth',
      '/pets/new',
      '/profile',
      '/ai',
      '/settings',
      '/timeline',
      '/community',
      '/community/new',
      '/terms',
      '/privacy',
      '/community/posts/00000000-0000-4000-8000-000000000000',
      '/community/people/00000000-0000-4000-8000-000000000000',
    ].map(async (path) => {
      const response = await get(path)
      const data = Buffer.from(await response.arrayBuffer())
      assert.equal(response.status, 200, path)
      assert.equal(digest(data), digest(expectedHtml), `${path} 必须返回本次构建的 SPA 入口。`)
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
      assert.equal(response.headers.get('x-frame-options'), 'DENY')
      checks.push({
        name: 'page',
        path,
        http: response.status,
        matchesBuild: true,
        securityHeaders: true,
      })
    }),
  )
  for (const result of pages) if (result.status === 'rejected') throw result.reason
  const names = (await fs.readdir('dist/assets')).filter((name) => /\.(js|css)$/.test(name))
  for (let i = 0; i < names.length; i += 5) {
    const assets = await Promise.allSettled(
      names.slice(i, i + 5).map(async (name) => {
        const path = '/assets/' + name
        const response = await get(path)
        assert.equal(response.status, 200, path)
        const data = Buffer.from(await response.arrayBuffer())
        assert.equal(digest(data), digest(await fs.readFile('dist' + path)), `${path} 内容不匹配。`)
        assert.ok(
          !response.headers.get('content-type')?.includes('text/html'),
          '资源不能返回 HTML 回退。',
        )
        checks.push({ name: 'asset', path, http: response.status, matchesBuild: true })
      }),
    )
    for (const result of assets) if (result.status === 'rejected') throw result.reason
  }
  for (const slug of ['ai-chat', 'storage-cleanup']) {
    const url = backend + '/functions/v1/' + slug
    const preflight = await fetch(url, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,apikey,content-type',
      },
      signal: AbortSignal.timeout(20000),
    })
    assert.ok([200, 204].includes(preflight.status), `${slug} 预检失败。`)
    assert.equal(preflight.headers.get('access-control-allow-origin'), origin)
    const unauthorized = await fetch(url, {
      method: 'POST',
      headers: { Origin: origin, apikey: key, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(20000),
    })
    assert.equal(unauthorized.status, 401, `${slug} 必须继续要求登录。`)
    assert.equal(unauthorized.headers.get('access-control-allow-origin'), origin)
    checks.push({
      name: 'backend_origin',
      slug,
      preflight: preflight.status,
      unauthorized: unauthorized.status,
    })
  }
  await fs.mkdir('test-results', { recursive: true })
  await fs.writeFile(
    'test-results/pages-deployment.json',
    JSON.stringify(
      { date: new Date().toISOString(), origin, checks, passed: true, aiCalls: 0, smsSent: false },
      null,
      2,
    ),
  )
  console.log(
    JSON.stringify({
      origin,
      pages: checks.filter((check) => check.name === 'page').length,
      assets: names.length,
      backendOrigins: 2,
      matchedLocalBuild: true,
      aiCalls: 0,
      smsSent: false,
    }),
  )
} catch (error) {
  await fs.mkdir('test-results', { recursive: true })
  await fs.writeFile(
    'test-results/pages-deployment.json',
    JSON.stringify(
      { date: new Date().toISOString(), origin, checks, passed: false, error: error.message },
      null,
      2,
    ),
  )
  throw error
}
