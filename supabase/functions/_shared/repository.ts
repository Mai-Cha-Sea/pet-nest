/**
 * AIRepository 的 Supabase 实现，只由服务端高权限客户端创建。
 * 因为 service_role 可绕过 RLS，context 查询必须显式带已验证 user/pet/session。
 * 每日计次、同会话并发与问答落库交给事务 RPC，不能改成前端读计数后加一。
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AIRepository } from './ai-handler.ts'
import type { ContextData } from './ai-core.ts'
/**
 * 将客户端适配为 AI 持久化接口；调用方必须传入服务端客户端，不能用于浏览器。
 */
export function repository(db: SupabaseClient): AIRepository {
  return {
    /**
     * 调用事务 RPC，额度锁与同 ID 幂等都在数据库完成，不在 Edge 进程内计数。
     */
    async reserve(user, pet, session, request, question) {
      const { data, error } = await db.rpc('reserve_ai_request', {
        p_user: user,
        p_pet: pet,
        p_session: session,
        p_request: request,
        p_question: question,
      })
      if (error) throw new Error(error.message)
      return data
    },
    /**
     * 并行读取白名单档案、最多 101 条近期记录和 10 次成功请求。
     * 第 101 条仅用于检测截断；成功请求转为按时间升序的完整问答对。
     */
    async context(user, pet, session, since) {
      const [p, r, requests] = await Promise.all([
        db
          .from('pets')
          .select('name,species,breed,gender,date_kind,birth_date,weight,sterilized,remark')
          .eq('id', pet)
          .eq('user_id', user)
          .single(),
        db
          .from('records')
          .select('type,content,occurred_at,image_paths')
          .eq('pet_id', pet)
          .eq('user_id', user)
          .gte('occurred_at', since)
          .lte('occurred_at', new Date().toISOString())
          .order('occurred_at', { ascending: false })
          .limit(101),
        db
          .from('ai_requests')
          .select('question,answer,created_at')
          .eq('user_id', user)
          .eq('pet_id', pet)
          .eq('session_id', session)
          .eq('status', 'succeeded')
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(10),
      ])
      if (p.error || r.error || requests.error) throw new Error('DATABASE_UNAVAILABLE')
      const history = requests.data.reverse().flatMap((q) => [
        { role: 'user' as const, content: q.question },
        { role: 'assistant' as const, content: q.answer },
      ])
      return {
        pet: p.data,
        records: r.data.slice(0, 100),
        history,
        recordsTruncated: r.data.length > 100,
      } as ContextData
    },
    /**
     * 由 finish_ai_request 事务持久化结果，失败映射 SAVE_FAILED；不向日志输出数据库载荷。
     */
    async finish(request, answer, errorCode, model, prompt, completion, latency) {
      const { error } = await db.rpc('finish_ai_request', {
        p_request: request,
        p_answer: answer,
        p_error: errorCode,
        p_model: model,
        p_prompt: prompt,
        p_completion: completion,
        p_latency: latency,
      })
      if (error) throw new Error('SAVE_FAILED')
    },
  }
}
