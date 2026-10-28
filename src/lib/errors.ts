import { ZodError } from 'zod'
const messages: Record<string, string> = {
  CONTENT_BLOCKED: '内容包含不适合社区分享的词语，请调整后提交。',
  COMMUNITY_PROFILE_REQUIRED: '请先到宠友社区设置公开昵称，再进行互动。',
  COMMUNITY_RATE_LIMIT: '今天的社区操作次数已达上限，请明天再试。',
  POST_NOT_FOUND: '动态不存在、未公开或已被移除。',
  POST_ALREADY_SUBMITTED: '这条动态已经提交，请到“我的动态”查看。',
  COMMENT_NOT_FOUND: '评论不存在或你无权删除。',
  INVALID_REPLY: '仅支持回复同一动态下的一级评论，请刷新后重试。',
  SELF_FOLLOW: '无需关注自己，去认识其他宠友吧。',
  AUTHOR_NOT_FOUND: '这位作者尚未开通社区主页。',
  PET_LIMIT: '每位用户最多创建 10 只宠物。',
  DAILY_LIMIT: '今天的 20 次提问已用完，明天再来吧。',
  PET_NOT_FOUND: '宠物不存在或你没有访问权限。',
  SESSION_NOT_FOUND: '会话不存在，请新建对话。',
  SESSION_BUSY: '本轮提问仍在处理中，请稍后刷新历史。',
  REQUEST_PENDING: '同一请求正在处理，请稍后查看历史。',
  IDEMPOTENCY_CONFLICT: '请求标识冲突，请新建提问。',
  REQUEST_FAILED: '上次请求未成功。可重新提问，将占用一次额度。',
  UNAUTHORIZED: '登录已过期，请重新登录。',
  UPSTREAM_TIMEOUT: 'AI 响应超时，可重新提问。',
  UPSTREAM_RATE_LIMIT: 'AI 服务繁忙，请稍后重新提问。',
  UPSTREAM_UNAVAILABLE: 'AI 暂时不可用，请稍后重新提问。',
  INVALID_RESPONSE: 'AI 未返回完整的有效回答，请重新提问。',
  SAVE_FAILED: '回答保存失败，请先刷新历史确认结果。',
  INVALID_INPUT: '提问内容无效，请填写 1–2000 字的问题。',
  SERVICE_NOT_CONFIGURED: 'AI 服务尚未配置，请联系管理员。',
  IDENTITY_MISMATCH: '账号状态发生变化，请重新登录后再绑定。原有资料不会合并到其他账号。',
  SMS_NOT_CONFIGURED: '短信服务尚未完成配置，验证码未发送，请联系管理员。',
  SMS_DELIVERY_FAILED:
    '短信发送失败，请稍后重试；若持续失败，请联系管理员检查短信额度、签名和模板。',
  SMS_STATE_UNAVAILABLE: '短信请求暂时无法确认，请稍后重试。',
}
export function errorMessage(e: unknown): string {
  if (e instanceof ZodError) return e.issues.map((i) => i.message).join('；')
  const raw =
    e instanceof Error
      ? e.message
      : typeof e === 'object' && e && 'message' in e
        ? String(e.message)
        : '操作失败，请稍后重试。'
  const code = typeof e === 'object' && e && 'code' in e ? String(e.code) : ''
  const authErrors: Record<string, string> = {
    phone_exists: '此手机号已被其他账号使用，请更换号码或登录原账号。',
    email_exists: '此邮箱已被其他账号使用，请更换邮箱或登录原账号。',
    user_already_exists: '该邮箱或手机号已注册，请登录已有账号。',
    otp_expired: '验证码无效或已过期，请检查后重试或重新发送。',
    over_sms_send_rate_limit: '短信发送过于频繁，请稍后再试。',
    over_email_send_rate_limit: '确认邮件发送过于频繁，请稍后再试。',
    sms_send_failed: '短信未发送成功，请稍后重试；若持续失败，请联系管理员检查短信服务。',
    sms_provider_disabled: '短信服务尚未配置，验证码未发送，请联系管理员。',
    email_address_not_authorized: '当前邮件服务不允许向此邮箱发送，请联系管理员配置邮件服务。',
  }
  if (authErrors[code]) return authErrors[code]
  if (
    /Unable to get SMS provider|SMS provider is not configured|Unsupported phone provider/i.test(
      raw,
    )
  )
    return '短信服务尚未配置，验证码未发送，请联系管理员。'
  for (const [code, message] of Object.entries(messages)) if (raw.includes(code)) return message
  if (/Invalid login credentials/.test(raw)) return '邮箱、手机号或密码不正确。'
  if (/phone_provider_disabled/.test(raw)) return '手机号登录尚未启用，请使用邮箱登录或联系管理员。'
  if (/Phone not confirmed|phone_not_confirmed/.test(raw)) return '手机号尚未验证，请先完成验证。'
  if (/Email not confirmed/.test(raw)) return '请先通过邮箱中的链接确认注册。'
  if (/already registered/.test(raw)) return '此邮箱已注册，请登录。'
  if (/Failed to fetch|NetworkError|fetch failed/i.test(raw))
    return '网络连接失败，请检查网络后重试。'
  if (/row-level security|permission denied|42501/.test(raw))
    return '没有操作权限，请确认登录状态。'
  if (/check constraint|INVALID_|23514/.test(raw)) return '填写的数据不符合要求，请检查表单。'
  return raw.length < 180 ? raw : '操作失败，请稍后重试。'
}
