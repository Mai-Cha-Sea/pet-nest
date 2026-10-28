import { onBeforeUnmount, ref } from 'vue'
export function useCooldown() {
  const remaining = ref(0)
  let timer: ReturnType<typeof setInterval> | undefined
  function start(seconds = 60) {
    clearInterval(timer)
    const deadline = Date.now() + seconds * 1000
    remaining.value = seconds
    timer = setInterval(() => {
      remaining.value = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      if (!remaining.value) clearInterval(timer)
    }, 1000)
  }
  onBeforeUnmount(() => clearInterval(timer))
  return { remaining, start }
}
