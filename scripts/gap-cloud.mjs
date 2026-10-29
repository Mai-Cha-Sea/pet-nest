/**
 * 协议声明留存、不可伪改及获赞统计的开发云端专项验收。
 * 显式开关与管理凭据后才创建临时账号/动态；finally 清理，不发送短信、邮件或模型请求。
 * 此脚本只验证所列专项，不替代完整 P0/P1 测试。
 */
// Narrow development acceptance for consent snapshots and received-like totals.
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { randomUUID, randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { registrationConsent } from '../shared/legal.ts'
process.loadEnvFile('.env.test.local')
if (process.env.TEST_ALLOW_GAP_TESTS !== 'yes' || !process.env.TEST_ADMIN_KEY) {
  console.log(
    'SKIPPED: explicit development test opt-in and server-only admin credential required.',
  )
  process.exit(2)
}
const url = process.env.TEST_SUPABASE_URL
assert.equal(new URL(url).hostname, 'httzsurpqbbqwazrunsu.supabase.co')
const connect = (key = process.env.TEST_SUPABASE_ANON_KEY) =>
  createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20000) }),
    },
  })
const checked = ({ data, error }) => {
  if (error) throw new Error(`Cloud gap check failed (${error.code || error.status || 'unknown'})`)
  return data
}
const admin = connect(process.env.TEST_ADMIN_KEY),
  accounts = []
const report = {
  started_at: new Date().toISOString(),
  checks: [],
  cleanupErrors: [],
  modelCalls: 0,
  smsSent: false,
  emailSent: false,
}
await fs.mkdir('test-results', { recursive: true })
const save = () => fs.writeFile('test-results/gap-cloud.json', JSON.stringify(report, null, 2))
const pass = async (id, name) => {
  report.checks.push({ id, name, status: 'passed' })
  await save()
  console.log(`PASS ${id}: ${name}`)
}
const rpc = async (db, name, args) => checked(await db.rpc(name, args))
async function account(label, consent) {
  const email = `petnest-gap-${randomUUID()}@example.com`,
    password = `Nest!9-${randomBytes(24).toString('base64url')}`
  const user = checked(
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        nickname: `GAP临时${label}`,
        ...(consent ? { legal_consent: consent } : {}),
      },
    }),
  ).user
  const item = { id: user.id, db: connect() }
  accounts.push(item)
  report.createdUsers = accounts.map((a) => a.id)
  await save()
  checked(await item.db.auth.signInWithPassword({ email, password }))
  return item
}
try {
  const a = await account('A', registrationConsent()),
    b = await account('B')
  const read = async (db, id) =>
    checked(
      await db
        .from('users')
        .select('terms_version,privacy_version,legal_accepted_at')
        .eq('id', id)
        .single(),
    )
  const recorded = await read(a.db, a.id)
  assert.equal(recorded.terms_version, '2026-10-29')
  assert.equal(recorded.privacy_version, '2026-10-29')
  assert.ok(Date.parse(recorded.legal_accepted_at) >= Date.parse(report.started_at) - 60000)
  assert.deepEqual(await read(b.db, b.id), {
    terms_version: null,
    privacy_version: null,
    legal_accepted_at: null,
  })
  await pass(
    'G01',
    'new registration metadata records document versions at server time; legacy declarations remain absent',
  )
  assert.ok(
    (await a.db.from('users').update({ legal_accepted_at: '2000-01-01' }).eq('id', a.id)).error,
  )
  assert.equal(
    checked(await b.db.from('users').select('id,legal_accepted_at').eq('id', a.id)).length,
    0,
  )
  checked(await a.db.auth.updateUser({ data: { legal_consent: { accepted: false } } }))
  assert.deepEqual(await read(a.db, a.id), recorded)
  await pass(
    'G02',
    'owners cannot edit the snapshot, other users cannot read it, later Auth metadata does not overwrite it',
  )
  for (const item of [a, b])
    await rpc(item.db, 'community_set_profile', { p_nickname: 'GAP临时宠友' })
  const posts = [randomUUID(), randomUUID()]
  for (const id of posts) {
    await rpc(a.db, 'community_create_post', {
      p_id: id,
      p_body: 'GAP获赞临时测试',
      p_pet: null,
      p_tags: [],
    })
    await rpc(a.db, 'community_publish', { p_post: id, p_images: [] })
  }
  for (const [item, id] of [
    [a, posts[0]],
    [b, posts[0]],
    [b, posts[1]],
  ])
    await rpc(item.db, 'community_interact', { p_target: id, p_kind: 'like', p_enabled: true })
  const total = async (db) =>
    (await rpc(db, 'community_person', { p_user: a.id })).like_received_count
  assert.equal(await total(a.db), 3)
  assert.equal(await total(b.db), 3)
  await rpc(b.db, 'community_interact', { p_target: posts[1], p_kind: 'like', p_enabled: true })
  assert.equal(await total(b.db), 3)
  await rpc(b.db, 'community_interact', { p_target: posts[0], p_kind: 'like', p_enabled: false })
  assert.equal(await total(b.db), 2)
  await rpc(admin, 'community_review', {
    p_post: posts[1],
    p_approve: false,
    p_note: 'GAP临时测试下架',
  })
  assert.equal(await total(a.db), 1)
  assert.equal(await total(b.db), 1)
  await rpc(a.db, 'community_delete_post', { p_post: posts[0] })
  assert.equal(await total(b.db), 0)
  await pass(
    'G03',
    'published received totals agree for owner/visitor:3, duplicate3, unlike2, takedown1, deletion0',
  )
} catch (error) {
  report.failure = error instanceof assert.AssertionError ? error.message.slice(0, 240) : error.name
  process.exitCode = 1
  console.error('GAP cloud check failed; inspect the ignored report.')
} finally {
  for (const item of accounts) {
    try {
      checked(await admin.from('community_posts').delete().eq('user_id', item.id))
      checked(await admin.auth.admin.deleteUser(item.id))
      assert.equal((await admin.auth.admin.getUserById(item.id)).error?.status, 404)
      assert.equal(checked(await admin.from('users').select('id').eq('id', item.id)).length, 0)
    } catch {
      report.cleanupErrors.push(item.id)
    }
    await item.db.auth.signOut({ scope: 'local' }).catch(() => {})
  }
  report.finished_at = new Date().toISOString()
  report.completed = report.checks.length === 3 && !report.cleanupErrors.length && !report.failure
  if (!report.completed) process.exitCode = 1
  await save()
  console.log(
    `Finished: ${report.checks.length}/3 groups; cleanup errors=${report.cleanupErrors.length}.`,
  )
}
