/**
 * 仅针对指定开发项目和专用 A/B 的真实 P1 联调；显式开关后才写入。
 * 临时动态/宠物/图片和本轮新增关注在 finally 清理，原有关注和已存在社区昵称不覆盖。
 * 检查 RPC/RLS/Storage，不调用模型或短信；清理失败必须在报告中保留，不能算完整通过。
 */
// Run only against the explicitly selected development project and dedicated A/B accounts.
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
process.loadEnvFile('.env.test.local')
if (process.env.TEST_ALLOW_P1_TESTS !== 'yes' || !process.env.TEST_ADMIN_KEY) {
  console.log(
    'SKIPPED: P1 development writes and a server-only administrative test credential are required.',
  )
  process.exit(2)
}
const url = process.env.TEST_SUPABASE_URL,
  key = process.env.TEST_SUPABASE_ANON_KEY
if (new URL(url).hostname !== 'httzsurpqbbqwazrunsu.supabase.co')
  throw new Error('Unexpected development project; review the test target before running.')
const connect = (apiKey) =>
  createClient(url, apiKey || key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(30000) }),
    },
  })
const a = connect(),
  b = connect(),
  admin = connect(process.env.TEST_ADMIN_KEY)
const checked = ({ data, error }) => {
  if (error) throw new Error(`Supabase test failed: ${error.code || error.status || 'unknown'}`)
  return data
}
const rpc = async (db, name, args = {}) => checked(await db.rpc(name, args))
const report = {
  created_at: new Date().toISOString(),
  project: new URL(url).hostname,
  checks: [],
  modelCalls: 0,
  smsSent: false,
}
const pass = (name) => {
  report.checks.push({ name, status: 'passed' })
  console.log(`PASS: ${name}`)
}
const posts = [],
  petIds = [],
  paths = []
let userA,
  userB,
  followBefore = false,
  followTouched = false,
  completed = false
try {
  userA = checked(
    await a.auth.signInWithPassword({
      email: process.env.TEST_USER_A_EMAIL,
      password: process.env.TEST_USER_A_PASSWORD,
    }),
  ).user
  userB = checked(
    await b.auth.signInWithPassword({
      email: process.env.TEST_USER_B_EMAIL,
      password: process.env.TEST_USER_B_PASSWORD,
    }),
  ).user
  for (const [db, user, nickname] of [
    [a, userA, 'P1 测试宠友 A'],
    [b, userB, 'P1 测试宠友 B'],
  ]) {
    if (!(await rpc(db, 'community_person', { p_user: user.id })))
      await rpc(db, 'community_set_profile', { p_nickname: nickname })
  }
  const id = crypto.randomUUID()
  posts.push(id)
  await rpc(a, 'community_create_post', {
    p_id: id,
    p_body: 'P1 自动验收临时动态：今天和毛孩子晒太阳。',
    p_pet: null,
    p_tags: ['猫咪日常', '晒太阳'],
  })
  assert.equal(checked(await b.from('community_posts').select('id').eq('id', id)).length, 0)
  assert.ok((await b.rpc('community_publish', { p_post: id, p_images: [] })).error)
  assert.equal(await rpc(a, 'community_publish', { p_post: id, p_images: [] }), 'published')
  const fresh = connect()
  checked(
    await fresh.auth.signInWithPassword({
      email: process.env.TEST_USER_B_EMAIL,
      password: process.env.TEST_USER_B_PASSWORD,
    }),
  )
  const refreshed = (await rpc(fresh, 'community_feed', { p_post: id }))[0]
  assert.equal(refreshed.id, id)
  assert.deepEqual(refreshed.tags, ['猫咪日常', '晒太阳'])
  await fresh.auth.signOut({ scope: 'local' })
  pass('draft isolation, owner-only automatic publication and tag persistence in a fresh client')
  assert.equal(checked(await b.from('users').select('id').eq('id', userA.id)).length, 0)
  assert.ok((await b.from('community_posts').update({ status: 'published' }).eq('id', id)).error)
  assert.ok((await b.rpc('community_review', { p_post: id, p_approve: false })).error)
  pass('private profiles remain private; direct writes and reviewer privilege escalation denied')
  await Promise.all(
    Array.from({ length: 8 }, () =>
      rpc(b, 'community_interact', { p_target: id, p_kind: 'like', p_enabled: true }),
    ),
  )
  await rpc(b, 'community_interact', { p_target: id, p_kind: 'favorite', p_enabled: true })
  let feed = (await rpc(b, 'community_feed', { p_post: id }))[0]
  assert.equal(feed.like_count, 1)
  assert.equal(feed.liked, true)
  assert.equal(feed.favorited, true)
  assert.equal(
    checked(await a.from('community_favorites').select('post_id').eq('post_id', id)).length,
    0,
  )
  followBefore = (await rpc(b, 'community_person', { p_user: userA.id })).is_following
  await rpc(b, 'community_interact', { p_target: userA.id, p_kind: 'follow', p_enabled: true })
  followTouched = true
  assert.ok((await rpc(b, 'community_feed', { p_mode: 'following' })).some((p) => p.id === id))
  assert.ok(
    (await rpc(a, 'community_people', { p_user: userA.id, p_list: 'followers' })).some(
      (p) => p.user_id === userB.id,
    ),
  )
  pass(
    'eight simultaneous like retries count once; private favorites, following feed and followers list',
  )
  const comment = crypto.randomUUID(),
    reply = crypto.randomUUID()
  await rpc(a, 'community_add_comment', { p_id: comment, p_post: id, p_body: '欢迎友善交流' })
  await rpc(a, 'community_add_comment', { p_id: comment, p_post: id, p_body: '欢迎友善交流' })
  await rpc(b, 'community_add_comment', {
    p_id: reply,
    p_post: id,
    p_body: '收到回复',
    p_parent: comment,
  })
  assert.ok(
    (
      await b.rpc('community_add_comment', {
        p_id: crypto.randomUUID(),
        p_post: id,
        p_body: '越层回复',
        p_parent: reply,
      })
    ).error,
  )
  assert.equal(
    checked(
      await b
        .from('community_comments')
        .select('id,author:community_profiles(nickname)')
        .eq('post_id', id),
    ).length,
    2,
  )
  assert.ok((await b.rpc('community_delete_comment', { p_comment: comment })).error)
  assert.ok(
    (
      await b.rpc('community_add_comment', {
        p_id: crypto.randomUUID(),
        p_post: id,
        p_body: '裸 聊',
      })
    ).error,
  )
  await rpc(b, 'community_report', {
    p_id: crypto.randomUUID(),
    p_reason: '自动验收举报入口，测试内容待清理',
    p_post: id,
  })
  assert.equal(checked(await a.from('community_reports').select('id').eq('post_id', id)).length, 0)
  pass(
    'comment persistence, retry deduplication, one reply level, server moderation and report privacy',
  )
  const imagePost = crypto.randomUUID()
  posts.push(imagePost)
  await rpc(a, 'community_create_post', { p_id: imagePost, p_body: 'P1 临时图片审核验收' })
  const path = `${userA.id}/posts/${imagePost}/${crypto.randomUUID()}.png`
  paths.push(path)
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5H0AAAAASUVORK5CYII=',
    'base64',
  )
  checked(await a.storage.from('community-media').upload(path, png, { contentType: 'image/png' }))
  assert.equal(checked(await b.from('community_posts').select('id').eq('id', imagePost)).length, 0)
  assert.ok((await b.storage.from('community-media').createSignedUrl(path, 60)).error)
  assert.equal(
    await rpc(a, 'community_publish', { p_post: imagePost, p_images: [path] }),
    'published',
  )
  assert.equal(checked(await b.from('community_posts').select('id').eq('id', imagePost)).length, 1)
  checked(await a.storage.from('community-media').createSignedUrl(path, 60))
  await rpc(admin, 'community_review', {
    p_post: imagePost,
    p_approve: true,
    p_note: '检查管理员复核接口仍可用，仅为一像素测试图片。',
  })
  assert.equal(checked(await b.from('community_posts').select('id').eq('id', imagePost)).length, 1)
  const signed = checked(await b.storage.from('community-media').createSignedUrl(path, 60))
  assert.equal((await fetch(signed.signedUrl)).status, 200)
  await rpc(admin, 'community_review', {
    p_post: imagePost,
    p_approve: false,
    p_note: '验收下架路径，随后清理。',
  })
  assert.ok((await b.storage.from('community-media').createSignedUrl(path, 60)).error)
  pass(
    'real Storage upload, draft-image isolation, keyword auto-publication, signed access and moderator takedown',
  )
  const pet = checked(
    await a.from('pets').insert({ name: 'P1 曲线临时测试', species: 'cat' }).select('id').single(),
  )
  petIds.push(pet.id)
  const rows = Array.from({ length: 3 }, (_, i) => ({
    user_id: userA.id,
    pet_id: pet.id,
    type: 'weight',
    content: { weight: 4 + i / 10 },
    occurred_at: new Date(Date.now() - (3 - i) * 86400000).toISOString(),
  }))
  checked(await a.from('records').insert(rows))
  assert.equal(
    checked(await a.from('records').select('content').eq('pet_id', pet.id).eq('type', 'weight'))
      .length,
    3,
  )
  assert.equal(checked(await b.from('records').select('id').eq('pet_id', pet.id)).length, 0)
  pass('three persisted real weight records remain scoped to the owner')
  completed = true
} catch (error) {
  console.error(error instanceof Error ? error.message : 'P1 cloud check failed')
  process.exitCode = 1
} finally {
  const cleanupErrors = []
  if (followTouched && !followBefore) {
    try {
      await rpc(b, 'community_interact', { p_target: userA.id, p_kind: 'follow', p_enabled: false })
    } catch {
      cleanupErrors.push('follow')
    }
  }
  for (const id of posts) {
    try {
      await rpc(a, 'community_delete_post', { p_post: id })
    } catch {
      cleanupErrors.push(`post:${id}`)
    }
  }
  for (const id of petIds)
    if ((await a.from('pets').delete().eq('id', id)).error) cleanupErrors.push(`pet:${id}`)
  const clean = await a.functions.invoke('storage-cleanup', { body: {} })
  if (clean.error) cleanupErrors.push('storage function')
  if (paths.length) {
    const queue = await admin.from('community_media_cleanup').select('path').in('path', paths)
    if (queue.error || queue.data.length) cleanupErrors.push('image cleanup queue not drained')
  }
  report.completed = completed && !cleanupErrors.length
  report.cleanupErrors = cleanupErrors
  await fs.mkdir('test-results', { recursive: true })
  if (cleanupErrors.length) {
    console.error('P1 test cleanup needs attention; inspect ignored report.')
    process.exitCode = 1
  } else pass('only this run’s temporary posts, pet, follow and images cleaned up')
  await fs.writeFile('test-results/p1-cloud.json', JSON.stringify(report, null, 2))
  await Promise.allSettled([a.auth.signOut({ scope: 'local' }), b.auth.signOut({ scope: 'local' })])
}
