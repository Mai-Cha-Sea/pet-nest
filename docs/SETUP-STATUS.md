# Supabase 配置进度

日期：2026-10-27 至 2026-10-28（Asia/Shanghai）。这里只记录已核实状态，不保存密钥、密码或 access token。

## 当前开发环境

- Free 个人组织 `Pet Nest`；开发项目 `pet-nest-dev`，引用 `httzsurpqbbqwazrunsu`，Singapore 区域。数据库密码由用户本人设置，开发代理没有读取或保存。
- 根目录 `.env.local` 保存前端公开 URL/key；`supabase/.env.local` 保存服务端 DeepSeek 配置；原始 `aip key.txt` 保留且忽略 Git。DeepSeek 密钥没有 VITE_ 前缀。
- 用户已明确授权官方 Supabase CLI 登录，凭据名称 `Codex Pet Nest development`，可在账号中撤销。网页登录与 CLI 授权独立；本机已完成 CLI 授权，无需再次登录。
- 四个数据库迁移均已应用，CLI 本地/远程历史一致；没有重复初始化或执行 reset。原 9 张 P0 public 表和 8 张 P1 public 社区表均开启 RLS；pet-media/community-media 都是私有 bucket，限制单文件 5 MiB。P1 内部敏感词和计数表位于受限 schema。
- `ai-chat`、`storage-cleanup`、`send-sms` 均已通过 CLI API 部署为 ACTIVE。共享依赖 import map 显式配置，部署的是原始多文件源码。
- Secrets 已设置 `DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL=deepseek-flash`、`ALLOWED_ORIGINS`，只允许本机 localhost/127.0.0.1:5173。
- Auth Site URL 已改为 https://pet-nest-mobile.pages.dev，允许该站点根地址及 /auth、/profile 回跳，原本地域名及回跳仍保留。最短密码 8 位，邮箱和手机均要求验证。
- +86 输入、手机号注册验证码及个人中心双向绑定已实现。用户提供的 RAM AccessKey 通过只读 STS 身份校验；没有发送验证短信。密钥仅保存在被忽略的 `1793160748465.txt`、`supabase/.env.sms.local` 和服务端 Secrets 中，不出现在前端。用户已确认签名/数字模板的阿里云调试调用可用。
- Send SMS Hook 已通过 CLI 配置为开发项目的 send-sms，使用本机生成的签名密钥，发送间隔 60 秒。云端手机 OTP 已设为 6 位/300 秒，与模板 min=5 一致；没有填入虚构 Twilio 凭据。真实应用收件/验证/双向绑定闭环仍待用户测试。
- 云端补测发现 CLI 2.122.0 将 auth.sms.enable_confirmations 直接映射为 sms_autoconfirm（与字段描述相反）。已改为 false，并通过公开 Auth settings 确认 phone_autoconfirm=false、mailer_autoconfirm=false；部署后可运行 check:auth 防止误配置。测试曾使 A 的虚构号码自动更新，已用受控管理接口恢复原号码；随后真实 Auth → Hook 拒绝非中国大陆号码且账号不变，未发短信。

## 已执行云端验收

- 两个真实、已确认的开发测试账号 A/B，凭据存本机被忽略的 `.env.test.local` 和便于手工查看的 `测试账号.local.md`。邮箱为保留测试域名，手机号选用 Ofcom 预留虚构号段，均经管理 API 确认，不发送邮件/短信。已实际验证每个账号用邮箱或手机号加同一密码均登录到同一用户。2026-10-28 用户另外自行注册并登录 `Test_01`；只读数据库核实其邮箱已确认、有成功登录记录、业务资料关联正确，补齐用户注册登录验证。
- 真实双账号 smoke：登录、宠物与记录隔离、喂食/体重持久化、私有 PNG 上传/签名访问/越权拒绝、真实 AI 调用、同请求 ID 复用、历史保存、删除自身测试档案及清理函数，均通过。
- 扩展验收：12 个并发宠物创建恰好成功 10 个；25 个并发额度 RPC 恰好受理 20 个，第 21 次 Edge 提问返回 429 DAILY_LIMIT。该额度测试没有调用上游模型，受理请求以明确测试失败状态结束。
- 真实 DeepSeek 回答引用 A 的 42g/4.1kg，排除 B 的 8.2kg/隔离狗粮，保存用户/助手两条消息及 token；新客户端读取和 Auth 刷新通过。
- 第一次模型回答揭示缺少字段单位说明；补充系统层 kg 和 false=未绝育的字段约定后重新部署，真实复测正确显示 4.1 kg 和未绝育。修复后的回答保留在本机验收报告中。
- 急症快速就医指引（token 0）、无登录 401、非法 UUID 400、不可信 origin 403 通过。
- 早期双方式登录验收仅使用管理接口预先确认的测试账号，没有验证普通手机号注册/绑定，未覆盖上述 CLI 转换问题。首次验证曾返回 phone_provider_disabled，配置传播后重测登录通过。随后改为只接受 +86、接入 PNVS Hook，并补测云端真实验证要求；旧 +44 测试号码不再适用于当前输入页面，邮箱仍可登录。

测试报告位于被忽略的 `test-results/cloud-acceptance.json`。A/B 各保留一只标注为测试的演示宠物；另有独立内部 QA 账号保留 10 只并发测试宠物和 20 条无模型调用的失败日志，便于核对，不与 A/B 的日常界面混用。

## 安全检查与边界

安全 advisor 发现平台自动 RLS 函数有过宽 EXECUTE 权限，已增加迁移收紧并重新检查。当前剩余 1 项提醒：`auth_leaked_password_protection`。官方文档说明泄露密码检测需 Pro 或更高套餐，当前 Free 项目未升级，保留提醒：[密码安全文档](https://supabase.com/docs/guides/auth/password-security)。不能将结果描述为“零提醒”。

本机测试使用已有本地系统代理解决 Node 直连问题，只影响测试进程，没有改系统代理或关闭 TLS。前端已有 P0 手机测试站点 https://pet-nest-mobile.pages.dev。用户现已授权 P1；成长曲线、社区源码与开发后端联调已完成，P1 前端发布情况以最新交付记录为准。P2 未开始。

真实浏览器闭环及 24 个响应式布局检查已完成，结果见 TEST-RESULTS.md。用于验收的临时高权限 key 文件已移除；用户原有模型密钥文件和最终测试账号文件保留在本机且忽略 Git。CLI 账号授权仍可由用户在 Supabase 账号设置中撤销。Pages 网站独立于本地 Vite，手机测试无需保持开发服务运行；本机开发仍使用 `npm.cmd run dev`。

## Cloudflare Pages 发布补充（2026-10-28）

用户本人完成 Cloudflare 登录后，已创建 pet-nest-mobile Pages 项目并使用 Direct Upload 发布 22 个静态文件。用户此前反馈验证码输入修复后的测试通过。Site URL/回跳和 ALLOWED_ORIGINS 已同步新站点，核对云端不自动确认邮箱/手机号仍通过。

5 个线上页面入口、19 个 JS/CSS 逐文件内容和安全头通过；两个私有 Edge 接口的本站 CORS 预检及未登录 401 通过。浏览器线上登录 A，读取原测试宠物、当天额度及已保存会话选项；390 × 844 检查未发现横向溢出，检查后恢复浏览器默认尺寸。本次没有发送新 AI 提问或短信。记录、上传包和更新方法见 CLOUDFLARE-PAGES.md；没有使用 Cloudflare API Token 或发布源代码/密钥。
