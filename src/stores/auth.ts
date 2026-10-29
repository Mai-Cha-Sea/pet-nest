/**
 * 全应用共享的 Supabase 会话状态，只保存 SDK 返回的当前身份。
 * initAuth 在 main.ts 调用一次；不在每个页面重新注册认证监听。
 * userId 供前端组装请求使用，服务端不能信任浏览器传来的 owner。
 */
import { ref } from 'vue'
import type { Session } from '@supabase/supabase-js'
import { supabase, client } from '../lib/supabase'
export const session = ref<Session | null>(null)
export const authReady = ref(false)
export let authPromise: Promise<void>
/**
 * 恢复本地 SDK 会话并订阅后续登录/退出事件。
 * 返回与路由共享的启动 Promise；仅在应用入口执行一次。
 */
export function initAuth() {
  authPromise = (async () => {
    if (!supabase) {
      authReady.value = true
      return
    }
    const { data, error } = await supabase.auth.getSession()
    if (!error) session.value = data.session
    supabase.auth.onAuthStateChange((_event, value) => {
      session.value = value
    })
    authReady.value = true
  })()
  return authPromise
}
/**
 * 返回当前前端会话的用户 UUID；没有会话时抛 UNAUTHORIZED。
 * 调用者仍需处理服务端因 token 过期或权限变化而拒绝请求的情况。
 */
export function userId() {
  if (!session.value) throw new Error('UNAUTHORIZED')
  return session.value.user.id
}
/**
 * 请求 SDK 退出，成功后清空共享会话；失败交给页面提示。
 */
export async function signOut() {
  const { error } = await client().auth.signOut()
  if (error) throw error
  session.value = null
}
