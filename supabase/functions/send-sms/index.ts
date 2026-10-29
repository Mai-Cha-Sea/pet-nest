/**
 * Supabase Auth Send SMS Hook 的服务端入口，委托已验签 handler 发送阿里云短信。
 * 本函数不采用浏览器 JWT 鉴权；Hook 原始正文和标准签名才是调用凭据。
 * sms_deliveries 只记录事件 ID/状态/供应商代码，不保存号码、验证码或请求内容。
 */
import { createClient } from '@supabase/supabase-js'
import { createSmsHandler } from '../_shared/sms-handler.ts'
import type { SmsRepository } from '../_shared/sms-handler.ts'

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const repo: SmsRepository = {
  /**
   * 以事件唯一键抢占发送；主键冲突读取已有状态，绝不把回调重试当成新的短信。
   */
  async reserve(id) {
    const { error } = await db.from('sms_deliveries').insert({ event_id: id })
    if (!error) return { duplicate: false, status: 'pending' }
    if (error.code !== '23505') throw error
    const result = await db.from('sms_deliveries').select('status').eq('event_id', id).single()
    if (result.error) throw result.error
    return { duplicate: true, status: result.data.status }
  },
  /**
   * 只允许 pending 转为最终结果，记录去敏供应商代码和时间；零行更新也视为失败。
   */
  async finish(id, status, code) {
    const { error, data } = await db
      .from('sms_deliveries')
      .update({ status, provider_code: code, finished_at: new Date().toISOString() })
      .eq('event_id', id)
      .eq('status', 'pending')
      .select('event_id')
    if (error || !data?.length) throw error || new Error('SMS_LOG_NOT_UPDATED')
  },
}
Deno.serve(createSmsHandler({ env: (name) => Deno.env.get(name), fetch, repo }))
