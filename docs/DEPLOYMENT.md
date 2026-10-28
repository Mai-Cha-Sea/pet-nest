# 本地配置与部署准备

当前开发后端为 pet-nest-dev（引用 `httzsurpqbbqwazrunsu`），五份迁移和三个 Edge Functions 已部署。P1 自动发布与双 bucket 清理已完成开发环境联调，词库选择及复审操作见 [MODERATION.md](MODERATION.md)。前端已有 [Cloudflare Pages 手机测试站点](https://pet-nest-mobile.pages.dev)，原 P0 发布记录见 [CLOUDFLARE-PAGES.md](CLOUDFLARE-PAGES.md)，P1 前端是否发布以最新交付记录为准。新环境按下面步骤配置，不要覆盖已有环境文件。

## 环境变量

| 变量                                                             | 放在哪里                                     | 用途                                                        |
| ---------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------- |
| VITE_SUPABASE_URL                                                | 本地 .env.local、前端托管构建环境            | 公开项目 URL                                                |
| VITE_SUPABASE_ANON_KEY                                           | 同上                                         | publishable 或 legacy anon key，浏览器公开使用              |
| SUPABASE_URL                                                     | Supabase Edge 自动提供                       | 服务端项目 URL                                              |
| SUPABASE_ANON_KEY                                                | Supabase Edge 自动提供                       | 调用 Auth 验证用户 token                                    |
| SUPABASE_SERVICE_ROLE_KEY                                        | Supabase Edge 自动提供                       | 受控查询与 RPC，绝不放浏览器                                |
| DEEPSEEK_API_KEY                                                 | Supabase Functions Secrets                   | DeepSeek Bearer 密钥                                        |
| DEEPSEEK_MODEL                                                   | 同上，默认 deepseek-flash                    | 官方支持的模型 ID                                           |
| ALLOWED_ORIGINS                                                  | 同上                                         | 前端 origin 白名单，英文逗号分隔，不包含 /auth 等路径       |
| ALIBABA_CLOUD_ACCESS_KEY_ID / ALIBABA_CLOUD_ACCESS_KEY_SECRET    | 服务端 Secrets，本机 supabase/.env.sms.local | 最小权限 RAM 用户，调用 PNVS SendSmsVerifyCode              |
| ALIYUN_SMS_SIGN_NAME / ALIYUN_SMS_TEMPLATE_CODE                  | 同上                                         | PNVS 配套赠送签名及数字模板编号                             |
| ALIYUN_SMS_TEMPLATE_PARAM_NAME / ALIYUN_SMS_TEMPLATE_PARAMS_JSON | 同上                                         | 验证码变量名及其他变量；当前 min=5                          |
| SEND_SMS_HOOK_SECRET                                             | 同上，另注入 CLI 进程                        | Auth Hook HMAC 签名密钥，config.toml 仅引用 env，不写真实值 |

`.env.example` 所有密钥只有占位符。用户提供的 DeepSeek 密钥保存在被忽略的 `supabase/.env.local`，并已通过 CLI 部署到开发项目 Functions Secrets。`.gitignore` 忽略 `.env`、`.env.*`（仅允许 example）、`api key.txt`、`aip key.txt` 和本地 Supabase CLI 状态。真实密钥不要粘贴在源码、Git、截图、命令参数或聊天中。

## Supabase 开发项目

1. 在 Supabase 控制台创建你的测试项目，记录项目引用 ID。密码只保存在你的密码管理器中。
2. 推荐用下面 CLI 方式依次部署 `supabase/migrations/`，迁移记录由 CLI 管理。若首次通过 SQL Editor 初始化，先检查空项目，再执行初始化文件；后续必须登记迁移基线再用 CLI。当前开发项目已登记，不能重复初始化。
3. 确认 Database 表、RLS policy、pet-media 私有 bucket 均存在。不要把 bucket 改为 Public，不要关闭 RLS 来解决权限问题。
4. Auth → URL Configuration：Site URL 为前端实际地址，Redirect URLs 包含前端 `/auth`。开发时加入 `http://localhost:5173/auth` 和 `http://127.0.0.1:5173/auth`。
5. Email 登录启用注册、邮箱验证和至少 8 位密码。邮件可能有频率限制，正式演示建议配置自己的邮件服务；不需要为方便演示关闭验证。

现有页面支持邮箱及 +86 手机号注册/密码登录，个人中心支持双向绑定。当前固定使用 CLI 2.122.0，它将短信 enable_confirmations 直接映射 sms_autoconfirm；本项目设 false 后已验证云端 phone_autoconfirm=false，必须通过真实验证码。不要仅凭字段名称改成 true。新增 send-sms 作为 Auth HTTP Hook，将 Supabase OTP 交给阿里云 PNVS；不能直接填到 Twilio 表单。完整步骤和云端核验见 [SMS-SETUP.md](SMS-SETUP.md)。

旧 A/B 测试手机号使用 [Ofcom 公布的虚构移动号码段](https://www.ofcom.org.uk/phones-and-broadband/phone-numbers/numbers-for-drama)，由管理接口确认且不能接收短信。现有 +86 页面不接受这些旧号码，请使用测试邮箱登录；不将虚构号码替换成可能属于他人的中国大陆号码。密码对照仅保存在被忽略的 `测试账号.local.md` / `.env.test.local`，不作为迁移固定账号，不修改 Test_01。

CLI（可选，按[官方 CLI 文档](https://supabase.com/docs/guides/local-development/cli/getting-started)安装；首次 `npx supabase` 会下载 CLI）：

```powershell
npx supabase@2.122.0 login
npx supabase@2.122.0 link --project-ref 你的测试项目引用
npx supabase@2.122.0 db push --dry-run
npx supabase@2.122.0 db push
npx supabase@2.122.0 functions deploy ai-chat storage-cleanup send-sms --use-api --no-verify-jwt --import-map supabase/functions/deno.json
npx supabase@2.122.0 secrets set --env-file supabase/.env.local
```

先阅读 dry-run，再执行 push。本任务没有授权破坏性 reset；不要在共享/生产数据库运行 `db reset`。如果前面已经用 SQL Editor 初始化，请先按 CLI 文档修复迁移基线，不要再重复 push 同一个建表脚本。

`supabase/config.toml` 对三个函数设置 `verify_jwt=false`。ai-chat/storage-cleanup 内主动调用 Auth.getUser(token)，send-sms 验证 Auth HTTP Hook 的 HMAC 签名；这不允许任意匿名调用。配置与源码必须一起部署，不能删除对应鉴权。

三个函数都显式配置 `import_map = "./functions/deno.json"`。共享配置不会自动被所有 CLI 部署方式识别；缺少它会导致裸模块 `@supabase/supabase-js` 无法解析。本次使用 `--use-api` 部署原始多文件源码，不需要 Docker。服务端依赖与前端锁定为相同的 Supabase/Zod 版本。

短信另用 `npx supabase@2.122.0 secrets set --env-file supabase/.env.sms.local` 部署，只把真实值写在已忽略文件中。执行 config diff/push 前，将本地 SEND_SMS_HOOK_SECRET 载入当前 CLI 进程，检查 Hook URL 指向目标开发项目，先查看 diff 再 push，之后必须执行 `npm.cmd run check:auth` 核对实际自动确认状态。当前仓库 URL 指向本开发项目，复制到新项目时必须调整。没有短信配置时先将 hook.enabled 设为 false，不使用假提供商或固定验证码掩盖缺失。

Supabase Dashboard → Edge Functions → Secrets 填入 DeepSeek 密钥，模型 `deepseek-flash`，origin 白名单例如 `http://localhost:5173,http://127.0.0.1:5173`。使用控制台避免密钥出现在命令参数和终端历史。

本机若 Node 直连 Supabase 域名失败，而浏览器经系统代理正常，可仅为测试进程配置已有代理的 `HTTPS_PROXY` / `HTTP_PROXY`，再用 Node 24 的 `--use-env-proxy`。不要关闭 TLS 校验或为了排障改成公开 bucket。本次 Auth 曾出现一次短暂连接错误，健康检查恢复 HTTP 200 后正常重测通过。

## 本地前端

```powershell
Copy-Item .env.example .env.local
# 在编辑器中只填写 VITE_SUPABASE_URL、VITE_SUPABASE_ANON_KEY
npm.cmd ci
npm.cmd run check
npm.cmd run dev
```

已有 .env.local 时不要执行覆盖复制。环境变量修改后需要重启 Vite。

如需完整本地 Supabase，先自行安装并启动 Docker，然后运行 `npx supabase start`。本次环境没有 Docker，因此未启动 Supabase 本地容器。PGlite 测试无需 Docker 或外部服务；它是测试环境，不是应用的替代后端。

## 前端托管（已发布手机测试站点）

可以使用支持静态 SPA 的 Cloudflare Pages 等托管：构建 `npm ci && npm run build`，产物目录 `dist`，Node 24.12.0 或兼容版本。在托管构建环境只填两个 VITE 变量。

`public/_redirects` 已配置 `/* /index.html 200`，确保直接打开 `/pets/...`、`/ai` 等路径不会 404。`public/_headers` 提供基础安全头。其他托管平台应配置等效的 SPA 回退和响应头。

当前使用 Pages Direct Upload 上传本机构建产物，地址为 https://pet-nest-mobile.pages.dev。Auth Site URL、根地址与 /auth、/profile 回跳、Edge ALLOWED_ORIGINS 已配置；原本地地址保留。已实际验证页面、全部 JS/CSS、CORS/未登录拒绝、线上测试账号登录和云端数据读取。手机实机验收由用户继续，详情见 CLOUDFLARE-PAGES.md。不要将密钥放在托管静态公开变量中。网站未使用 Sites 云托管。

## 运维和成本

- ai_requests 按 owner/时间索引记录 status、error_code、model、prompt/completion tokens 与 latency；用 Supabase SQL/控制台监控，不能从客户端修改统计。
- 超时或网络中断可能已被上游计费，但拿不到 usage，此时本地 token 统计无法反映全部费用；需与 DeepSeek 账单核对。
- 界面只查询近 30 天历史，数据库保留更早日志；若需要物理保留期，先明确规则，再编写可审查的数据清理迁移，不自动删除用户数据。
- 已关联图片清理有持久化队列，普通用户登录/操作时重试。正式生产还需要管理员配置周期清理（通过受控服务端 Storage API），特别是长时间未登录、删除账号和上传后断网的孤立文件；不能在数据库直接 DELETE storage.objects 以为文件已删除。
- GitHub Actions 的 `.github/workflows/check.yml` 在私有仓库 Mai-Cha-Sea/pet-nest 的 push/pull_request 后运行。每次上传应核对 Actions 中对应提交的实际结果；本地通过不代表云端 CI 已成功。源码仓库及更新步骤见 GITHUB.md。
