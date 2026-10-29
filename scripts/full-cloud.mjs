// Explicit, bounded acceptance run for the named DEVELOPMENT project only.
// Credentials stay in process memory. Every write is scoped to accounts created by this run.
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { randomUUID, randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

process.loadEnvFile('.env.test.local')
const url = process.env.TEST_SUPABASE_URL
const key = process.env.TEST_SUPABASE_ANON_KEY
if (process.env.TEST_ALLOW_FULL_TESTS !== 'yes' || !process.env.TEST_ADMIN_KEY) {
  console.log(
    'SKIPPED: explicit development test opt-in and server-only admin credential required.',
  )
  process.exit(2)
}
assert.equal(new URL(url).hostname, 'httzsurpqbbqwazrunsu.supabase.co')
const client = (apiKey = key) =>
  createClient(url, apiKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(65000) }),
    },
  })
const checked = ({ data, error }) => {
  if (error)
    throw new Error(`Supabase operation failed (${error.code || error.status || 'unknown'})`)
  return data
}
const rpc = async (db, name, args) => checked(await db.rpc(name, args))
const admin = client(process.env.TEST_ADMIN_KEY),
  anon = client()
const report = {
  started_at: new Date().toISOString(),
  project: new URL(url).hostname,
  checks: [],
  accountsCreated: [],
  cleanupErrors: [],
  modelCalls: 0,
  smsSent: false,
  emailSent: false,
}
await fs.mkdir('test-results', { recursive: true })
const save = () => fs.writeFile('test-results/full-cloud.json', JSON.stringify(report, null, 2))
const test = async (id, name, action) => {
  const start = performance.now()
  try {
    const details = await action()
    report.checks.push({
      id,
      name,
      status: 'passed',
      elapsed_ms: Math.round(performance.now() - start),
      ...(details ? { details } : {}),
    })
    console.log(`PASS ${id}: ${name}`)
  } catch (error) {
    // Avoid recording upstream response bodies, tokens, account identifiers or passwords.
    report.checks.push({
      id,
      name,
      status: 'failed',
      error:
        error instanceof assert.AssertionError
          ? error.message.slice(0, 240)
          : error?.name || 'Error',
    })
    process.exitCode = 1
    console.error(`FAIL ${id}: ${name}; inspect the ignored report.`)
    throw error
  } finally {
    await save()
  }
}
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5H0AAAAASUVORK5CYII=',
  'base64',
)
const accounts = [],
  uploads = []
const makeAccount = async (label) => {
  const email = `petnest-full-${randomUUID()}@example.com`
  const password = `Nest!9-${randomBytes(24).toString('base64url')}`
  const user = checked(
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nickname: `临时全面测试${label}`, purpose: 'petnest-full-acceptance' },
    }),
  ).user
  const account = { id: user.id, db: client(), email, password }
  accounts.push(account)
  report.accountsCreated.push(user.id)
  await save()
  account.auth = checked(await account.db.auth.signInWithPassword({ email, password }))
  return account
}
const upload = async (db, bucket, path, body = png, contentType = 'image/png') => {
  // Register before sending, so a lost upload response is still cleaned up.
  uploads.push({ bucket, path })
  return checked(await db.storage.from(bucket).upload(path, body, { contentType }))
}
const invoke = async (
  account,
  slug,
  body,
  origin = 'http://127.0.0.1:5173',
  token = account?.auth.session.access_token,
) => {
  const response = await fetch(`${url}/functions/v1/${slug}`, {
    method: 'POST',
    headers: {
      apikey: key,
      'Content-Type': 'application/json',
      Origin: origin,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(65000),
  })
  return { status: response.status, data: await response.json(), headers: response.headers }
}
let a, b, q, petA, petB, incident, avatar, post, imagePost, imagePath, comment, reply
try {
  await test(
    'C01',
    'isolated confirmed test users sign in; profile trigger and real refresh',
    async () => {
      a = await makeAccount('A')
      b = await makeAccount('B')
      q = await makeAccount('并发')
      assert.notEqual(a.id, b.id)
      assert.equal(checked(await a.db.from('users').select('id').single()).id, a.id)
      assert.ok(checked(await a.db.auth.refreshSession()).session)
      a.auth = checked(await a.db.auth.getSession())
    },
  )
  await test(
    'C02',
    'anonymous access and incorrect password do not disclose private data',
    async () => {
      assert.ok((await anon.from('pets').select('id')).error)
      assert.ok((await anon.from('users').select('id')).error)
      const invalid = await anon.auth.signInWithPassword({
        email: a.email,
        password: 'Definitely-wrong-9!',
      })
      assert.ok(invalid.error)
      assert.equal(invalid.data.session, null)
    },
  )
  await test(
    'C03',
    'profile edits persist; invalid fields and cross-user writes rejected',
    async () => {
      checked(
        await a.db
          .from('users')
          .update({ nickname: '全面验收A', bio: '临时测试资料' })
          .eq('id', a.id),
      )
      assert.equal(
        checked(await a.db.from('users').select('nickname').single()).nickname,
        '全面验收A',
      )
      assert.ok((await a.db.from('users').update({ nickname: '' }).eq('id', a.id)).error)
      assert.ok(
        (
          await a.db
            .from('users')
            .update({ bio: '字'.repeat(129) })
            .eq('id', a.id)
        ).error,
      )
      assert.equal(
        checked(await b.db.from('users').update({ nickname: '越权' }).eq('id', a.id).select())
          .length,
        0,
      )
      assert.equal(checked(await b.db.from('users').select('id').eq('id', a.id)).length, 0)
    },
  )
  await test('C04', 'complete pet create/read/edit and second owner', async () => {
    petA = checked(
      await a.db
        .from('pets')
        .insert({
          name: '全面测试团子',
          species: 'cat',
          breed: '中华田园猫',
          gender: 'female',
          date_kind: 'birth',
          birth_date: '2024-05-01',
          weight: 4.1,
          sterilized: false,
          remark: '一次性验收数据',
        })
        .select()
        .single(),
    )
    petB = checked(
      await b.db
        .from('pets')
        .insert({ name: '全面测试隔离犬', species: 'dog', weight: 8.2 })
        .select()
        .single(),
    )
    checked(await a.db.from('pets').update({ breed: '已编辑品种' }).eq('id', petA.id))
    assert.equal(
      checked(await a.db.from('pets').select('breed').eq('id', petA.id).single()).breed,
      '已编辑品种',
    )
  })
  await test(
    'C05',
    'database pet validation, forged ownership and all cross-user CRUD',
    async () => {
      for (const change of [
        { name: '' },
        { name: '长'.repeat(33) },
        { weight: -1 },
        { birth_date: '2099-01-01' },
        { species: 'invalid' },
      ])
        assert.ok(
          (await a.db.from('pets').insert({ name: '无效档案', species: 'cat', ...change })).error,
        )
      assert.ok(
        (await b.db.from('pets').insert({ name: '伪造归属', species: 'cat', user_id: a.id })).error,
      )
      assert.ok((await a.db.from('pets').update({ user_id: b.id }).eq('id', petA.id)).error)
      assert.equal(checked(await b.db.from('pets').select('id').eq('id', petA.id)).length, 0)
      assert.equal(
        checked(await b.db.from('pets').update({ name: '越权' }).eq('id', petA.id).select()).length,
        0,
      )
      assert.equal(checked(await b.db.from('pets').delete().eq('id', petA.id).select()).length, 0)
    },
  )
  let concurrentPets
  await test(
    'C06',
    '12 actual concurrent pet writes allow exactly 10; deleting frees a slot',
    async () => {
      const results = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          q.db
            .from('pets')
            .insert({ name: `并发临时-${i}`, species: 'other' })
            .select('id')
            .single(),
        ),
      )
      concurrentPets = results.filter((r) => !r.error).map((r) => r.data)
      assert.equal(concurrentPets.length, 10)
      assert.equal(results.filter((r) => r.error?.message.includes('PET_LIMIT')).length, 2)
      checked(await q.db.from('pets').delete().eq('id', concurrentPets[9].id))
      checked(await q.db.from('pets').insert({ name: '释放后新建', species: 'cat' }))
      assert.equal(checked(await q.db.from('pets').select('id')).length, 10)
      return { simultaneousRequests: 12, accepted: 10, rejected: 2 }
    },
  )
  await test(
    'C07',
    'all six record types persist with selected pet and descending time',
    async () => {
      const contents = {
        feeding: { food: '全面验收干粮', amount: 42, unit: 'g' },
        weight: { weight: 4.1 },
        deworming: { kind: 'both', note: '测试记录' },
        bath: { note: '测试洗澡' },
        medication: {
          name: '用户提供的测试名称',
          dosage: '用户提供的测试描述',
          note: '不代表用药建议',
        },
        incident: { description: '临时异常记录' },
      }
      const rows = checked(
        await a.db
          .from('records')
          .insert(
            Object.entries(contents).map(([type, content], i) => ({
              pet_id: petA.id,
              type,
              content,
              occurred_at: new Date(Date.now() - i * 60000).toISOString(),
            })),
          )
          .select(),
      )
      incident = rows.find((r) => r.type === 'incident')
      assert.equal(new Set(rows.map((r) => r.type)).size, 6)
      checked(
        await b.db.from('records').insert({
          pet_id: petB.id,
          type: 'feeding',
          content: { food: '仅B隔离狗粮', amount: 70, unit: 'g' },
          occurred_at: new Date().toISOString(),
        }),
      )
      const sorted = checked(
        await a.db
          .from('records')
          .select('occurred_at')
          .eq('pet_id', petA.id)
          .order('occurred_at', { ascending: false }),
      )
      assert.equal(sorted.length, 6)
      assert.ok(sorted.every((r, i) => !i || r.occurred_at <= sorted[i - 1].occurred_at))
    },
  )
  await test(
    'C08',
    'record boundaries, future date, cross-pet foreign key and cross-user delete',
    async () => {
      const base = {
        pet_id: petA.id,
        type: 'weight',
        content: { weight: 4.1 },
        occurred_at: new Date().toISOString(),
      }
      for (const change of [
        { content: { weight: 0 } },
        { content: { weight: '4.1' } },
        { occurred_at: '2099-01-01T00:00:00Z' },
        { type: 'medication', content: { name: '缺剂量' } },
      ])
        assert.ok((await a.db.from('records').insert({ ...base, ...change })).error)
      assert.ok((await b.db.from('records').insert(base)).error)
      assert.equal(checked(await b.db.from('records').select('id').eq('pet_id', petA.id)).length, 0)
      assert.equal(
        checked(await b.db.from('records').delete().eq('id', incident.id).select()).length,
        0,
      )
    },
  )
  await test(
    'C09',
    'timeline over 50 rows paginates without loss; selected type and new login persist',
    async () => {
      checked(
        await a.db.from('records').insert(
          Array.from({ length: 53 }, (_, i) => ({
            pet_id: petA.id,
            type: 'bath',
            content: { note: `分页临时-${i}` },
            occurred_at: new Date(Date.now() - (i + 10) * 60000).toISOString(),
          })),
        ),
      )
      const page = async (from, to) =>
        checked(
          await a.db
            .from('records')
            .select('id,occurred_at')
            .eq('pet_id', petA.id)
            .order('occurred_at', { ascending: false })
            .order('id', { ascending: false })
            .range(from, to),
        )
      const first = await page(0, 49),
        second = await page(50, 99)
      assert.equal(first.length, 50)
      assert.equal(second.length, 9)
      assert.equal(new Set([...first, ...second].map((r) => r.id)).size, 59)
      assert.equal(
        checked(await a.db.from('records').select('id').eq('pet_id', petA.id).eq('type', 'weight'))
          .length,
        1,
      )
      const fresh = client()
      checked(await fresh.auth.signInWithPassword({ email: a.email, password: a.password }))
      assert.equal(
        checked(await fresh.from('records').select('id').eq('pet_id', petA.id)).length,
        59,
      )
      checked(await fresh.auth.signOut({ scope: 'local' }))
    },
  )
  await test(
    'C10',
    'real private pet avatar upload/link/signing; foreign and unauthenticated reads denied',
    async () => {
      avatar = `${a.id}/pets/${petA.id}/avatar/${randomUUID()}.png`
      await upload(a.db, 'pet-media', avatar)
      checked(await a.db.from('pets').update({ avatar_path: avatar }).eq('id', petA.id))
      const signed = checked(await a.db.storage.from('pet-media').createSignedUrl(avatar, 60))
      assert.equal((await fetch(signed.signedUrl)).status, 200)
      assert.ok((await b.db.storage.from('pet-media').createSignedUrl(avatar, 60)).error)
      assert.ok((await anon.storage.from('pet-media').download(avatar)).error)
      assert.ok(
        (
          await b.db.storage
            .from('pet-media')
            .upload(`${a.id}/pets/${petA.id}/avatar/${randomUUID()}.png`, png, {
              contentType: 'image/png',
            })
        ).error,
      )
    },
  )
  await test('C11', 'Storage rejects SVG and >5MiB; incident allows 9 and rejects 10', async () => {
    const base = `${a.id}/pets/${petA.id}/records/${incident.id}`
    assert.ok(
      (
        await a.db.storage
          .from('pet-media')
          .upload(`${base}/${randomUUID()}.svg`, '<svg/>', { contentType: 'image/svg+xml' })
      ).error,
    )
    const tooLarge = Buffer.alloc(5242881)
    png.copy(tooLarge)
    assert.ok(
      (
        await a.db.storage
          .from('pet-media')
          .upload(`${base}/${randomUUID()}.png`, tooLarge, { contentType: 'image/png' })
      ).error,
    )
    const paths = []
    for (let i = 0; i < 9; i++) {
      const path = `${base}/${randomUUID()}.png`
      await upload(a.db, 'pet-media', path)
      paths.push(path)
    }
    checked(await a.db.from('records').update({ image_paths: paths }).eq('id', incident.id))
    assert.equal(
      checked(await a.db.from('records').select('image_paths').eq('id', incident.id).single())
        .image_paths.length,
      9,
    )
    assert.ok(
      (
        await a.db
          .from('records')
          .update({ image_paths: [...paths, `${base}/${randomUUID()}.png`] })
          .eq('id', incident.id)
      ).error,
    )
  })
  const aiBody = () => ({
    pet_id: petA.id,
    session_id: randomUUID(),
    request_id: randomUUID(),
    question: '请总结已有记录',
  })
  await test(
    'C12',
    'AI rejects missing/invalid Auth, malformed IDs, extra owner, overlong input and origin',
    async () => {
      assert.equal((await invoke(null, 'ai-chat', aiBody())).status, 401)
      assert.equal((await invoke(a, 'ai-chat', aiBody(), undefined, 'invalid-token')).status, 401)
      for (const extra of [
        { pet_id: 'invalid' },
        { user_id: a.id },
        { question: '长'.repeat(2001) },
        { question: '  ' },
      ])
        assert.equal((await invoke(a, 'ai-chat', { ...aiBody(), ...extra })).status, 400)
      assert.equal((await invoke(a, 'ai-chat', aiBody(), 'https://untrusted.example')).status, 403)
      const foreign = await invoke(b, 'ai-chat', aiBody())
      assert.equal(foreign.status, 404)
      assert.equal(foreign.data.error.code, 'PET_NOT_FOUND')
      assert.equal(checked(await b.db.from('ai_daily_usage').select('used')).length, 0)
    },
  )
  await test(
    'C13',
    'AI administrative RPCs and tables cannot be written by ordinary users',
    async () => {
      assert.ok(
        (
          await a.db.rpc('reserve_ai_request', {
            p_user: a.id,
            p_pet: petA.id,
            p_session: randomUUID(),
            p_request: randomUUID(),
            p_question: '禁止直接扣次',
          })
        ).error,
      )
      assert.ok(
        (
          await a.db
            .from('ai_daily_usage')
            .insert({ user_id: a.id, usage_date: '2026-10-29', used: 0 })
        ).error,
      )
      assert.ok((await a.db.from('sms_deliveries').select('*')).error)
    },
  )
  await test(
    'C14',
    '25 real concurrent server reservations enforce daily20; Edge21 is 429 with no model',
    async () => {
      const requests = Array.from({ length: 25 }, () => ({
        p_user: q.id,
        p_pet: concurrentPets[0].id,
        p_session: randomUUID(),
        p_request: randomUUID(),
        p_question: '仅额度测试，不调用模型',
      }))
      const results = await Promise.all(
        requests.map((args) => admin.rpc('reserve_ai_request', args)),
      )
      assert.equal(results.filter((r) => !r.error).length, 20)
      assert.equal(results.filter((r) => r.error?.message.includes('DAILY_LIMIT')).length, 5)
      for (let i = 0; i < requests.length; i++)
        if (!results[i].error)
          await rpc(admin, 'finish_ai_request', {
            p_request: requests[i].p_request,
            p_answer: null,
            p_error: 'TEST_CANCELLED_NO_UPSTREAM',
            p_model: 'quota-test',
            p_prompt: 0,
            p_completion: 0,
            p_latency: 0,
          })
      const limited = await invoke(q, 'ai-chat', { ...aiBody(), pet_id: concurrentPets[0].id })
      assert.equal(limited.status, 429)
      assert.equal(limited.data.error.code, 'DAILY_LIMIT')
      return { accepted: 20, rejected: 5, upstreamCalls: 0 }
    },
  )
  if (process.env.TEST_ENABLE_AI === 'yes') {
    await test(
      'C15',
      'real DeepSeek context, fixed disclaimer, tokens, saved history, same-ID cache and conflict',
      async () => {
        const body = {
          ...aiBody(),
          question:
            '请仅总结当前宠物的名称、最近喂食名称和数量、体重，保留原始数字和单位，缺少的信息说明缺少，不推荐药物。',
        }
        report.modelCalls++
        const result = await invoke(a, 'ai-chat', body)
        assert.equal(result.status, 200)
        const answer = result.data.answer
        assert.ok(answer.includes('42') && /4\.1\s*(kg|千克|公斤)/i.test(answer))
        assert.ok(!answer.includes('8.2') && !answer.includes('仅B隔离狗粮'))
        const disclaimer =
          '以上建议仅供参考，不构成诊疗意见。如症状持续或加重，请及时联系线下宠物医院。'
        assert.ok(answer.endsWith(disclaimer))
        assert.equal(answer.split(disclaimer).length - 1, 1)
        assert.equal(
          checked(
            await a.db
              .from('ai_conversations')
              .select('role,content')
              .eq('request_id', body.request_id),
          ).length,
          2,
        )
        assert.equal(
          checked(
            await b.db.from('ai_conversations').select('id').eq('request_id', body.request_id),
          ).length,
          0,
        )
        const log = checked(
          await a.db
            .from('ai_requests')
            .select('status,model,prompt_tokens,completion_tokens,latency_ms')
            .eq('id', body.request_id)
            .single(),
        )
        assert.equal(log.status, 'succeeded')
        assert.ok(log.prompt_tokens > 0 && log.completion_tokens > 0)
        assert.equal((await invoke(a, 'ai-chat', body)).data.answer, answer)
        assert.equal(
          (await invoke(a, 'ai-chat', { ...body, question: '更换内容应冲突' })).status,
          409,
        )
        assert.equal(checked(await a.db.from('ai_daily_usage').select('used').single()).used, 1)
        return { ...log, answer }
      },
    )
  } else {
    report.checks.push({
      id: 'C15',
      status: 'skipped',
      name: 'real model requires TEST_ENABLE_AI=yes',
    })
    await save()
  }
  await test(
    'C16',
    'emergency gives immediate offline-hospital advice, logs zero model tokens',
    async () => {
      const body = { ...aiBody(), question: '宠物正在大量出血和抽搐，应该怎么办？' }
      const result = await invoke(a, 'ai-chat', body)
      assert.equal(result.status, 200)
      assert.ok(result.data.answer.includes('立即') && result.data.answer.includes('线下宠物医院'))
      const log = checked(
        await a.db
          .from('ai_requests')
          .select('prompt_tokens,completion_tokens')
          .eq('id', body.request_id)
          .single(),
      )
      assert.equal(log.prompt_tokens + log.completion_tokens, 0)
    },
  )
  await test(
    'C17',
    'explicit community membership, private drafts, owner checks and three tags',
    async () => {
      const bad = await a.db.rpc('community_create_post', {
        p_id: randomUUID(),
        p_body: '未开通社区不能发布',
      })
      assert.ok(bad.error)
      await rpc(a.db, 'community_set_profile', { p_nickname: '全面测试宠友A' })
      await rpc(b.db, 'community_set_profile', { p_nickname: '全面测试宠友B' })
      post = randomUUID()
      await rpc(a.db, 'community_create_post', {
        p_id: post,
        p_body: '临时全面测试：友好交流，随后清理。',
        p_pet: petA.id,
        p_tags: ['猫咪', '日常', '测试'],
      })
      assert.equal(
        checked(await b.db.from('community_posts').select('id').eq('id', post)).length,
        0,
      )
      assert.ok((await b.db.rpc('community_publish', { p_post: post, p_images: [] })).error)
      assert.equal(
        await rpc(a.db, 'community_publish', { p_post: post, p_images: [] }),
        'published',
      )
      const item = (await rpc(b.db, 'community_feed', { p_post: post }))[0]
      assert.deepEqual(item.tags, ['猫咪', '日常', '测试'])
      assert.equal(item.pet_label, petA.name)
      assert.equal(item.pet_id, undefined)
      assert.ok(
        (await a.db.from('community_posts').update({ status: 'published' }).eq('id', post)).error,
      )
    },
  )
  await test(
    'C18',
    'server blocks sensitive, excessive/duplicate tags and overlong post/comments',
    async () => {
      for (const args of [
        { p_body: '裸 聊' },
        { p_tags: ['1', '2', '3', '4'] },
        { p_tags: ['重复', '重复'] },
        { p_body: '长'.repeat(1001) },
        { p_tags: ['裸\u200b聊'] },
      ])
        assert.ok(
          (
            await a.db.rpc('community_create_post', {
              p_id: randomUUID(),
              p_body: '正常测试正文',
              p_pet: null,
              p_tags: [],
              ...args,
            })
          ).error,
        )
      for (const p_body of ['长'.repeat(501), '裸 聊'])
        assert.ok(
          (await b.db.rpc('community_add_comment', { p_id: randomUUID(), p_post: post, p_body }))
            .error,
        )
      assert.ok(
        (await b.db.rpc('community_review', { p_post: post, p_approve: false, p_note: '越权' }))
          .error,
      )
    },
  )
  await test(
    'C19',
    'eight concurrent likes count once; favorites private; unfollow/cancel idempotent',
    async () => {
      await Promise.all(
        Array.from({ length: 8 }, () =>
          rpc(b.db, 'community_interact', { p_target: post, p_kind: 'like', p_enabled: true }),
        ),
      )
      await rpc(b.db, 'community_interact', { p_target: post, p_kind: 'favorite', p_enabled: true })
      assert.equal((await rpc(b.db, 'community_feed', { p_post: post }))[0].like_count, 1)
      assert.equal(
        checked(await a.db.from('community_favorites').select('post_id').eq('post_id', post))
          .length,
        0,
      )
      assert.ok(
        (await rpc(b.db, 'community_feed', { p_mode: 'favorites' })).some((p) => p.id === post),
      )
      for (let i = 0; i < 2; i++)
        await rpc(b.db, 'community_interact', { p_target: post, p_kind: 'like', p_enabled: false })
      assert.equal((await rpc(b.db, 'community_feed', { p_post: post }))[0].like_count, 0)
      await rpc(b.db, 'community_interact', {
        p_target: post,
        p_kind: 'favorite',
        p_enabled: false,
      })
    },
  )
  await test('C20', 'follow feeds and follower/following counts/lists then unfollow', async () => {
    await rpc(b.db, 'community_interact', { p_target: a.id, p_kind: 'follow', p_enabled: true })
    assert.ok(
      (await rpc(b.db, 'community_feed', { p_mode: 'following' })).some((p) => p.id === post),
    )
    assert.ok(
      (await rpc(a.db, 'community_people', { p_user: a.id, p_list: 'followers' })).some(
        (p) => p.user_id === b.id,
      ),
    )
    assert.ok(
      (await rpc(b.db, 'community_people', { p_user: b.id, p_list: 'following' })).some(
        (p) => p.user_id === a.id,
      ),
    )
    assert.equal((await rpc(a.db, 'community_person', { p_user: a.id })).follower_count, 1)
    await rpc(b.db, 'community_interact', { p_target: a.id, p_kind: 'follow', p_enabled: false })
    assert.equal((await rpc(a.db, 'community_person', { p_user: a.id })).follower_count, 0)
  })
  await test(
    'C21',
    'comments retry once, one-level reply, foreign delete denied and private reports',
    async () => {
      comment = randomUUID()
      reply = randomUUID()
      for (let i = 0; i < 2; i++)
        await rpc(a.db, 'community_add_comment', {
          p_id: comment,
          p_post: post,
          p_body: '临时父评论',
        })
      await rpc(b.db, 'community_add_comment', {
        p_id: reply,
        p_post: post,
        p_body: '临时回复',
        p_parent: comment,
      })
      assert.ok(
        (
          await b.db.rpc('community_add_comment', {
            p_id: randomUUID(),
            p_post: post,
            p_body: '拒绝二层回复',
            p_parent: reply,
          })
        ).error,
      )
      assert.ok((await b.db.rpc('community_delete_comment', { p_comment: comment })).error)
      for (let i = 0; i < 2; i++)
        await rpc(b.db, 'community_report', {
          p_id: randomUUID(),
          p_reason: '临时举报测试',
          p_comment: comment,
        })
      assert.equal(
        checked(await b.db.from('community_reports').select('id').eq('comment_id', comment)).length,
        1,
      )
      assert.equal(
        checked(await a.db.from('community_reports').select('id').eq('comment_id', comment)).length,
        0,
      )
      assert.equal(
        checked(await a.db.from('community_comments').select('id').eq('post_id', post)).length,
        2,
      )
    },
  )
  await test(
    'C22',
    'manual comment review dismisses report; parent deletion cascades reply/report',
    async () => {
      const changed = checked(
        await admin
          .from('community_reports')
          .update({ status: 'dismissed' })
          .eq('comment_id', comment)
          .eq('status', 'open')
          .select('id,status'),
      )
      assert.equal(changed.length, 1)
      assert.equal(changed[0].status, 'dismissed')
      assert.equal(
        checked(await admin.from('community_comments').select('id').eq('id', comment)).length,
        1,
      )
      await rpc(a.db, 'community_report', {
        p_id: randomUUID(),
        p_reason: '回复级联测试',
        p_comment: reply,
      })
      checked(
        await admin.from('community_comments').delete().eq('id', comment).eq('body', '临时父评论'),
      )
      assert.equal(
        checked(await admin.from('community_comments').select('id').in('id', [comment, reply]))
          .length,
        0,
      )
      assert.equal(
        checked(
          await admin.from('community_reports').select('id').in('comment_id', [comment, reply]),
        ).length,
        0,
      )
    },
  )
  await test(
    'C23',
    'community real image: private draft, auto-publication, full signed image and takedown',
    async () => {
      imagePost = randomUUID()
      await rpc(a.db, 'community_create_post', {
        p_id: imagePost,
        p_body: '临时图文审核',
        p_pet: null,
        p_tags: [],
      })
      imagePath = `${a.id}/posts/${imagePost}/${randomUUID()}.png`
      await upload(a.db, 'community-media', imagePath)
      assert.ok((await b.db.storage.from('community-media').createSignedUrl(imagePath, 60)).error)
      assert.ok(
        (
          await a.db.rpc('community_publish', {
            p_post: imagePost,
            p_images: [imagePath, imagePath],
          })
        ).error,
      )
      assert.equal(
        await rpc(a.db, 'community_publish', { p_post: imagePost, p_images: [imagePath] }),
        'published',
      )
      const signed = checked(
        await b.db.storage.from('community-media').createSignedUrl(imagePath, 60),
      )
      assert.equal((await fetch(signed.signedUrl)).status, 200)
      await rpc(admin, 'community_review', {
        p_post: imagePost,
        p_approve: false,
        p_note: '临时下架测试',
      })
      assert.equal(
        checked(await b.db.from('community_posts').select('id').eq('id', imagePost)).length,
        0,
      )
      assert.ok((await b.db.storage.from('community-media').createSignedUrl(imagePath, 60)).error)
      assert.ok(
        (await a.db.rpc('community_publish', { p_post: imagePost, p_images: [imagePath] })).error,
      )
    },
  )
  await test(
    'C24',
    'old history hidden after30days; three real recent weights stay owner-scoped',
    async () => {
      checked(
        await a.db.from('records').insert(
          [4.0, 4.1, 4.2].map((weight, i) => ({
            pet_id: petA.id,
            type: 'weight',
            content: { weight },
            occurred_at: new Date(Date.now() - (3 - i) * 86400000).toISOString(),
          })),
        ),
      )
      assert.equal(
        checked(await a.db.from('records').select('id').eq('pet_id', petA.id).eq('type', 'weight'))
          .length,
        4,
      )
      assert.equal(checked(await b.db.from('records').select('id').eq('pet_id', petA.id)).length, 0)
      const sid = randomUUID(),
        rid = randomUUID()
      await rpc(admin, 'reserve_ai_request', {
        p_user: a.id,
        p_pet: petA.id,
        p_session: sid,
        p_request: rid,
        p_question: '过期历史权限测试',
      })
      await rpc(admin, 'finish_ai_request', {
        p_request: rid,
        p_answer: '仅历史权限测试夹具，不是模型回答。',
        p_error: null,
        p_model: 'history-fixture',
        p_prompt: 0,
        p_completion: 0,
        p_latency: 0,
      })
      checked(
        await admin
          .from('ai_conversations')
          .update({ created_at: new Date(Date.now() - 31 * 86400000).toISOString() })
          .eq('request_id', rid),
      )
      assert.equal(
        checked(await a.db.from('ai_conversations').select('id').eq('request_id', rid)).length,
        0,
      )
      assert.equal(
        checked(await admin.from('ai_conversations').select('id').eq('request_id', rid)).length,
        2,
      )
    },
  )
  await test(
    'C25',
    'pet deletion cascades records/AI; image queue drained through actual cleanup function',
    async () => {
      checked(await a.db.from('pets').delete().eq('id', petA.id))
      for (const table of ['records', 'ai_sessions', 'ai_requests', 'ai_conversations'])
        assert.equal(checked(await admin.from(table).select('id').eq('pet_id', petA.id)).length, 0)
      assert.ok(checked(await a.db.from('storage_cleanup').select('path')).length >= 10)
      const result = await invoke(a, 'storage-cleanup', {})
      assert.equal(result.status, 200)
      assert.equal(checked(await a.db.from('storage_cleanup').select('path')).length, 0)
      assert.ok((await a.db.storage.from('pet-media').download(avatar)).error)
      await rpc(a.db, 'community_delete_post', { p_post: imagePost })
      assert.equal((await invoke(a, 'storage-cleanup', {})).status, 200)
      assert.equal(checked(await a.db.from('community_media_cleanup').select('path')).length, 0)
    },
  )
  await test(
    'C26',
    'sign out revokes this session and private access requires login again',
    async () => {
      checked(await b.db.auth.signOut({ scope: 'local' }))
      assert.equal(checked(await b.db.auth.getSession()).session, null)
      assert.ok((await b.db.from('pets').select('id')).error)
      assert.equal((await invoke(null, 'storage-cleanup', {})).status, 401)
    },
  )
} catch {
  process.exitCode = 1
  if (!report.checks.some((c) => c.status === 'failed'))
    report.failure = 'Setup or unrecorded step failed; raw response suppressed.'
} finally {
  // User IDs are from this run's createUser responses only, never from supplied existing accounts.
  for (const { bucket, path } of uploads) {
    try {
      checked(await admin.storage.from(bucket).remove([path]))
    } catch {
      // A business cleanup may already have removed this object. Verify absence;
      // a failed request alone must never be reported as successful cleanup.
      const slash = path.lastIndexOf('/')
      const probe = await admin.storage.from(bucket).list(path.slice(0, slash), {
        search: path.slice(slash + 1),
      })
      if (probe.error || probe.data.some((entry) => entry.name === path.slice(slash + 1)))
        report.cleanupErrors.push(`object:${bucket}:${path}`)
    }
  }
  for (const account of accounts) {
    try {
      checked(await admin.from('community_posts').delete().eq('user_id', account.id))
      checked(await admin.from('pets').delete().eq('user_id', account.id))
      checked(await admin.auth.admin.deleteUser(account.id))
      checked(await admin.from('storage_cleanup').delete().eq('user_id', account.id))
      checked(await admin.from('community_media_cleanup').delete().eq('user_id', account.id))
      for (const table of ['pets', 'records', 'community_posts', 'ai_requests'])
        assert.equal(
          checked(await admin.from(table).select('id').eq('user_id', account.id)).length,
          0,
        )
      assert.equal(checked(await admin.from('users').select('id').eq('id', account.id)).length, 0)
    } catch {
      report.cleanupErrors.push(`account:${account.id}`)
    }
    await account.db.auth.signOut({ scope: 'local' }).catch(() => {})
  }
  report.finished_at = new Date().toISOString()
  report.completed =
    report.checks.filter((c) => c.status === 'passed').length === 26 &&
    report.cleanupErrors.length === 0
  if (!report.completed) process.exitCode = 1
  await save()
  console.log(
    `Finished: ${report.checks.filter((c) => c.status === 'passed').length}/26 cloud groups passed; cleanup errors=${report.cleanupErrors.length}.`,
  )
}
