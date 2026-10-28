import { ref } from 'vue'
import type { Session } from '@supabase/supabase-js'
import { supabase, client } from '../lib/supabase'
export const session = ref<Session | null>(null)
export const authReady = ref(false)
export let authPromise: Promise<void>
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
export function userId() {
  if (!session.value) throw new Error('UNAUTHORIZED')
  return session.value.user.id
}
export async function signOut() {
  const { error } = await client().auth.signOut()
  if (error) throw error
  session.value = null
}
