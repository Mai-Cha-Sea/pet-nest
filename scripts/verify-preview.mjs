import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'

// Launch this project's built preview directly, without a shell or visible Windows window.
const child = spawn(
  process.execPath,
  [
    resolve('node_modules/vite/bin/vite.js'),
    'preview',
    '--host',
    '127.0.0.1',
    '--port',
    '4173',
    '--strictPort',
  ],
  { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
)
try {
  await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('生产预览启动超时')), 10000)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`生产预览提前退出 (${code})`))
    })
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('127.0.0.1:4173')) {
        clearTimeout(timer)
        resolveReady()
      }
    })
  })
  let html = ''
  for (const path of [
    '/',
    '/pets/new',
    '/ai',
    '/terms',
    '/privacy',
    '/community',
    '/community/new',
    '/community/posts/00000000-0000-4000-8000-000000000000',
    '/community/people/00000000-0000-4000-8000-000000000000',
  ]) {
    const response = await fetch(`http://127.0.0.1:4173${path}`, {
      signal: AbortSignal.timeout(5000),
    })
    assert.equal(response.status, 200, `${path} HTTP`)
    html = await response.text()
    assert.ok(html.includes('宠物小窝') && html.includes('id="app"'), `${path} SPA 入口`)
  }
  const script = html.match(/src="([^"]+\.js)"/)?.[1]
  assert.ok(script, '生产 JS 引用存在')
  const asset = await fetch(`http://127.0.0.1:4173${script}`, { signal: AbortSignal.timeout(5000) })
  assert.equal(asset.status, 200, '生产 JS HTTP')
  console.log('PASS: 生产预览启动、9 个 P0/P1/协议路由 HTTP 200，入口 JS 可读取。')
} finally {
  child.kill()
  await new Promise((resolveExit) => {
    if (child.exitCode !== null) resolveExit()
    else child.once('exit', resolveExit)
  })
}
