import { createClient } from '@supabase/supabase-js'
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY
export const configured =
  !!url && !!key && !url.includes('your-project') && !key.startsWith('your-')
export const supabase = configured
  ? createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null
export function client() {
  if (!supabase) throw new Error('请先在 .env.local 中配置 Supabase 项目地址和公开密钥。')
  return supabase
}
