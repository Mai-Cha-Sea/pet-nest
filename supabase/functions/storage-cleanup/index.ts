import { createClient } from '@supabase/supabase-js'
import { allowedOrigin, corsHeaders } from '../_shared/ai-handler.ts'
const env = (name: string) => Deno.env.get(name)
const db = createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})
Deno.serve(async (request: Request) => {
  const { origin, ok } = allowedOrigin(request, env),
    headers = corsHeaders(ok ? origin : null)
  const json = (status: number, data: unknown) =>
    new Response(JSON.stringify(data), { status, headers })
  if (!ok) return json(403, { error: { code: 'ORIGIN_DENIED' } })
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'POST') return json(405, { error: { code: 'METHOD_NOT_ALLOWED' } })
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return json(401, { error: { code: 'UNAUTHORIZED' } })
  const { data: auth, error: authError } = await db.auth.getUser(token)
  if (authError || !auth.user) return json(401, { error: { code: 'UNAUTHORIZED' } })
  let removed = 0
  for (const [table, bucket] of [
    ['storage_cleanup', 'pet-media'],
    ['community_media_cleanup', 'community-media'],
  ]) {
    const { data, error } = await db
      .from(table)
      .select('path')
      .eq('user_id', auth.user.id)
      .limit(100)
    if (error) return json(503, { error: { code: 'DATABASE_UNAVAILABLE' } })
    if (!data?.length) continue
    const paths = data.map((row) => row.path)
    const { error: removeError } = await db.storage.from(bucket).remove(paths)
    if (removeError) return json(503, { error: { code: 'STORAGE_UNAVAILABLE' } })
    const { error: queueError } = await db
      .from(table)
      .delete()
      .eq('user_id', auth.user.id)
      .in('path', paths)
    if (queueError) return json(503, { error: { code: 'DATABASE_UNAVAILABLE' } })
    removed += paths.length
  }
  return json(200, { removed })
})
