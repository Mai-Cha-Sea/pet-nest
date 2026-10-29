/**
 * 阿里云号码认证 PNVS 的 ACS3 签名与短信传输，运行于服务端。
 * 签名算法有官方固定向量回归；参数中的 OTP 必须来自已验签的 Auth Hook。
 * URL、签名头、手机号、验证码和密钥均属于敏感请求资料，禁止写日志。
 */
const encoder = new TextEncoder()
const hex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (b) => b.toString(16).padStart(2, '0')).join('')
const hash = async (value: string) =>
  hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
const percent = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  )

// ACS3 specification, checked against Alibaba Cloud's published fixed vector.
/**
 * 按 ACS3 对固定 POST /、排序后的 query/header 和空请求体 SHA-256 签名。
 * 返回 URL 与请求头而不发请求；百分号编码、换行及排序属于签名协议，修改需跑固定向量测试。
 */
export async function signAliyunQuery(input: {
  host: string
  action: string
  version: string
  params: Record<string, string>
  accessKeyId: string
  accessKeySecret: string
  date: string
  nonce: string
}) {
  const payloadHash = await hash('')
  const headers: Record<string, string> = {
    host: input.host,
    'x-acs-action': input.action,
    'x-acs-version': input.version,
    'x-acs-date': input.date,
    'x-acs-signature-nonce': input.nonce,
    'x-acs-content-sha256': payloadHash,
  }
  const names = Object.keys(headers).sort()
  const query = Object.keys(input.params)
    .sort()
    .map((key) => `${percent(key)}=${percent(input.params[key]!)}`)
    .join('&')
  const canonical = [
    'POST',
    '/',
    query,
    names.map((name) => `${name}:${headers[name]!.trim()}\n`).join(''),
    names.join(';'),
    payloadHash,
  ].join('\n')
  const signing = `ACS3-HMAC-SHA256\n${await hash(canonical)}`
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(input.accessKeySecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = hex(await crypto.subtle.sign('HMAC', key, encoder.encode(signing)))
  headers.Authorization = `ACS3-HMAC-SHA256 Credential=${input.accessKeyId},SignedHeaders=${names.join(';')},Signature=${signature}`
  delete headers.host // fetch derives the exact signed host from this fixed URL.
  return { url: `https://${input.host}/?${query}`, headers }
}

/**
 * 服务端 Secrets 解析后的发送配置；不可序列化到前端或写入仓库。
 */
export interface AliyunSmsConfig {
  accessKeyId: string
  accessKeySecret: string
  signName: string
  templateCode: string
  paramName: string
  extraParams: Record<string, string>
}
/**
 * 向固定 PNVS 域名发送已生成的 OTP，3 秒超时，不开启供应商自动重试。
 * 验证码 300 秒、间隔 60 秒；Auth 才是验证真伪的权威，额外模板参数不能覆盖实际 OTP。
 * 只返回 ok 和受限代码；超时/断网为结果未知，不能推断一定未发送。
 */
export async function sendAliyunSms(
  config: AliyunSmsConfig,
  phone: string,
  otp: string,
  fetcher: typeof fetch,
) {
  const request = await signAliyunQuery({
    host: 'dypnsapi.aliyuncs.com',
    action: 'SendSmsVerifyCode',
    version: '2017-05-25',
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    nonce: crypto.randomUUID(),
    params: {
      CountryCode: '86',
      PhoneNumber: phone.replace(/^\+?86/, ''),
      SignName: config.signName,
      TemplateCode: config.templateCode,
      TemplateParam: JSON.stringify({ ...config.extraParams, [config.paramName]: otp }),
      ReturnVerifyCode: 'false',
      AutoRetry: '0',
      ValidTime: '300',
      Interval: '60',
    },
  })
  try {
    const response = await fetcher(request.url, {
      method: 'POST',
      headers: request.headers,
      signal: AbortSignal.timeout(3000),
    })
    if (!response.ok) return { ok: false, code: 'PROVIDER_HTTP_ERROR' }
    const data = await response.json()
    const code =
      typeof data?.Code === 'string' && /^[\w.:-]{1,80}$/.test(data.Code)
        ? data.Code
        : 'INVALID_PROVIDER_RESPONSE'
    const ok = code === 'OK' && data.Success === true
    return { ok, code: code === 'OK' && !ok ? 'PROVIDER_UNCONFIRMED' : code }
  } catch {
    // Never log URLs, request headers, phone numbers, OTPs or provider payloads.
    return { ok: false, code: 'DELIVERY_RESULT_UNKNOWN' }
  }
}
