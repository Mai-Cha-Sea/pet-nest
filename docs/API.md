# 接口约定

业务 CRUD 使用 Supabase 官方 Auth / REST / Storage 协议，不包装成一套自定义 HTTP 格式。P0 调用集中在 `src/lib/api.ts`，P1 社区调用集中在 `src/lib/community.ts`。所有操作都要求当前用户的 access token，并由数据库 RLS 兜底。

## P1 接口

| 接口                                                | 约定                                                                                     |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| getWeightRecords                                    | records 按本人 pet_id/type/date 查询，500 条分页，最多最新 2000 条并返回 limited         |
| community_set_profile(p_nickname)                   | 显式开通/修改社区昵称，1–32 字                                                           |
| community_create_post(p_id,p_body,p_pet,p_tags)     | 同 UUID/内容/标签幂等；1–1000 字、本人宠物，最多 3 个标签且每个 ≤20 字；保留旧三参数接口 |
| community_publish(p_post,p_images)                  | 服务端检查词库及最多 9 张对象路径后自动发布；旧 pending 仅作者主动重审，无批量公开       |
| community_feed(p_mode,p_offset,p_author?,p_post?)   | recommend/following/favorites/mine，每页 20；RLS 限制可见内容                            |
| community_person / community_people                 | 独立社区昵称、关注状态及计数，关注/粉丝列表每页 20                                       |
| community_interact(p_target,p_kind,p_enabled)       | like/favorite/follow，明确设定状态，重复请求不反转                                       |
| community_add_comment(p_id,p_post,p_body,p_parent?) | 1–500 字、同请求幂等，仅同帖的一级评论可被回复                                           |
| community_delete_post / community_delete_comment    | 仅本人；删除动态级联互动和图片队列，删除父评论级联回复                                   |
| community_report(p_id,p_reason,p_post?,p_comment?)  | 必须选择一种目标，1–200 字，本人/目标去重，报告私有                                      |
| community_review(p_post,p_approve,p_note)           | service_role/管理员专用，不能由普通客户端调用                                            |

RPC 沿用 Supabase `{data,error}`，不额外包装；参数类型及错误映射见 shared/community.ts、src/lib/errors.ts。写入从 JWT 取 owner，服务器强制敏感词检查、配额、归属及幂等。审核流程和已知边界见 P1.md。

## Auth 与业务 CRUD

| 前端方法                                   | Supabase 接口 / 数据表                               | 行为                                                                  |
| ------------------------------------------ | ---------------------------------------------------- | --------------------------------------------------------------------- |
| auth.signUp / signInWithPassword / signOut | Supabase Auth                                        | 邮箱/中国大陆手机号注册与密码登录，注册须验证，SDK 管理刷新与过期事件 |
| auth.updateUser / verifyOtp / getUser      | Supabase Auth，封装于 lib/account.ts                 | 当前用户邮箱/手机号绑定、确认状态及同一身份复核                       |
| getProfile / saveProfile                   | users SELECT / UPDATE                                | 本人昵称、简介                                                        |
| getPets / getPet / savePet / removePet     | pets SELECT / INSERT / UPDATE / DELETE               | 列表倒序、10 只上限、级联删除                                         |
| getRecords                                 | records SELECT                                       | 按宠物，类型可选，时间与 ID 倒序，50 条分页                           |
| addRecord / removeRecord                   | records INSERT / DELETE                              | 六类 schema 见 DATABASE.md，不能关联他人的宠物                        |
| uploadAvatar / attachRecordImages          | Storage upload + 表字段 UPDATE                       | 私有目录、随机路径、5 MiB、异常最多 9 张                              |
| signedImage                                | Storage createSignedUrl                              | 有效期 300 秒，不把链接永久存数据库                                   |
| history / usage                            | ai_conversations、ai_requests、ai_daily_usage SELECT | 最近 30 天对话、调用状态、当天额度                                    |

SDK 返回 `{ data, error }`；调用层检查 error、抛给页面，统一转成中文提示。删除/更新需要确认返回行，避免把 RLS 过滤后的零行当作成功。读取不存在/越权宠物统一提示，避免泄露其他用户的数据。

密码登录分别传 `{email,password}` 或 `{phone,password}`，不同时传两种标识。手机号只接受中国大陆 11 位，规范化为 +86；错误提示不区分账号是否存在。手机号注册使用 signUp，随后 verifyOtp(type=sms)；绑定手机号使用当前用户 updateUser，再 verifyOtp(type=phone_change)，并复核确认状态与用户 ID。邮箱绑定通过 updateUser 的确认邮件，返回 /profile 后重新 getUser，不提前标记完成。不在业务 users 表新增密码字段。

## POST /functions/v1/ai-chat

请求头：`Authorization: Bearer <用户 access token>`、`apikey: <公开 key>`、`Content-Type: application/json`。浏览器通过 `supabase.functions.invoke` 自动添加。CORS 只允许 ALLOWED_ORIGINS 内的准确 origin，不带 Origin 的服务调用仍须鉴权。

```json
{
  "pet_id": "宠物 UUID",
  "session_id": "当前对话 UUID",
  "request_id": "本次提问 UUID",
  "question": "1–2000 字提问"
}
```

只接受这些字段，禁止客户端提供 user_id、档案上下文、系统提示词、模型参数或自定义上游地址。JSON 最大 16,000 字节；提问 trim 后验证。不要在 request_id 相同时修改其他字段。

成功 200：

```json
{
  "answer": "养护参考及固定免责声明",
  "request_id": "原请求 UUID",
  "used": 1
}
```

已成功请求的重复调用返回同一 answer 并带 `cached:true`，可能不带 used，前端重新读取服务端额度。无浏览器端模型直连，无 API Key 下发。

前端先显示用户问题和“正在思考”状态，成功后直接使用本响应的 answer 展示，再后台同步历史和额度。后台读取失败或暂时缺少新行时保留本轮结果；以 request_id + role 合并云端消息，避免重复气泡。思考提示是请求等待状态，不展示模型推理内容。

失败格式：`{"error":{"code":"错误码"}}`，不暴露上游响应体、SQL 详情或密钥。

| HTTP | code                                                        | 前端处理                                              |
| ---- | ----------------------------------------------------------- | ----------------------------------------------------- |
| 400  | INVALID_INPUT                                               | 检查 UUID、长度、JSON 和额外字段，不扣额度            |
| 401  | UNAUTHORIZED                                                | 重新登录，不扣额度                                    |
| 403  | ORIGIN_DENIED                                               | 修正前端 origin 白名单                                |
| 404  | PET_NOT_FOUND / SESSION_NOT_FOUND                           | 重新选择自己的宠物或新建会话                          |
| 409  | IDEMPOTENCY_CONFLICT                                        | 原请求 ID 不得更换内容                                |
| 409  | SESSION_BUSY / REQUEST_PENDING                              | 原调用可能仍在执行；已知 pending 状态自动读取历史检查 |
| 409  | REQUEST_FAILED                                              | 原请求已失败，原 ID 不再调用模型；新建提问会计一次    |
| 429  | DAILY_LIMIT                                                 | 上海当天 20 次已用完，次日重置                        |
| 429  | UPSTREAM_RATE_LIMIT                                         | DeepSeek 限流；已受理请求仍计次                       |
| 502  | INVALID_RESPONSE / UPSTREAM_UNAVAILABLE                     | 不展示无效/截断结果，保存失败状态                     |
| 503  | SERVICE_NOT_CONFIGURED / DATABASE_UNAVAILABLE / SAVE_FAILED | 检查部署；保存失败先刷新历史再决定重试                |
| 504  | UPSTREAM_TIMEOUT                                            | 上游 45 秒超时，保存失败状态；可发起新请求            |

同一请求不自动无限重试上游，避免重复费用。前端「检查 / 重试同一请求」沿用 UUID；「编辑后重新提问」生成新 UUID。服务断网时应先检查原请求状态，再重新提问。

当前会话已知 pending 且没有正在发送的请求时，前端每 2 秒读取一次历史/额度，最多 2 分钟；成功、失败、切换宠物/会话或离开页面时停止。该过程不调用模型、不增加额度。超过窗口仍未确认结果时保留手动检查入口。历史分页以数据库首批最新行的时间为后续批次上界，避免浏览器时钟偏慢隐藏刚保存的回答。

## POST /functions/v1/storage-cleanup

相同用户鉴权/CORS。body `{}`。最多清理本人 100 个队列路径：成功 `{"removed":数字}`。失败为 401/403/405/503 和标准 error.code。失败保留队列，不能通过传路径或 user_id 清理别人的文件。

## POST /functions/v1/send-sms

此接口供 Supabase Auth 的 Send SMS HTTP Hook 调用，浏览器不得直接调用。无需用户 JWT，必须通过 Standard Webhooks 的 webhook-id / webhook-timestamp / webhook-signature 验签。只接受 POST 和最多 32 KiB 的原始请求体，验证码限定 6 位、号码限定 +86 中国大陆。

以 sms.phone 为实际目的号码，sms.otp 为 Supabase 生成的验证码；按事件 ID 在 sms_deliveries 先占位去重，再调用阿里云 PNVS。已受理的重复事件返回 200；发送中或结果未知不再次调用上游。成功返回 `{}`，失败返回 Auth Hook 的 `error.http_code/message`，不套用 AI 的错误格式。方法不符 405、未验签/载荷不合法 401、非法地区 400、配置/存储/上游失败 503。只记录状态与安全错误码，不存验证码或手机号。

上游为 `https://dypnsapi.aliyuncs.com` 的 `SendSmsVerifyCode`（2017-05-25），ACS3-HMAC-SHA256 鉴权。直接传入 Supabase OTP，ReturnVerifyCode=false、AutoRetry=0、ValidTime=300、Interval=60；模板 min=5 与当前 Auth 五分钟有效期一致。只有 Code=OK 且 Success=true 才表示上游受理，实际送达仍需核对收件及回执。配置和验证边界见 SMS-SETUP.md。

## 上游 DeepSeek

仅 Edge 发送到 `https://api.deepseek.com/chat/completions`，Bearer DEEPSEEK_API_KEY；默认 `model:deepseek-flash`、`stream:false`、`max_tokens:1800`、`thinking:{type:'disabled'}`。读取 `choices[0].message.content`、`finish_reason`、`usage.prompt_tokens/completion_tokens`；只接受完整 stop 响应。

健康规则与固定免责声明在 `ai-core.ts`。系统规则不混入用户资料；上下文作为标注为不可信的数据消息。服务端过滤明显诊断、处方和剂量输出，前端用文本插值渲染，绝不 v-html。急症关键词直接返回线下就医提示。

资料输入会传给 DeepSeek，界面有明确说明；用户身份 ID、邮箱、对象路径与签名 URL 不会发送给模型。
