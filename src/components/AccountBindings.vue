<script setup lang="ts">
/**
 * 个人中心的手机号 OTP 与邮箱链接确认交互。
 * 已确认标识、待确认标识和用户正在编辑的值分开保存；重新聚焦时只核对状态，不自动重发。
 * SDK 返回可能暂时缺少 new_phone，因此不能在一次刷新后清掉用户已收到验证码的目标。
 */
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import type { User } from '@supabase/supabase-js'
import {
  getAccount,
  requestPhoneBinding,
  confirmPhoneBinding,
  requestEmailBinding,
} from '../lib/account'
import { session } from '../stores/auth'
import { errorMessage, isSmsHookTimeout, SMS_CONFIRMATION_PENDING } from '../lib/errors'
import { configured } from '../lib/supabase'
import { useCooldown } from '../lib/useCooldown'
import { chinaPhone } from '../../shared/auth'
import Notice from './Notice.vue'
import PhoneInput from './PhoneInput.vue'

const account = ref<User>(),
  loading = ref(false),
  busy = ref(false),
  error = ref(''),
  success = ref(''),
  smsNotice = ref('')
const phone = ref(''),
  email = ref(''),
  code = ref(''),
  pendingPhone = ref(''),
  pendingEmail = ref('')
const phoneCooldown = useCooldown(),
  emailCooldown = useCooldown()
const boundEmail = computed(() => (account.value?.email_confirmed_at ? account.value.email : ''))
const boundPhone = computed(() => {
  if (!account.value?.phone_confirmed_at || !account.value.phone) return ''
  try {
    return chinaPhone(account.value.phone)
  } catch {
    return ''
  }
})
/**
 * 将合法中国大陆号码转为本地 11 位用于比较；旧国际号码或无效值返回空。
 */
function localPhone(value: string) {
  try {
    return chinaPhone(value).slice(3)
  } catch {
    return ''
  }
}
const canVerifyPhone = computed(
  () => !!localPhone(phone.value) && /^\d{6}$/.test(code.value.trim()),
)
/**
 * 合并 Auth 最新状态，保留用户输入与尚待验证的号码。
 * 只有确认目标号码已绑定才清理验证码，不能把一次缺少 new_phone 的响应当作取消。
 */
function apply(user: User) {
  account.value = user
  const serverPending = localPhone(user.new_phone || '')
  if (serverPending && (!phone.value || localPhone(phone.value) === serverPending)) {
    pendingPhone.value = serverPending
    if (!phone.value) phone.value = serverPending
  } else if (
    pendingPhone.value &&
    user.phone_confirmed_at &&
    localPhone(user.phone || '') === pendingPhone.value
  ) {
    pendingPhone.value = ''
    code.value = ''
    smsNotice.value = ''
  }
  pendingEmail.value = user.new_email || ''
  if (pendingEmail.value && !email.value) email.value = pendingEmail.value
}
/**
 * 只读刷新账号；避免与发送/验证并发，用户切回邮箱确认页后可调用。
 */
async function load() {
  if (!configured || loading.value || busy.value) return
  loading.value = true
  error.value = ''
  try {
    apply(await getAccount())
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}
/**
 * 请求绑定短信并启动本地冷却；确认状态仍以 Auth 返回值及后续 OTP 为准。
 */
async function sendPhone() {
  if (busy.value || phoneCooldown.remaining.value) return
  busy.value = true
  error.value = ''
  success.value = ''
  smsNotice.value = ''
  try {
    const result = await requestPhoneBinding(phone.value)
    apply(result.user)
    if (boundPhone.value === result.phone) success.value = '手机号已完成验证并绑定。'
    else {
      pendingPhone.value = result.phone.slice(3)
      success.value = '验证码请求已提交，请查看短信。完成验证后才能使用该号码登录。'
      phoneCooldown.start()
    }
  } catch (e) {
    if (isSmsHookTimeout(e)) {
      // 请求确认超时不是号码已绑定：仅保留输入与冷却，收到的验证码仍可交给 Auth 校验。
      pendingPhone.value = localPhone(phone.value)
      phoneCooldown.start()
      smsNotice.value = SMS_CONFIRMATION_PENDING
    } else error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}
/**
 * 使用当前目标和验证码完成 phone_change，成功后才清空验证输入。
 */
async function verifyPhone() {
  if (busy.value || !canVerifyPhone.value) return
  busy.value = true
  error.value = ''
  success.value = ''
  smsNotice.value = ''
  try {
    apply(await confirmPhoneBinding(phone.value, code.value))
    code.value = ''
    phone.value = ''
    pendingPhone.value = ''
    success.value = '手机号绑定成功，可以使用手机号和原密码登录同一个账号。'
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}
/**
 * 提交待绑定邮箱并提示用户完成确认；请求被接受不等于已绑定。
 */
async function sendEmail() {
  if (busy.value || emailCooldown.remaining.value) return
  busy.value = true
  error.value = ''
  success.value = ''
  smsNotice.value = ''
  try {
    const result = await requestEmailBinding(email.value)
    apply(result.user)
    if (boundEmail.value?.toLowerCase() === result.email.toLowerCase())
      success.value = '邮箱已完成验证并绑定。'
    else {
      pendingEmail.value = result.email
      success.value =
        '确认邮件请求已提交，请打开新邮箱中的链接。若原邮箱也收到确认邮件，请一并确认。'
      emailCooldown.start()
    }
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}
/**
 * 浏览器从邮件确认返回时只刷新标识状态，不自动重发短信/邮件。
 */
function onFocus() {
  void load()
}
onMounted(() => {
  void load()
  window.addEventListener('focus', onFocus)
})
onBeforeUnmount(() => window.removeEventListener('focus', onFocus))
watch([() => session.value?.user.email, () => session.value?.user.phone], onFocus)
/**
 * 用户改为另一号码时清除旧验证码和旧成功提示，防止验证目标与代码错配。
 */
watch(phone, (next, previous) => {
  if (localPhone(next) !== localPhone(previous)) code.value = ''
  if (pendingPhone.value && localPhone(next) !== pendingPhone.value) {
    pendingPhone.value = ''
    success.value = ''
    smsNotice.value = ''
  }
})
</script>
<template>
  <section class="panel account-bindings" aria-label="账号绑定">
    <div class="section-heading">
      <h2>账号绑定</h2>
      <button class="text-button" :disabled="loading || busy || !configured" @click="load">
        刷新绑定状态
      </button>
    </div>
    <p class="muted">
      绑定后，邮箱与手机号都使用原密码，登录同一个小窝。宠物、记录和 AI 历史保持关联。
    </p>
    <Notice :error="error" :success="success" />
    <p v-if="smsNotice" class="notice" role="status">{{ smsNotice }}</p>
    <p v-if="loading && !account" role="status">正在核对账号绑定状态…</p>
    <div v-if="account" class="binding-grid">
      <section>
        <h3>绑定手机号</h3>
        <p class="binding-current">
          {{ boundPhone ? `已绑定：${boundPhone}` : '未绑定中国大陆手机号' }}
        </p>
        <form aria-label="申请手机号验证码" @submit.prevent="sendPhone">
          <PhoneInput v-model="phone" label="绑定手机号" :disabled="busy" />
          <button class="button secondary" :disabled="busy || !!phoneCooldown.remaining.value">
            {{
              phoneCooldown.remaining.value
                ? `${phoneCooldown.remaining.value} 秒后可重新发送`
                : '发送绑定验证码'
            }}
          </button>
        </form>
        <form class="binding-verification" aria-label="验证手机号" @submit.prevent="verifyPhone">
          <p v-if="pendingPhone">待验证：+86 {{ pendingPhone }}，尚未生效</p>
          <p class="muted compact">请先发送验证码，再填写短信中的 6 位数字。验证码五分钟内有效。</p>
          <label
            >短信验证码<input
              v-model="code"
              :disabled="busy"
              required
              inputmode="numeric"
              autocomplete="one-time-code"
              placeholder="请输入 6 位验证码"
              minlength="6"
              maxlength="6"
          /></label>
          <button class="button" :disabled="busy || !canVerifyPhone">验证并绑定手机号</button>
        </form>
      </section>
      <section>
        <h3>绑定邮箱</h3>
        <p class="binding-current">{{ boundEmail ? `已绑定：${boundEmail}` : '尚未绑定邮箱' }}</p>
        <p v-if="pendingEmail" class="notice">待验证：{{ pendingEmail }}，完成邮件确认后才生效。</p>
        <form aria-label="绑定邮箱" @submit.prevent="sendEmail">
          <label
            >绑定邮箱<input
              v-model="email"
              :disabled="busy"
              type="email"
              required
              maxlength="128"
              autocomplete="email"
              placeholder="请输入你的邮箱"
          /></label>
          <button class="button secondary" :disabled="busy || !!emailCooldown.remaining.value">
            {{
              emailCooldown.remaining.value
                ? `${emailCooldown.remaining.value} 秒后可重新发送`
                : '发送邮箱确认邮件'
            }}
          </button>
        </form>
        <p class="muted compact">
          请使用未被其他账号占用的邮箱。确认后返回此页会自动核对状态，也可点击上方刷新。
        </p>
      </section>
    </div>
    <button v-else-if="!loading" class="button secondary" :disabled="!configured" @click="load">
      重新读取绑定状态
    </button>
  </section>
</template>
