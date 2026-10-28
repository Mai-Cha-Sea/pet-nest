import type { SupabaseClient } from '@supabase/supabase-js'
import type { AIRepository } from './ai-handler.ts'
import type { ContextData } from './ai-core.ts'
export function repository(db: SupabaseClient): AIRepository {
  return {
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
