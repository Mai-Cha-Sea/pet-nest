# 宠物小窝 · Pet Nest

Vue 3 + TypeScript + Vite 前端，Supabase PostgreSQL/Auth/Storage，Edge Functions 调用 DeepSeek。依据原始 V3.0 文档实现 P0；用户已确认进入 P1，新增体重成长曲线、图文社区、点赞/评论/收藏及关注体系。未开发 P2。

源码仓库：[Mai-Cha-Sea/pet-nest](https://github.com/Mai-Cha-Sea/pet-nest)（用户已手动设为公开）。提交范围、克隆和后续更新见 [GitHub 说明](docs/GITHUB.md)，敏感配置检查见 [密钥与提交安全记录](docs/SECRET-SAFETY.md)。

**当前版本 0.2.0（P1），已发布至手机测试站点：[pet-nest-mobile.pages.dev](https://pet-nest-mobile.pages.dev)。** 2026-10-29 发布前完整检查中 150 项自动测试通过；线上 13 个页面入口及 28 个 JS/CSS 文件与构建一致，认证配置、后端 CORS、真实测试账号登录与社区/个人页读取通过。发布范围、包摘要和回退方法见 [P1 发布记录](docs/RELEASE-0.2.0.md)。先前完成的 26 组真实开发云端业务与 39 项响应式检查，以及协议/获赞 3 组云端和 15 项布局验证分别保留在 [101 项测试表](docs/TEST-MATRIX.md)、[首轮报告](docs/FULL-TEST-REPORT.md)及[修复记录](docs/GAP-FIXES.md)，不能据此宣称全部生产验收完成。用户选择本阶段仅用敏感词自动审核，图片不做语义识别，保留举报人工复审；详见 [P1 指南](docs/P1.md)和[审核操作说明](docs/MODERATION.md)。配置在被 Git 忽略的 `.env.local`，部署方式见 [Cloudflare Pages](docs/CLOUDFLARE-PAGES.md)，历史验收见[测试结果](docs/TEST-RESULTS.md)。

## 先在本机打开

要求 Node.js 22.12+ 或 24（本次实际使用 24.12.0），npm。Windows PowerShell 推荐使用 `npm.cmd`，避免 PowerShell 对 npm.ps1 的策略限制。

```powershell
npm.cmd ci
npm.cmd run dev
```

打开命令输出的本地地址（默认 [http://127.0.0.1:5173](http://127.0.0.1:5173)）。当前机器已经配置开发后端；两个专用测试账号的邮箱、手机号与密码见本机 `测试账号.local.md`，自动化配置保留在 `.env.test.local`，两者均被 Git 忽略，不随仓库分发。它们的演示档案明确标注为测试数据。换电脑时需重新填写公开连接配置，未配置时界面会提示。

```powershell
npm.cmd run check          # 前端类型 + 三个 Edge 类型 + 150 项本地测试 + 构建
npm.cmd run format:check   # 源码格式检查
npm.cmd run test:database  # 全部迁移在 PostgreSQL WASM 引擎执行及 RLS 测试
npm.cmd run check:auth     # 联网核对云端邮箱/手机均要求真实验证，不发送验证码
npm.cmd run build          # 输出 dist/
npm.cmd run preview       # 查看生产构建
npm.cmd run test:preview  # 自动启动/关闭生产预览并检查深层路由 HTTP
npm.cmd run package:pages # Windows：构建并生成仅含静态网页的 Pages ZIP
npm.cmd run test:pages    # 联网检查已发布站点、资源内容、安全头和接口 CORS
```

`deno` 已作为开发依赖安装，npm 脚本能直接找到它，无需修改系统 PATH。项目使用 `package-lock.json` 锁定依赖，请用 `npm ci` 复现。

## 接入自己的测试项目

1. 创建独立 Supabase 开发项目，保留邮箱确认。不要把生产数据用于首次迁移。
2. 将 `.env.example` 复制为 `.env.local`，仅填写 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`。此公开 key 配合 RLS 使用；不要填写 Service Role Key。Vite 只公开 `VITE_` 变量。
3. 按 [部署指南](docs/DEPLOYMENT.md) 执行迁移并部署 `ai-chat` 与 `storage-cleanup`。Supabase Functions Secrets 设置 `DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL=deepseek-flash`、`ALLOWED_ORIGINS`。
4. Supabase Auth 设置 Site URL/允许回跳 URL；本机使用 `http://127.0.0.1:5173/auth` 与 `http://localhost:5173/auth`。重启 Vite。
5. 用你拥有的两个不同邮箱在应用注册、验证邮箱，按 [验收清单](docs/TESTING.md) 测试隔离与完整业务闭环。不要把账号密码或密钥提交到 Git 或聊天。

## 目录与学习入口

```text
src/
  views/          登录、宠物、记录、AI、资料与设置页面
  components/     图标、私有图片、时间轴、确认弹窗
  lib/api.ts      Supabase 数据访问与图片上传
  lib/supabase.ts 只读取前端公开配置
  stores/auth.ts 认证状态与自动刷新
shared/domain.ts 共享字段验证、类型、记录摘要
supabase/
  migrations/     数据结构、RLS、限额事务、清理队列
  functions/
    ai-chat/      验证 JWT 后进入 AI 服务
    _shared/      上下文、安全规则、可测试的 HTTP 编排、数据库访问
    storage-cleanup/ 通过 Storage API 清理已删除关联图片
    send-sms/     验签并通过阿里云 PNVS 发送 Supabase 验证码
tests/            PostgreSQL 权限、共享验证、AI 场景、真实 Vue 表单测试
scripts/live-smoke.mjs 真实双账号验收（显式启用后才写入）
scripts/cloud-acceptance.mjs 高级云端验收（需服务端凭据和单独授权开关）
docs/             审查、数据结构、接口、部署、测试、阶段结果与已知问题
```

建议先读 `shared/domain.ts`，再读 `src/lib/api.ts` 和一个页面。理解一条记录从表单到数据库后，再阅读迁移中的 RLS。AI 的规则、上下文和 HTTP 异常处理独立于页面，便于测试与修改。

## 核心业务约定

- 注册/登录均可选择邮箱或中国大陆手机号，手机号区号固定 +86。邮箱注册需要确认邮件，手机号注册需要真实短信验证码。个人中心可给当前账号绑定另一种登录标识，验证完成后与原密码登录同一账号；Supabase Auth 管理密码。旧 A/B 测试手机号是 +44 虚构号码，当前 +86 页面不接受；请继续使用它们的邮箱登录，不会向虚构号码发短信。
- 每人最多 10 只宠物，数据库行锁序列化同一用户的创建。编辑和删除档案均需确认。
- 六种记录：喂食、体重、驱虫、洗澡、用药、异常。所有记录关联本人宠物，按发生时间倒序；每批 50 条，可继续加载。
- 用药只记录用户提供的信息。档案体重是手工资料字段；新建体重记录不会悄悄改写档案体重，AI 同时收到近期体重记录。
- 图片仅 JPG/PNG/WebP、每张最大 5 MiB；异常最多 9 张。私有 bucket，浏览器获取 5 分钟签名链接；数据库保存相对路径，避免把临时 URL 当作永久数据。
- AI 保留会话标识；展示近 30 天历史，使用本宠物近 30 天记录摘要（最多最近 100 条并有字符预算）及当前会话最近 10 轮成功问答。不会把失败提问拼成成功对话。
- 提问立即进入对话区，等待时显示“正在思考”，完成后直接显示接口返回的回答，无需刷新。后台同步历史时按请求 ID 去重，历史暂不可用也不抹去已收到的回答；已知 pending 状态每 2 秒检查，最长 2 分钟，只读取状态，不额外调用模型。
- AI 限额按北京时间自然日计，每个**受理的新请求**占一次（失败也计次），20 次上限在数据库事务中强制执行。同一请求 ID 不重复扣次；失败后重新提问用新 ID。服务配置缺失、参数无效、越权都不扣次。
- 急症直接返回固定就医指引并保存；无需等待模型，仍占一次请求额度，token 为 0。
- 删除宠物级联删除记录、会话、调用明细；已消耗的每日额度不返还。已关联图片进入持久化清理队列，登录或后续操作时自动重试。
- UI 只展示近 30 天对话；历史和调用日志默认在云端保留用于审计，不自动清除更早数据，也不在本地存额外的 AI 文本缓存。

## 文档

- [开发接手指南、注释约定与维护清单](docs/HANDOVER.md)
- [源码注释补充范围与验证记录](docs/SOURCE-COMMENTS.md)
- [数据库最终函数定义、权限与回归索引](docs/DATABASE-FUNCTIONS.md)
- [阶段 1 审查与实施计划](docs/01-audit.md)
- [数据库与安全设计](docs/DATABASE.md)
- [接口文档](docs/API.md)
- [部署与环境变量](docs/DEPLOYMENT.md)
- [测试、双账号方案与验收清单](docs/TESTING.md)
- [实际测试结果与阶段进度](docs/TEST-RESULTS.md)
- [当前 Supabase 配置状态](docs/SETUP-STATUS.md)
- [Cloudflare Pages 手机测试站点与后续更新](docs/CLOUDFLARE-PAGES.md)
- [+86、账号绑定与阿里云短信配置](docs/SMS-SETUP.md)
- [已知问题与验证边界](docs/KNOWN-ISSUES.md)

DeepSeek 接入参数已于 2026-10-27 核对[官方初次调用文档](https://api-docs.deepseek.com/)与 [Chat Completions 文档](https://api-docs.deepseek.com/api/create-chat-completion/)：`POST https://api.deepseek.com/chat/completions`、Bearer 认证、`deepseek-flash`、`stream:false`、`thinking:{type:'disabled'}`。部署时可通过服务端变量替换官方支持的模型。

固定免责声明：以上建议仅供参考，不构成诊疗意见。如症状持续或加重，请及时联系线下宠物医院。
