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

export interface AliyunSmsConfig {
  accessKeyId: string
  accessKeySecret: string
  signName: string
  templateCode: string
  paramName: string
  extraParams: Record<string, string>
}
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
