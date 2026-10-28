import { createClient } from '@supabase/supabase-js'
import { createAIHandler } from '../_shared/ai-handler.ts'
import { repository } from '../_shared/repository.ts'
const env = (name: string) => Deno.env.get(name)
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const db = createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!, options)
const auth = createClient(env('SUPABASE_URL')!, env('SUPABASE_ANON_KEY')!, options)
Deno.serve(
  createAIHandler({
    env,
    repo: repository(db),
    fetch: globalThis.fetch.bind(globalThis),
    authenticate: async (token) => {
      const { data, error } = await auth.auth.getUser(token)
      return error ? null : data.user?.id || null
    },
  }),
)
