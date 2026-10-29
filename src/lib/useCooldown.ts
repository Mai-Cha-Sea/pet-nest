/**
 * 验证码按钮的组件级倒计时，卸载后释放定时器。
 * 只改善操作体验；实际发送频率与验证码有效期由认证服务及短信后端限制。
 */
import { onBeforeUnmount, ref } from 'vue'
/**
 * 返回响应式 remaining（秒）和 start 方法。
 * 按截止时间计算，降低后台标签页定时器被节流带来的累计误差。
 */
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
