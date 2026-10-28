import { createClient } from '@supabase/supabase-js'
import { createSmsHandler } from '../_shared/sms-handler.ts'
import type { SmsRepository } from '../_shared/sms-handler.ts'

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const repo: SmsRepository = {
  async reserve(id) {
    const { error } = await db.from('sms_deliveries').insert({ event_id: id })
    if (!error) return { duplicate: false, status: 'pending' }
    if (error.code !== '23505') throw error
    const result = await db.from('sms_deliveries').select('status').eq('event_id', id).single()
    if (result.error) throw result.error
    return { duplicate: true, status: result.data.status }
  },
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
