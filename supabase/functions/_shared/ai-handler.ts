/**
 * AI HTTP 编排：Origin/登录/参数 → 数据库受理 → 上下文 → 模型/急症指引 → 保存结果。
 * 依赖通过 AIDeps 注入，使真实 HTTP 请求流程可在测试中用受控传输验证。
 * 数据库受理与外部模型不能组成同一事务；受理后失败也占额度，未知保存结果不能假报成功。
 */
import { aiRequestSchema } from '../../../shared/domain.ts'
import {
  buildMessages,
  isEmergency,
  EMERGENCY,
  safeAnswer,
  parseCompletion,
  tokenUsage,
} from './ai-core.ts'
import type { ContextData } from './ai-core.ts'
/**
 * HTTP 编排依赖的持久化契约；生产实现见 repository.ts，回归夹具见 tests/ai.test.ts。
 */
export interface AIRepository {
  /**
   * 原子核对宠物归属、会话、每日额度及同请求幂等；新请求同时计次并写 pending。
   * 重复请求只返回已有状态/答案，不再次计次；失败调用已消耗额度不会回退。
   */
  reserve(
    user: string,
    pet: string,
    session: string,
    request: string,
    question: string,
  ): Promise<{
    status: string
    duplicate: boolean
    answer?: string
    error_code?: string
    used?: number
  }>
  /**
   * 只读取已验证用户所选宠物/会话 since 之后的事实，不受理浏览器传入上下文。
   */
  context(user: string, pet: string, session: string, since: string): Promise<ContextData>
  /**
   * 锁定请求并只结束 pending，原子保存问答/状态/模型/token/耗时。
   * 重复完成会抛 REQUEST_NOT_PENDING，不再插入第二条回答。
   * answer=null 为失败；latency 单位毫秒；保存结果未知时必须抛错供上层提示核对历史。
   */
  finish(
    request: string,
    answer: string | null,
    error: string | null,
    model: string,
    prompt: number,
    completion: number,
    latency: number,
  ): Promise<void>
}
/**
 * 可替换的外部边界；authenticate 只返回已验证用户 UUID，timeoutMs 单位为毫秒。
 */
export interface AIDeps {
  env: (name: string) => string | undefined
  authenticate: (token: string) => Promise<string | null>
  repo: AIRepository
  fetch: typeof fetch
  timeoutMs?: number
}
/**
 * 浏览器 Origin 必须精确匹配白名单；无 Origin 的非浏览器请求仍须独立鉴权。
 */
export function allowedOrigin(request: Request, env: AIDeps['env']) {
  const origin = request.headers.get('Origin')
  const allowed = (env('ALLOWED_ORIGINS') || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return { origin, ok: !origin || allowed.includes(origin) }
}
/**
 * 为通过白名单的 Origin 返回 CORS 和禁缓存头；不反射未经允许的域名。
 */
export function corsHeaders(origin: string | null) {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
    ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}
/**
 * 逐块读取最多 16000 字节的请求，防止无 Content-Length 的超大流式正文。
 */
async function boundedJson(request: Request) {
  const reader = request.body?.getReader()
  if (!reader) throw new Error('INVALID_INPUT')
  let size = 0
  const chunks: Uint8Array[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > 16000) {
      await reader.cancel()
      throw new Error('INVALID_INPUT')
    }
    chunks.push(value)
  }
  const all = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    all.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(all))
  } catch {
    throw new Error('INVALID_INPUT')
  }
}
/**
 * 生成标准 Request → Response 处理器；所有业务失败用 {error:{code}} 返回。
 * 配置检查在 reserve 前完成；reserve 之后任何失败都需 finish，保存失败返回 SAVE_FAILED。
 */
export function createAIHandler(deps: AIDeps) {
  return async (request: Request) => {
    const { origin, ok } = allowedOrigin(request, deps.env)
    const headers = corsHeaders(ok ? origin : null)
    const respond = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers })
    const fail = (status: number, code: string) => respond(status, { error: { code } })
    if (!ok) return fail(403, 'ORIGIN_DENIED')
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (request.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED')
    const token = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
    if (!token) return fail(401, 'UNAUTHORIZED')
    let user: string | null
    try {
      user = await deps.authenticate(token)
    } catch {
      return fail(401, 'UNAUTHORIZED')
    }
    if (!user) return fail(401, 'UNAUTHORIZED')
    if (!request.headers.get('Content-Type')?.includes('application/json'))
      return fail(400, 'INVALID_INPUT')
    let input: ReturnType<typeof aiRequestSchema.parse>
    try {
      input = aiRequestSchema.parse(await boundedJson(request))
    } catch {
      return fail(400, 'INVALID_INPUT')
    }
    const key = deps.env('DEEPSEEK_API_KEY'),
      model = deps.env('DEEPSEEK_MODEL') || 'deepseek-flash'
    if (!key) return fail(503, 'SERVICE_NOT_CONFIGURED')
    let reservation: Awaited<ReturnType<AIRepository['reserve']>>
    try {
      reservation = await deps.repo.reserve(
        user,
        input.pet_id,
        input.session_id,
        input.request_id,
        input.question,
      )
    } catch (e) {
      const message = e instanceof Error ? e.message : ''
      for (const [code, status] of [
        ['PET_NOT_FOUND', 404],
        ['SESSION_NOT_FOUND', 404],
        ['DAILY_LIMIT', 429],
        ['SESSION_BUSY', 409],
        ['IDEMPOTENCY_CONFLICT', 409],
      ] as const)
        if (message.includes(code)) return fail(status, code)
      return fail(503, 'DATABASE_UNAVAILABLE')
    }
    // 数据库已原子判断重复：成功可读缓存，pending/failed 提示查历史或新提问。
    // 禁止在这些分支再次调用模型，否则同 ID 重试会产生第二次费用。
    if (reservation.duplicate) {
      if (reservation.status === 'succeeded' && reservation.answer)
        return respond(200, {
          answer: reservation.answer,
          request_id: input.request_id,
          cached: true,
        })
      return fail(409, reservation.status === 'pending' ? 'REQUEST_PENDING' : 'REQUEST_FAILED')
    }
    const started = Date.now()
    let answer = '',
      prompt = 0,
      completion = 0
    try {
      // 急症也先受理并计次，但走固定指引且 token 为 0，不等待上游响应。
      if (isEmergency(input.question)) {
        answer = safeAnswer(EMERGENCY)
      } else {
        const context = await deps.repo.context(
          user,
          input.pet_id,
          input.session_id,
          new Date(Date.now() - 30 * 86400000).toISOString(),
        )
        const controller = new AbortController(),
          timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 45000)
        try {
          const response = await deps.fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model,
              messages: buildMessages(context, input.question),
              stream: false,
              max_tokens: 1800,
              thinking: { type: 'disabled' },
            }),
            signal: controller.signal,
          })
          if (!response.ok)
            throw new Error(
              response.status === 429 ? 'UPSTREAM_RATE_LIMIT' : 'UPSTREAM_UNAVAILABLE',
            )
          // Do not include upstream payloads in logs or client errors.
          const data = await response.json().catch(() => {
            throw new Error('INVALID_RESPONSE')
          })
          // Even a truncated/unsafe answer can consume billable tokens.
          const reported = tokenUsage(data)
          prompt = reported.prompt
          completion = reported.completion
          const parsed = parseCompletion(data)
          answer = parsed.answer
          prompt = parsed.prompt
          completion = parsed.completion
        } catch (e) {
          if (controller.signal.aborted) throw new Error('UPSTREAM_TIMEOUT')
          throw e
        } finally {
          clearTimeout(timer)
        }
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : ''
      const code = [
        'UPSTREAM_TIMEOUT',
        'UPSTREAM_RATE_LIMIT',
        'INVALID_RESPONSE',
        'UPSTREAM_UNAVAILABLE',
      ].includes(raw)
        ? raw
        : 'UPSTREAM_UNAVAILABLE'
      try {
        await deps.repo.finish(
          input.request_id,
          null,
          code,
          model,
          prompt,
          completion,
          Date.now() - started,
        )
      } catch {
        return fail(503, 'SAVE_FAILED')
      }
      return fail(
        code === 'UPSTREAM_TIMEOUT' ? 504 : code === 'UPSTREAM_RATE_LIMIT' ? 429 : 502,
        code,
      )
    }
    // 仅在持久化成功后向浏览器返回答案；网络/数据库保存失败不能宣布完整成功。
    try {
      await deps.repo.finish(
        input.request_id,
        answer,
        null,
        model,
        prompt,
        completion,
        Date.now() - started,
      )
    } catch {
      return fail(503, 'SAVE_FAILED')
    }
    return respond(200, { answer, request_id: input.request_id, used: reservation.used })
  }
}
