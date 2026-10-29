/**
 * 开发云端高级验收，会使用受控管理权限并保留专用演示/QA 数据供核查。
 * 需同时提供测试凭据及显式写入/管理开关；不能当作只读检查或临时账号自动清理工具。
 * 云端写入、真实模型开关和数据保留范围见 docs/TESTING.md；禁止在生产库直接运行。
 */
// Explicitly opted-in acceptance checks for a disposable DEVELOPMENT project.
// Requires .env.test.local plus a server-only TEST_ADMIN_KEY in the process env.
import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'

try {
  process.loadEnvFile('.env.test.local')
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
const required = [
  'TEST_SUPABASE_URL',
  'TEST_SUPABASE_ANON_KEY',
  'TEST_USER_A_EMAIL',
  'TEST_USER_A_PASSWORD',
  'TEST_USER_B_EMAIL',
  'TEST_USER_B_PASSWORD',
]
if (
  required.some((name) => !process.env[name] || process.env[name].startsWith('your-')) ||
  process.env.TEST_ALLOW_WRITES !== 'yes' ||
  process.env.TEST_ALLOW_ADMIN_TESTS !== 'yes' ||
  !process.env.TEST_ADMIN_KEY
) {
  console.log(
    'SKIPPED: requires explicit development writes/admin opt-in and a server-only admin credential.',
  )
  process.exit(2)
}
const url = process.env.TEST_SUPABASE_URL,
  key = process.env.TEST_SUPABASE_ANON_KEY
const connect = (apiKey = key) =>
  createClient(url, apiKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(65000) }),
    },
  })
const checked = ({ data, error }) => {
  if (error)
    throw new Error(
      `Supabase check failed (${error.code || error.status || error.name || 'unknown'})`,
    )
  return data
}
const report = { project: new URL(url).hostname, checks: [], created_at: new Date().toISOString() }
await fs.mkdir('test-results', { recursive: true })
const save = () =>
  fs.writeFile('test-results/cloud-acceptance.json', JSON.stringify(report, null, 2))
const pass = async (name, details = {}) => {
  report.checks.push({ name, ...details, status: 'passed' })
  await save()
  console.log(`PASS: ${name}`)
}
const admin = connect(process.env.TEST_ADMIN_KEY),
  a = connect(),
  b = connect()
try {
  const authA = checked(
    await a.auth.signInWithPassword({
      email: process.env.TEST_USER_A_EMAIL,
      password: process.env.TEST_USER_A_PASSWORD,
    }),
  )
  const authB = checked(
    await b.auth.signInWithPassword({
      email: process.env.TEST_USER_B_EMAIL,
      password: process.env.TEST_USER_B_PASSWORD,
    }),
  )
  assert.notEqual(authA.user.id, authB.user.id)
  await pass('two real confirmed development accounts signed in')

  // A separate internal QA account keeps quota/load fixtures out of A/B's normal experience.
  const qaEmail = `petnest-internal-qa-${Date.now().toString(36)}@example.com`
  const qaPassword = `Nest!9-${crypto.randomBytes(24).toString('base64url')}`
  const qaUser = checked(
    await admin.auth.admin.createUser({
      email: qaEmail,
      password: qaPassword,
      email_confirm: true,
      user_metadata: { nickname: '内部并发验收', purpose: 'petnest-internal-qa' },
    }),
  ).user
  await fs.writeFile(
    `test-results/qa-credentials-${qaUser.id}.env.local`,
    `TEST_QA_EMAIL=${qaEmail}\nTEST_QA_PASSWORD=${qaPassword}\nTEST_QA_ID=${qaUser.id}\n`,
    { flag: 'wx' },
  )
  const qa = connect()
  checked(await qa.auth.signInWithPassword({ email: qaEmail, password: qaPassword }))
  const petAttempts = await Promise.allSettled(
    Array.from({ length: 12 }, (_, i) =>
      qa
        .from('pets')
        .insert({ name: `并发验收-${i + 1}`, species: 'other' })
        .select('id')
        .single()
        .then((result) => {
          if (result.error) throw result.error
          return result.data
        }),
    ),
  )
  const createdPets = petAttempts.filter((r) => r.status === 'fulfilled').map((r) => r.value)
  const rejectedPets = petAttempts.filter((r) => r.status === 'rejected')
  assert.equal(createdPets.length, 10)
  assert.equal(rejectedPets.length, 2)
  assert.ok(rejectedPets.every((r) => r.reason.message.includes('PET_LIMIT')))
  await pass('12 concurrent authenticated pet inserts result in exactly 10 pets', {
    created: 10,
    rejected: 2,
  })

  const planned = Array.from({ length: 25 }, (_, i) => ({
    id: crypto.randomUUID(),
    session: crypto.randomUUID(),
    question: `并发额度验收 ${i + 1}（不调用模型）`,
  }))
  const reservations = await Promise.allSettled(
    planned.map((item) =>
      admin
        .rpc('reserve_ai_request', {
          p_user: qaUser.id,
          p_pet: createdPets[0].id,
          p_session: item.session,
          p_request: item.id,
          p_question: item.question,
        })
        .then((result) => {
          if (result.error) throw result.error
          return result.data
        }),
    ),
  )
  assert.equal(reservations.filter((r) => r.status === 'fulfilled').length, 20)
  assert.equal(reservations.filter((r) => r.status === 'rejected').length, 5)
  assert.ok(
    reservations
      .filter((r) => r.status === 'rejected')
      .every((r) => r.reason.message.includes('DAILY_LIMIT')),
  )
  await Promise.all(
    planned
      .filter((_, i) => reservations[i].status === 'fulfilled')
      .map((item) =>
        admin
          .rpc('finish_ai_request', {
            p_request: item.id,
            p_answer: null,
            p_error: 'TEST_CANCELLED_NO_UPSTREAM',
            p_model: 'rpc-concurrency-test',
            p_prompt: 0,
            p_completion: 0,
            p_latency: 0,
          })
          .then(checked),
      ),
  )
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
  assert.equal(
    checked(await qa.from('ai_daily_usage').select('used').eq('usage_date', day).single()).used,
    20,
  )
  const limited = await qa.functions.invoke('ai-chat', {
    body: {
      pet_id: createdPets[0].id,
      session_id: crypto.randomUUID(),
      request_id: crypto.randomUUID(),
      question: '额度已满时应拒绝',
    },
  })
  assert.equal(limited.error?.context?.status, 429)
  assert.equal((await limited.error.context.json()).error.code, 'DAILY_LIMIT')
  await pass('25 concurrent server reservations enforce 20/day; Edge request 21 returns 429', {
    accepted: 20,
    rejected: 5,
    upstreamCalls: 0,
  })

  const petA = checked(
    await a
      .from('pets')
      .insert({
        name: '团子（测试演示）',
        species: 'cat',
        weight: 4.1,
        remark: '自动验收创建的演示档案，非真实宠物。',
      })
      .select()
      .single(),
  )
  const petB = checked(
    await b
      .from('pets')
      .insert({
        name: '小麦（隔离验证）',
        species: 'dog',
        weight: 8.2,
        remark: '用于跨用户隔离验收的演示档案。',
      })
      .select()
      .single(),
  )
  report.demo = { pet_a: petA.id, pet_b: petB.id }
  const now = new Date().toISOString()
  checked(
    await a.from('records').insert([
      {
        pet_id: petA.id,
        type: 'feeding',
        content: { food: '验收干粮', amount: 42, unit: 'g' },
        occurred_at: now,
      },
      { pet_id: petA.id, type: 'weight', content: { weight: 4.1 }, occurred_at: now },
    ]),
  )
  checked(
    await b.from('records').insert({
      pet_id: petB.id,
      type: 'feeding',
      content: { food: '隔离狗粮', amount: 70, unit: 'g' },
      occurred_at: now,
    }),
  )
  assert.equal(checked(await b.from('pets').select('id').eq('id', petA.id)).length, 0)
  assert.equal(
    checked(await b.from('ai_conversations').select('id').eq('pet_id', petA.id)).length,
    0,
  )
  await pass('demonstration records persist and remain isolated between A and B')

  const body = {
    pet_id: petA.id,
    session_id: crypto.randomUUID(),
    request_id: crypto.randomUUID(),
    question:
      '请只总结当前所选宠物档案和最近记录中已提供的宠物名称、食物名称、喂食量和体重，保留记录中的原始数值和单位。缺少的信息请说明缺少，不做诊断、不推荐药物。',
  }
  const result = checked(await a.functions.invoke('ai-chat', { body }))
  assert.ok(
    result.answer.includes('42') && /4\.1\s*(kg|千克|公斤)/i.test(result.answer),
    'answer must quote selected feeding facts and the defined weight unit',
  )
  assert.ok(
    !result.answer.includes('8.2') && !result.answer.includes('隔离狗粮'),
    'other account facts must not appear',
  )
  assert.ok(
    result.answer.endsWith(
      '以上建议仅供参考，不构成诊疗意见。如症状持续或加重，请及时联系线下宠物医院。',
    ),
  )
  const history = checked(
    await a.from('ai_conversations').select('role,content').eq('session_id', body.session_id),
  )
  assert.equal(history.length, 2)
  assert.ok(history.some((m) => m.role === 'assistant' && m.content === result.answer))
  const log = checked(
    await a
      .from('ai_requests')
      .select('status,model,prompt_tokens,completion_tokens,latency_ms')
      .eq('id', body.request_id)
      .single(),
  )
  assert.equal(log.status, 'succeeded')
  assert.ok(log.prompt_tokens > 0 && log.completion_tokens > 0)
  report.demo.ai_answer = result.answer
  report.demo.ai_request = body.request_id
  await pass(
    'real DeepSeek answer quotes 42g/4.1kg, excludes B data, saves both messages and token usage',
    log,
  )

  const fresh = connect()
  checked(
    await fresh.auth.signInWithPassword({
      email: process.env.TEST_USER_A_EMAIL,
      password: process.env.TEST_USER_A_PASSWORD,
    }),
  )
  assert.equal(checked(await fresh.from('records').select('id').eq('pet_id', petA.id)).length, 2)
  assert.equal(
    checked(await fresh.from('ai_conversations').select('id').eq('session_id', body.session_id))
      .length,
    2,
  )
  assert.ok(checked(await fresh.auth.refreshSession()).session)
  await pass('new client reads persisted records/history and refreshes a real Auth session')

  const emergencyBody = {
    pet_id: petA.id,
    session_id: crypto.randomUUID(),
    request_id: crypto.randomUUID(),
    question: '宠物正在抽搐并大量出血，怎么办？',
  }
  const emergency = checked(await a.functions.invoke('ai-chat', { body: emergencyBody }))
  assert.ok(emergency.answer.includes('立即') && emergency.answer.includes('线下宠物医院'))
  const emergencyLog = checked(
    await a
      .from('ai_requests')
      .select('prompt_tokens,completion_tokens,status')
      .eq('id', emergencyBody.request_id)
      .single(),
  )
  assert.equal(emergencyLog.prompt_tokens + emergencyLog.completion_tokens, 0)
  await pass('emergency request returns offline-hospital guidance with zero model tokens')

  const noAuth = await fetch(`${url}/functions/v1/ai-chat`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify(body),
  })
  assert.equal(noAuth.status, 401)
  const invalid = await a.functions.invoke('ai-chat', {
    body: { ...body, pet_id: 'not-a-uuid', request_id: crypto.randomUUID() },
  })
  assert.equal(invalid.error?.context?.status, 400)
  const forbidden = await fetch(`${url}/functions/v1/ai-chat`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${authA.session.access_token}`,
      'Content-Type': 'application/json',
      Origin: 'https://untrusted.example',
    },
    body: JSON.stringify(body),
  })
  assert.equal(forbidden.status, 403)
  await pass('real Edge endpoints reject missing Auth, invalid pet UUID and untrusted origin')
  report.status = 'passed'
  await save()
  console.log(
    'Cloud acceptance completed. A/B demonstration data and a separate internal QA account remain for inspection; no production data was touched.',
  )
} catch (error) {
  report.status = 'failed'
  report.failure = error instanceof Error ? error.message : 'Unknown failure'
  await save()
  console.error('FAIL:', report.failure)
  process.exitCode = 1
} finally {
  await Promise.allSettled([a.auth.signOut(), b.auth.signOut()])
}
