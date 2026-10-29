/**
 * 浏览器端 Supabase 单例，仅加载 VITE_ 公开配置。
 * 未配置时允许预览界面，真正的数据操作通过 client() 给出明确错误。
 * 数据库返回类型目前以共享接口声明；类型断言不能替代 RLS 或运行时校验。
 */
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
/**
 * 获取配置完成的客户端；缺少公开连接变量时抛配置提示，避免空对象调用。
 */
export function client() {
  if (!supabase) throw new Error('请先在 .env.local 中配置 Supabase 项目地址和公开密钥。')
  return supabase
}
