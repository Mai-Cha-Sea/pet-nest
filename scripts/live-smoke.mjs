/**
 * 真实开发项目的双账号基础联调，会创建宠物/记录/图片并在 finally 尝试清理本轮数据。
 * 必须显式 TEST_ALLOW_WRITES=yes；只有 TEST_ENABLE_AI=yes 才发真实模型请求并可能消耗额度。
 * 凭据由进程环境提供，不能用生产账号或把结果误当全部生产验收。
 */
import { createClient } from '@supabase/supabase-js'
import assert from 'node:assert/strict'

const required = [
  'TEST_SUPABASE_URL',
  'TEST_SUPABASE_ANON_KEY',
  'TEST_USER_A_EMAIL',
  'TEST_USER_A_PASSWORD',
  'TEST_USER_B_EMAIL',
  'TEST_USER_B_PASSWORD',
]
const missing = required.filter(
  (name) => !process.env[name] || process.env[name].startsWith('your-'),
)
if (missing.length || process.env.TEST_ALLOW_WRITES !== 'yes') {
  console.log('SKIPPED: 真实 Supabase 双账号测试未运行。')
  console.log(
    '请按 .env.test.example 配置两个已确认邮箱的测试账号，并仅在测试项目设置 TEST_ALLOW_WRITES=yes。',
  )
  process.exitCode = 2
} else {
  const connect = () =>
    createClient(process.env.TEST_SUPABASE_URL, process.env.TEST_SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  const a = connect(),
    b = connect()
  let petId,
    recordIds = []
  const checked = ({ data, error }) => {
    if (error) throw new Error(`Supabase 操作失败 (${error.code || error.name || 'unknown'})`)
    return data
  }
  try {
    const userA = checked(
      await a.auth.signInWithPassword({
        email: process.env.TEST_USER_A_EMAIL,
        password: process.env.TEST_USER_A_PASSWORD,
      }),
    ).user
    const userB = checked(
      await b.auth.signInWithPassword({
        email: process.env.TEST_USER_B_EMAIL,
        password: process.env.TEST_USER_B_PASSWORD,
      }),
    ).user
    assert.notEqual(userA.id, userB.id, '必须提供不同账号')
    const p = checked(
      await a
        .from('pets')
        .insert({ name: `验收-${Date.now()}`, species: 'cat', weight: 4.1 })
        .select()
        .single(),
    )
    petId = p.id
    assert.equal(checked(await b.from('pets').select('id').eq('id', petId)).length, 0)
    assert.equal(
      checked(await b.from('pets').update({ name: '禁止越权' }).eq('id', petId).select()).length,
      0,
    )
    const records = checked(
      await a
        .from('records')
        .insert([
          {
            pet_id: petId,
            type: 'feeding',
            content: { food: '验收干粮', amount: 42, unit: 'g' },
            occurred_at: new Date().toISOString(),
          },
          {
            pet_id: petId,
            type: 'weight',
            content: { weight: 4.1 },
            occurred_at: new Date().toISOString(),
          },
        ])
        .select(),
    )
    recordIds = records.map((r) => r.id)
    assert.equal(checked(await b.from('records').select('id').eq('pet_id', petId)).length, 0)
    const forged = await b.from('records').insert({
      pet_id: petId,
      type: 'bath',
      content: { note: '' },
      occurred_at: new Date().toISOString(),
    })
    assert.ok(forged.error, '跨用户插入必须失败')
    const fresh = connect()
    checked(
      await fresh.auth.signInWithPassword({
        email: process.env.TEST_USER_A_EMAIL,
        password: process.env.TEST_USER_A_PASSWORD,
      }),
    )
    assert.equal(
      checked(await fresh.from('records').select('id').eq('pet_id', petId)).length,
      2,
      '新建客户端仍可读取持久化记录',
    )
    const imagePath = `${userA.id}/pets/${petId}/avatar/${crypto.randomUUID()}.png`
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4rUAAAAASUVORK5CYII=',
      'base64',
    )
    checked(await a.storage.from('pet-media').upload(imagePath, png, { contentType: 'image/png' }))
    checked(await a.from('pets').update({ avatar_path: imagePath }).eq('id', petId))
    assert.ok((await b.storage.from('pet-media').download(imagePath)).error, '他人下载必须失败')
    assert.ok(checked(await a.storage.from('pet-media').createSignedUrl(imagePath, 60)).signedUrl)
    if (process.env.TEST_ENABLE_AI === 'yes') {
      const body = {
        pet_id: petId,
        session_id: crypto.randomUUID(),
        request_id: crypto.randomUUID(),
        question:
          '请根据我的宠物档案和最近喂食、体重记录，总结已经记录的事实和日常观察建议，不要诊断或推荐用药。',
      }
      const result = checked(await a.functions.invoke('ai-chat', { body }))
      assert.ok(result.answer?.includes('以上建议仅供参考'))
      const duplicate = checked(await a.functions.invoke('ai-chat', { body }))
      assert.equal(duplicate.answer, result.answer)
      assert.equal(
        checked(await a.from('ai_conversations').select('role').eq('request_id', body.request_id))
          .length,
        2,
      )
      const rejected = await b.functions.invoke('ai-chat', {
        body: { ...body, session_id: crypto.randomUUID(), request_id: crypto.randomUUID() },
      })
      assert.ok(rejected.error)
      console.log(
        'PASS: 真实 AI 调用、幂等复用、历史保存和跨用户拒绝。请人工核对回答中的 42g / 4.1kg 事实引用。',
      )
    } else console.log('SKIPPED: 真实 AI 调用（TEST_ENABLE_AI 未设为 yes）。')
    console.log('PASS: 双账号登录、宠物/记录隔离、喂食/体重持久化、私有图片上传/访问。')
  } catch (error) {
    console.error('FAIL:', error instanceof Error ? error.message : '未知错误')
    process.exitCode = 1
  } finally {
    if (petId) {
      const deleted = await a.from('pets').delete().eq('id', petId)
      if (deleted.error) {
        console.error('CLEANUP FAILED: 请在测试项目检查本次验收宠物。')
        process.exitCode = 1
      } else {
        const remaining = await a.from('records').select('id').in('id', recordIds)
        if (remaining.error || remaining.data?.length) {
          console.error('CLEANUP FAILED: 关联记录仍存在或无法验证。')
          process.exitCode = 1
        }
        const clean = await a.functions.invoke('storage-cleanup', { body: {} })
        if (clean.error) {
          console.error('CLEANUP PENDING: 图片仍在数据库清理队列，请部署函数后重试清理。')
          process.exitCode = 1
        }
      }
    }
    await Promise.allSettled([a.auth.signOut(), b.auth.signOut()])
  }
}
