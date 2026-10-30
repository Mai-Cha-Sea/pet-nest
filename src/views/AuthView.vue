<script setup lang="ts">
/**
 * 邮箱/中国大陆手机号的注册与密码登录，以及手机注册验证码确认。
 * 密码交给 Supabase Auth；注册先明确同意协议，提交版本声明。
 * “恢复验证”只恢复输入步骤，不发送短信；注册验证与已登录账号改绑的 OTP 类型不同。
 */
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { client, configured } from '../lib/supabase'
import { errorMessage, isSmsHookTimeout, SMS_CONFIRMATION_PENDING } from '../lib/errors'
import { session } from '../stores/auth'
import Icon from '../components/Icon.vue'
import Notice from '../components/Notice.vue'
import NestIllustration from '../components/NestIllustration.vue'
import PhoneInput from '../components/PhoneInput.vue'
import { chinaPhone, verificationCode, loginEmail } from '../../shared/auth'
import { useCooldown } from '../lib/useCooldown'
import { registrationConsent } from '../../shared/legal'
const router = useRouter(),
  route = useRoute(),
  mode = ref<'login' | 'register'>('login'),
  loginMethod = ref<'email' | 'phone'>('email'),
  email = ref(''),
  phone = ref(''),
  password = ref(''),
  nickname = ref(''),
  agreed = ref(false),
  pendingPhone = ref(''),
  code = ref(''),
  busy = ref(false),
  error = ref(''),
  success = ref(''),
  smsNotice = ref('')
const resendCooldown = useCooldown()
/**
 * 切换登录/注册时清掉验证步骤和同意状态，避免旧流程被误继续。
 */
function switchMode(next: 'login' | 'register') {
  if (busy.value) return
  mode.value = next
  agreed.value = false
  pendingPhone.value = ''
  code.value = ''
  error.value = ''
  success.value = ''
  smsNotice.value = ''
}
/**
 * 切换标识类型时清理短信步骤；不自动向新号码发送请求。
 */
function switchLoginMethod(next: 'email' | 'phone') {
  if (busy.value) return
  loginMethod.value = next
  pendingPhone.value = ''
  code.value = ''
  error.value = ''
  success.value = ''
  smsNotice.value = ''
}
/**
 * 保存已验证会话并跳回站内地址；拒绝 // 开头的站外重定向。
 */
async function enter(sessionData: NonNullable<typeof session.value>) {
  session.value = sessionData
  const target = String(route.query.redirect || '/pets')
  await router.replace(target.startsWith('/') && !target.startsWith('//') ? target : '/pets')
}
/**
 * 恢复已有手机验证码的输入步骤，不再注册/发短信；仍要求主动同意协议。
 */
function resumeRegistration() {
  if (busy.value) return
  error.value = ''
  success.value = ''
  smsNotice.value = ''
  try {
    if (!agreed.value) throw new Error('请先阅读并同意用户协议与隐私政策。')
    pendingPhone.value = chinaPhone(phone.value)
    password.value = ''
    code.value = ''
  } catch (e) {
    error.value = errorMessage(e)
  }
}
/**
 * 使用注册类型 sms 确认收到的验证码；有真实 session 才进入应用。
 */
async function verifyRegistration() {
  if (busy.value || !pendingPhone.value) return
  busy.value = true
  error.value = ''
  success.value = ''
  smsNotice.value = ''
  try {
    const { data, error: e } = await client().auth.verifyOtp({
      phone: pendingPhone.value,
      token: verificationCode(code.value),
      type: 'sms',
    })
    if (e) throw e
    if (!data.session) throw new Error('手机号验证尚未完成，请重试或重新登录。')
    await enter(data.session)
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}
/**
 * 冷却结束后请求 Auth 重发注册短信，后端发送失败仍显示真实错误。
 */
async function resendRegistration() {
  if (busy.value || !pendingPhone.value || resendCooldown.remaining.value) return
  busy.value = true
  error.value = ''
  success.value = ''
  smsNotice.value = ''
  try {
    const { error: e } = await client().auth.resend({ phone: pendingPhone.value, type: 'sms' })
    if (e) throw e
    resendCooldown.start()
    success.value = '验证码请求已重新提交，请查看短信。'
  } catch (e) {
    if (isSmsHookTimeout(e)) {
      // Hook 可能已投递，只是 Auth 未及时收到回执；保留号码/验证码，不自动重发。
      resendCooldown.start()
      smsNotice.value = SMS_CONFIRMATION_PENDING
    } else error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}
/**
 * 只提交一种登录标识；注册增加当前协议声明，密码由 Auth 处理。
 * 注册无 session 时分别进入短信确认或邮件等待状态，不提前宣布已登录。
 */
async function submit() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  success.value = ''
  smsNotice.value = ''
  try {
    if (mode.value === 'register' && !agreed.value)
      throw new Error('请先阅读并同意用户协议与隐私政策。')
    const auth = client().auth
    const identifier =
      loginMethod.value === 'phone'
        ? { phone: chinaPhone(phone.value) }
        : { email: loginEmail(email.value) }
    const { data, error: e } =
      mode.value === 'login'
        ? await auth.signInWithPassword({ ...identifier, password: password.value })
        : await auth.signUp({
            ...identifier,
            password: password.value,
            options: {
              data: { nickname: nickname.value.trim(), legal_consent: registrationConsent() },
              ...(loginMethod.value === 'email'
                ? { emailRedirectTo: window.location.origin + '/auth' }
                : {}),
            },
          })
    if (e) throw e
    if (data.session) {
      await enter(data.session)
    } else if (loginMethod.value === 'phone' && mode.value === 'register') {
      pendingPhone.value = chinaPhone(phone.value)
      password.value = ''
      resendCooldown.start()
      success.value = '验证码请求已提交，请查看短信并完成验证。'
    } else
      success.value =
        '请打开注册邮箱，点击确认链接后回来登录。出于隐私保护，已注册的邮箱也可能收到此提示。'
  } catch (e) {
    if (mode.value === 'register' && loginMethod.value === 'phone' && isSmsHookTimeout(e)) {
      // 只恢复短信确认步骤，仍由 verifyOtp 决定是否真正完成注册；不假称发送成功。
      pendingPhone.value = chinaPhone(phone.value)
      password.value = ''
      code.value = ''
      resendCooldown.start()
      smsNotice.value = SMS_CONFIRMATION_PENDING
    } else error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <div class="auth-art">
    <RouterLink to="/pets" class="brand"
      ><span class="brand-icon"><Icon name="paw" :size="26" /></span
      ><span>宠物小窝<small>PET NEST</small></span></RouterLink
    >
    <div>
      <span class="eyebrow">A LITTLE HOME, A LOT OF LOVE</span>
      <h1>它的每一天，<br />都有你的用心。</h1>
      <p>把日常的点滴收好，<br />让陪伴成为看得见的安心。</p>
      <NestIllustration />
    </div>
    <span class="muted">私密档案 · 日常记录 · AI 养护参考</span>
  </div>
  <section class="auth-form-wrap">
    <div class="auth-form">
      <span class="eyebrow">WELCOME HOME</span>
      <h2>{{ mode === 'login' ? '欢迎回到小窝' : '从今天开始，记录陪伴' }}</h2>
      <p class="muted">
        {{
          mode === 'login' ? '登录后，继续照顾你的毛孩子。' : '创建你的账号，给它一个专属的小窝。'
        }}
      </p>
      <div class="segmented">
        <button :class="{ active: mode === 'login' }" @click="switchMode('login')">登录</button
        ><button :class="{ active: mode === 'register' }" @click="switchMode('register')">
          注册
        </button>
      </div>
      <Notice :error="error" :success="success" />
      <p v-if="smsNotice" class="notice" role="status">{{ smsNotice }}</p>
      <p v-if="!configured" class="notice">
        尚未配置 Supabase，请按 README 设置 .env.local 后重启开发服务。
      </p>
      <form v-if="!pendingPhone" @submit.prevent="submit">
        <div
          class="login-methods"
          role="group"
          :aria-label="mode === 'login' ? '登录方式' : '注册方式'"
        >
          <button
            type="button"
            :class="{ active: loginMethod === 'email' }"
            :aria-pressed="loginMethod === 'email'"
            :disabled="busy"
            @click="switchLoginMethod('email')"
          >
            {{ mode === 'login' ? '邮箱登录' : '邮箱注册' }}
          </button>
          <button
            type="button"
            :class="{ active: loginMethod === 'phone' }"
            :aria-pressed="loginMethod === 'phone'"
            :disabled="busy"
            @click="switchLoginMethod('phone')"
          >
            {{ mode === 'login' ? '手机号登录' : '手机号注册' }}
          </button>
        </div>
        <label v-if="mode === 'register'"
          >昵称<input
            v-model="nickname"
            required
            maxlength="64"
            autocomplete="nickname"
            placeholder="怎么称呼你？" /></label
        ><label v-if="loginMethod === 'email'"
          >邮箱<input
            v-model="email"
            type="email"
            required
            maxlength="128"
            autocomplete="email"
            placeholder="you@example.com"
        /></label>
        <PhoneInput v-else v-model="phone" :disabled="busy" />
        <label
          >密码<input
            v-model="password"
            type="password"
            required
            minlength="8"
            maxlength="128"
            :autocomplete="mode === 'register' ? 'new-password' : 'current-password'"
            placeholder="至少 8 位密码"
        /></label>
        <label v-if="mode === 'register'" class="agreement-consent">
          <input
            v-model="agreed"
            type="checkbox"
            required
            :disabled="busy"
            aria-label="同意用户协议和隐私政策"
          />
          <span
            >我已阅读并同意
            <RouterLink to="/terms" target="_blank" rel="noopener noreferrer"
              >《用户协议》</RouterLink
            >和
            <RouterLink to="/privacy" target="_blank" rel="noopener noreferrer"
              >《隐私政策》</RouterLink
            >。链接在新标签页打开。</span
          >
        </label>
        <button class="button full" :disabled="busy || !configured">
          {{ busy ? '请稍候…' : mode === 'login' ? '登录小窝' : '创建账号'
          }}<Icon name="arrow" :size="18" />
        </button>
        <button
          v-if="mode === 'register' && loginMethod === 'phone'"
          type="button"
          class="text-button"
          :disabled="busy || !configured"
          @click="resumeRegistration"
        >
          已有验证码，继续验证
        </button>
      </form>
      <form v-else @submit.prevent="verifyRegistration">
        <p class="notice">请验证 {{ pendingPhone }}。通过短信验证后才会完成注册。</p>
        <label
          >短信验证码<input
            v-model="code"
            required
            :disabled="busy"
            inputmode="numeric"
            autocomplete="one-time-code"
            minlength="6"
            maxlength="6"
            placeholder="请输入 6 位验证码"
        /></label>
        <p class="muted compact">验证码五分钟内有效，请使用在本应用中申请的最新验证码。</p>
        <button class="button full" :disabled="busy">
          {{ busy ? '正在验证…' : '验证并进入小窝' }}
        </button>
        <button
          type="button"
          class="text-button"
          :disabled="busy || !!resendCooldown.remaining.value"
          @click="resendRegistration"
        >
          {{
            resendCooldown.remaining.value
              ? `${resendCooldown.remaining.value} 秒后可重新发送`
              : '重新发送验证码'
          }}
        </button>
      </form>
      <p class="privacy-line"><Icon name="deworming" :size="15" />密码由 Supabase Auth 安全管理</p>
      <nav class="legal-links" aria-label="用户协议与隐私政策">
        <RouterLink to="/terms" target="_blank" rel="noopener noreferrer">用户协议</RouterLink>
        <RouterLink to="/privacy" target="_blank" rel="noopener noreferrer">隐私政策</RouterLink>
      </nav>
      <RouterLink to="/settings" class="text-button">环境配置与隐私说明</RouterLink>
    </div>
  </section>
</template>
