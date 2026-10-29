/**
 * 短信 Hook 编排：有界读取原始正文 → Webhook 验签 → 配置/号码检查 → 事件去重 → 发送。
 * 验证码由 Supabase Auth 生成并校验，阿里云只负责传送相同验证码。
 * 供应商结果未知或事件仍 pending 时不自动重发，避免重复短信及费用。
 */
import { Webhook } from 'standardwebhooks'
import { z } from 'zod'
import { sendAliyunSms } from './aliyun-sms.ts'

/**
 * 事件级幂等仓库；一次 Hook 只受理一次发送，pending/failed 不静默重发。
 */
export interface SmsRepository {
  reserve(id: string): Promise<{ duplicate: boolean; status: string }>
  finish(id: string, status: 'sent' | 'failed', code: string): Promise<void>
}
interface SmsDeps {
  env: (name: string) => string | undefined
  fetch: typeof fetch
  repo: SmsRepository
}
const payloadSchema = z.object({
  user: z.object({ phone: z.string().optional(), new_phone: z.string().optional() }).passthrough(),
  sms: z.object({ otp: z.string().regex(/^\d{6}$/), phone: z.string().optional() }).passthrough(),
})
/**
 * 保留原始正文用于 HMAC 验签，最多 32768 字节；不能先解析再重新序列化后验签。
 */
async function boundedText(request: Request) {
  const reader = request.body?.getReader()
  if (!reader) throw new Error('EMPTY_BODY')
  const decoder = new TextDecoder()
  let total = 0,
    body = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return body + decoder.decode()
    total += value.byteLength
    if (total > 32768) {
      await reader.cancel()
      throw new Error('BODY_TOO_LARGE')
    }
    body += decoder.decode(value, { stream: true })
  }
}
/**
 * 生成只接受 Auth Hook 的 POST 处理器，不是浏览器公开短信 API。
 * 所有配置/事件状态检查先于供应商调用；返回标准 Hook 错误而不暴露上游载荷。
 */
export function createSmsHandler(deps: SmsDeps) {
  return async (request: Request) => {
    const respond = (status: number, message?: string) =>
      new Response(JSON.stringify(message ? { error: { http_code: status, message } } : {}), {
        status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      })
    if (request.method !== 'POST') return respond(405, 'METHOD_NOT_ALLOWED')
    const secret = deps.env('SEND_SMS_HOOK_SECRET')?.replace(/^v1,/, '')
    if (!secret || secret.startsWith('your-')) return respond(503, 'SMS_NOT_CONFIGURED')
    let raw: string
    try {
      raw = await boundedText(request)
    } catch {
      return respond(400, 'INVALID_SMS_REQUEST')
    }
    let payload: z.infer<typeof payloadSchema>
    try {
      const verified = new Webhook(secret).verify(raw, Object.fromEntries(request.headers))
      payload = payloadSchema.parse(verified)
    } catch {
      return respond(401, 'INVALID_WEBHOOK_SIGNATURE_OR_PAYLOAD')
    }
    // sms.phone is the actual destination (especially during phone changes).
    const phone = (payload.sms.phone || payload.user.new_phone || payload.user.phone || '').replace(
      /^\+/,
      '',
    )
    if (!/^861[3-9]\d{9}$/.test(phone)) return respond(400, 'ONLY_CN_MOBILE_ALLOWED')
    const event = request.headers.get('webhook-id') || ''
    if (!event || event.length > 200) return respond(400, 'INVALID_EVENT_ID')
    const get = (name: string) => {
      const value = deps.env(name)
      return value && !value.startsWith('your-') ? value : ''
    }
    let extraParams: Record<string, string>
    try {
      extraParams = z
        .record(z.string().regex(/^[A-Za-z_][\w]{0,50}$/), z.string().max(100))
        .parse(JSON.parse(get('ALIYUN_SMS_TEMPLATE_PARAMS_JSON') || '{"min":"5"}'))
    } catch {
      return respond(503, 'SMS_NOT_CONFIGURED')
    }
    const config = {
      accessKeyId: get('ALIBABA_CLOUD_ACCESS_KEY_ID'),
      accessKeySecret: get('ALIBABA_CLOUD_ACCESS_KEY_SECRET'),
      signName: get('ALIYUN_SMS_SIGN_NAME'),
      templateCode: get('ALIYUN_SMS_TEMPLATE_CODE'),
      paramName: get('ALIYUN_SMS_TEMPLATE_PARAM_NAME') || 'code',
      extraParams,
    }
    if (
      !config.accessKeyId ||
      !config.accessKeySecret ||
      !config.signName ||
      !/^\d{4,20}$/.test(config.templateCode) ||
      !/^[A-Za-z_][\w]{0,50}$/.test(config.paramName)
    )
      return respond(503, 'SMS_NOT_CONFIGURED')
    let reserved: Awaited<ReturnType<SmsRepository['reserve']>>
    try {
      reserved = await deps.repo.reserve(event)
    } catch {
      return respond(503, 'SMS_STATE_UNAVAILABLE')
    }
    // 只有已确认 sent 的重复事件返回成功；pending/failed 代表不能确认已送达。
    // 此处拒绝再次发同一事件，用户重新申请验证码才产生新的事件 ID。
    if (reserved.duplicate)
      return reserved.status === 'sent'
        ? respond(200)
        : respond(503, 'SMS_PREVIOUS_DELIVERY_UNCONFIRMED')
    const result = await sendAliyunSms(config, phone, payload.sms.otp, deps.fetch)
    try {
      await deps.repo.finish(event, result.ok ? 'sent' : 'failed', result.code)
    } catch {
      return respond(503, 'SMS_STATE_UNAVAILABLE')
    }
    return result.ok ? respond(200) : respond(503, 'SMS_DELIVERY_FAILED')
  }
}
