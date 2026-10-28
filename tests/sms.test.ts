import { describe, expect, it, vi } from 'vitest'
import { Webhook } from 'standardwebhooks'
import { signAliyunQuery } from '../supabase/functions/_shared/aliyun-sms'
import { createSmsHandler } from '../supabase/functions/_shared/sms-handler'
import type { SmsRepository } from '../supabase/functions/_shared/sms-handler'
const secret = 'whsec_' + Buffer.alloc(32, 1).toString('base64')
const fixture = { user: { phone: '8613900000000' }, sms: { phone: '8613900001234', otp: '654321' } }
function setup() {
  const states = new Map<string, string>()
  const repo: SmsRepository = {
    reserve: vi.fn(async (id) => {
      if (states.has(id)) return { duplicate: true, status: states.get(id)! }
      states.set(id, 'pending')
      return { duplicate: false, status: 'pending' }
    }),
    finish: vi.fn(async (id, status) => {
      states.set(id, status)
    }),
  }
  const values: Record<string, string> = {
    SEND_SMS_HOOK_SECRET: 'v1,' + secret,
    ALIBABA_CLOUD_ACCESS_KEY_ID: 'fixture-key',
    ALIBABA_CLOUD_ACCESS_KEY_SECRET: 'fixture-secret',
    ALIYUN_SMS_SIGN_NAME: '测试签名',
    ALIYUN_SMS_TEMPLATE_CODE: '100001',
    ALIYUN_SMS_TEMPLATE_PARAM_NAME: 'code',
  }
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ Code: 'OK', Success: true })))
  const handler = createSmsHandler({
    env: (name) => values[name],
    fetch: fetcher as typeof fetch,
    repo,
  })
  return { repo, values, fetcher, handler }
}
function request(payload: unknown = fixture, id = crypto.randomUUID(), date = new Date()) {
  const raw = JSON.stringify(payload)
  return new Request('https://edge.test/send-sms', {
    method: 'POST',
    body: raw,
    headers: {
      'Content-Type': 'application/json',
      'webhook-id': id,
      'webhook-timestamp': String(Math.floor(date.getTime() / 1000)),
      'webhook-signature': new Webhook(secret).sign(id, date, raw),
    },
  })
}
describe('Aliyun ACS3 request and signed Supabase SMS hook', () => {
  it('matches the exact published Alibaba Cloud signature vector', async () => {
    const result = await signAliyunQuery({
      host: 'ecs.cn-shanghai.aliyuncs.com',
      action: 'RunInstances',
      version: '2014-05-26',
      params: {
        ImageId: 'win2019_1809_x64_dtc_zh-cn_40G_alibase_20230811.vhd',
        RegionId: 'cn-shanghai',
      },
      accessKeyId: 'YourAccessKeyId',
      accessKeySecret: 'YourAccessKeySecret',
      date: '2023-10-26T10:22:32Z',
      nonce: '3156853299f313e23d1673dc12e1703d',
    })
    expect(result.headers.Authorization).toContain(
      'Signature=06563a9e1b43f5dfe96b81484da74bceab24a1d853912eee15083a6f0f3283c0',
    )
  })
  it('sends the actual change destination and succeeds only after Aliyun returns OK', async () => {
    const s = setup(),
      response = await s.handler(request())
    expect(response.status).toBe(200)
    const url = new URL((s.fetcher.mock.calls[0] as unknown as [string])[0])
    expect(url.origin).toBe('https://dypnsapi.aliyuncs.com')
    expect(url.searchParams.get('PhoneNumber')).toBe('13900001234')
    expect(url.searchParams.get('CountryCode')).toBe('86')
    expect(url.searchParams.get('ReturnVerifyCode')).toBe('false')
    expect(JSON.parse(url.searchParams.get('TemplateParam')!)).toEqual({ min: '5', code: '654321' })
    expect(url.searchParams.get('ValidTime')).toBe('300')
    expect(s.repo.finish).toHaveBeenCalledWith(expect.any(String), 'sent', 'OK')
    expect(await response.json()).toEqual({})
  })
  it('rejects missing, altered and expired webhook signatures without contacting the provider', async () => {
    const s = setup()
    const missing = new Request('https://edge.test/send-sms', {
      method: 'POST',
      body: JSON.stringify(fixture),
    })
    const altered = request()
    altered.headers.set('webhook-signature', 'v1,invalid')
    for (const req of [
      missing,
      altered,
      request(fixture, crypto.randomUUID(), new Date(Date.now() - 600000)),
    ])
      expect((await s.handler(req)).status).toBe(401)
    expect(s.fetcher).not.toHaveBeenCalled()
    expect(s.repo.reserve).not.toHaveBeenCalled()
  })
  it('rejects non-mainland destinations and malformed OTPs before reserving or sending', async () => {
    const s = setup()
    expect(
      (await s.handler(request({ ...fixture, sms: { ...fixture.sms, phone: '+447700900101' } })))
        .status,
    ).toBe(400)
    expect(
      (await s.handler(request({ ...fixture, sms: { ...fixture.sms, otp: 'not-a-code' } }))).status,
    ).toBe(401)
    expect(s.repo.reserve).not.toHaveBeenCalled()
    expect(s.fetcher).not.toHaveBeenCalled()
  })
  it('handles duplicate concurrent and completed callbacks without sending twice', async () => {
    const s = setup(),
      id = crypto.randomUUID()
    const responses = await Promise.all([
      s.handler(request(fixture, id)),
      s.handler(request(fixture, id)),
    ])
    expect(responses.map((r) => r.status).sort()).toEqual([200, 503])
    expect((await s.handler(request(fixture, id))).status).toBe(200)
    expect(s.fetcher).toHaveBeenCalledOnce()
  })
  it('records a rejected provider code and never leaks the provider payload or OTP', async () => {
    const s = setup(),
      id = crypto.randomUUID()
    s.fetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          Code: 'isv.BUSINESS_LIMIT_CONTROL',
          Message: 'private 654321 diagnostic',
        }),
      ),
    )
    const res = await s.handler(request(fixture, id))
    expect(res.status).toBe(503)
    expect(await res.text()).not.toContain('654321')
    expect(s.repo.finish).toHaveBeenCalledWith(id, 'failed', 'isv.BUSINESS_LIMIT_CONTROL')
    expect((await s.handler(request(fixture, id))).status).toBe(503)
    expect(s.fetcher).toHaveBeenCalledOnce()
  })
  it('records unknown delivery after network failure instead of pretending success or retrying', async () => {
    const s = setup()
    s.fetcher.mockRejectedValueOnce(new Error('network failed'))
    expect((await s.handler(request())).status).toBe(503)
    expect(s.repo.finish).toHaveBeenCalledWith(
      expect.any(String),
      'failed',
      'DELIVERY_RESULT_UNKNOWN',
    )
  })
  it('fails closed when secrets or the idempotency store are unavailable', async () => {
    const s = setup()
    delete s.values.ALIBABA_CLOUD_ACCESS_KEY_SECRET
    expect((await s.handler(request())).status).toBe(503)
    expect(s.fetcher).not.toHaveBeenCalled()
    const other = setup()
    other.repo.reserve = vi.fn(async () => {
      throw new Error('unavailable')
    })
    // Recreate with a repository failure because the handler retains its repo object.
    expect((await other.handler(request())).status).toBe(503)
    expect(other.fetcher).not.toHaveBeenCalled()
  })
  it('rejects methods and oversized payloads', async () => {
    const s = setup()
    expect((await s.handler(new Request('https://edge.test/send-sms'))).status).toBe(405)
    expect(
      (
        await s.handler(
          new Request('https://edge.test/send-sms', { method: 'POST', body: 'x'.repeat(40000) }),
        )
      ).status,
    ).toBe(400)
    expect(s.fetcher).not.toHaveBeenCalled()
  })
})
