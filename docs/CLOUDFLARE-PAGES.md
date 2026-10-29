# Cloudflare Pages 手机测试站点

## 当前发布：0.2.0（P1），2026-10-29

已按用户要求更新既有 `pet-nest-mobile` 的 Production，网站仍为 **https://pet-nest-mobile.pages.dev**。部署编号 `238b5a34-ae98-49fc-bec5-6c0da9859f1b`，上传包 `pet-nest-pages-20261029-125806.zip`，31 个静态文件，SHA-256 为 `36b63a8da566c4150dca2c0a10073a4b442eaac4d40160cc396ad644decfde95`。Cloudflare 确认全部上传且发布成功；13 个线上入口、28 个 JS/CSS 与本地构建一致，测试账号登录及社区/个人页读取正常，设置页显示 0.2.0。详细检查和回退说明见 [P1 发布记录](RELEASE-0.2.0.md)。

后端继续使用原开发项目，域名不变，无需再次调整 Auth 回跳或 CORS。本次没有申请新 Token 或改为 Git 自动部署。以下 2026-10-28 的 P0 发布过程作为历史保留，文件数和测试数字不代表当前版本。

## 首次发布历史

发布日期：2026-10-28（Asia/Shanghai）。

测试网址：**https://pet-nest-mobile.pages.dev**。连接现有 Supabase 开发项目 pet-nest-dev，账号、宠物和记录使用同一份云端数据。2026-10-28 用户已反馈验证码输入修复后的测试通过；真实手机浏览器的布局、软键盘和上传等测试由用户继续进行。

## 本次部署方式

使用 Cloudflare Pages 的 Direct Upload，项目名 pet-nest-mobile。用户本人登录 Cloudflare 后，通过官方网页上传已构建的 ZIP；没有申请额外 Cloudflare API Token、购买付费套餐或创建远程 Git 仓库。项目使用 Pages，并未改为 Workers 或 Sites 托管。

本次实际上传包：`artifacts/pages/pet-nest-pages-20261028-170333.zip`，22 个文件，SHA-256：`721aeb80c142d8fa7044d23f3b3ee05cd51e1ab4013a74ab9dea96b42dad4697`。包内只有 dist 的网页内容，根目录是 index.html，不再套一层 dist；assets 内路径统一使用 `/`。Cloudflare 页面确认“Success! Your project is deployed”。

本地打包脚本 `scripts/package-pages.ps1` 校验静态文件类型、25 MiB 单文件限制、ZIP 根入口、文件数量和路径格式。首次打包遇到 Windows PowerShell 5 的编码/程序集加载及旧 .NET ZIP 反斜杠问题，已修复并验证；正式发布使用修复后的包。开发密钥、测试账号和原始文档不在上传目录。公开 Supabase key 已核对为 anon，真实服务端密钥和测试账号密码在 22 个文件中均未出现。

官方依据：[直接上传](https://developers.cloudflare.com/pages/get-started/direct-upload/)、[Vue 构建目录](https://developers.cloudflare.com/pages/framework-guides/deploy-a-vue-site/)、[单页应用路由](https://developers.cloudflare.com/pages/configuration/serving-pages/)。Direct Upload 项目不能直接改为 Git 集成项目；将来需要自动 Git 部署时创建独立 Git 集成项目，当前先用于手机验收。

## 已同步的后端配置

- Supabase Auth Site URL 为 `https://pet-nest-mobile.pages.dev`。
- 允许该站点根地址、`/auth`、`/profile` 作为回跳；已有 localhost/127.0.0.1 地址保留。
- Functions Secrets 的 ALLOWED_ORIGINS 增加该站点的确切 origin，保留本机地址，没有使用通配符。
- DeepSeek、阿里云 AccessKey、Hook 签名密钥仍只在 Supabase 服务端；Cloudflare 上传的网页不包含它们。
- config diff 先核对仅改 Site URL 与回跳列表，再 push；重新检查云端邮箱/手机均启用且均禁止自动确认。短信 Hook、RLS 和每日 AI 限额没有被关闭。

前端使用本机 `.env.local` 的两个 VITE 公开变量构建，已经编入静态文件。这次没有使用 Cloudflare 云端构建，因此无需在 Pages Dashboard 另填服务端密钥。不要上传项目根目录、`.env` 文件或测试账号文件。

## 已执行验证

- `/`、`/auth`、`/pets/new`、`/profile`、`/ai` 均 HTTP 200，返回内容与本次 dist/index.html 一致。
- 19 个 JS/CSS 资源全部 HTTP 200，逐文件 SHA-256 与本地构建一致，未错误返回 HTML。
- 页面返回 nosniff、DENY 等已配置安全头。
- ai-chat、storage-cleanup 对本站 origin 的预检均成功；无登录请求仍为 401，响应包含正确 CORS 头。没有为此调用模型或发送短信。
- 真实线上浏览器登录测试账号 A，核对预期昵称和原有测试宠物；AI 页面读取到当天额度和已保存会话选项，没有新发提问。
- 390 × 844 预览下宠物列表和 AI 页面无横向溢出；截图 `docs/screenshots/pages-mobile.png`。浏览器预览不代替真实手机验收，临时尺寸检查后恢复默认。

本机报告：`test-results/pages-deployment.json`。报告没有密钥或密码，已被 Git 忽略。业务代码保持上一阶段 104 项自动测试通过的版本；此次重新执行生产构建、产物扫描、部署联网检查和认证配置检查，不将历史测试写成新的执行。

## 后续更新网站

在本机 Windows PowerShell 执行：

```powershell
npm.cmd run package:pages
```

结果位于被 Git 忽略的 `artifacts/pages/`；latest-package.json 记录最新生成包、文件数和摘要。只使用成功通过检查的包。

在 Cloudflare → Workers & Pages → pet-nest-mobile 中创建新部署，上传新 ZIP 并发布到相同 Pages 项目。不要为每次更新新建项目。网址不变时，无需反复修改 Supabase 的域名白名单。

发布后运行：

```powershell
npm.cmd run test:pages
npm.cmd run check:auth
```

如本机网络需要现有代理，可仅给测试进程设置 HTTP_PROXY/HTTPS_PROXY 并使用 Node 24 的 `--use-env-proxy`；不要关闭 TLS。此次线上验证使用了本机已有代理，并未修改系统网络设置。

## 手机验收

用手机浏览器打开上方 HTTPS 地址，以现有账号登录。按顺序检查宠物列表/详情、喂食和体重记录、刷新持久化、AI 提问即时回答、历史、头像/异常图片上传、手机号/邮箱绑定、退出再登录。没有配置 PWA 安装或离线模式，测试数据仍保存在 Supabase。

旧 A/B 的 +44 虚构号码不适用当前 +86 输入框，使用本机账号文档中的测试邮箱和密码；本人已完成绑定的手机号可使用原密码登录。不要公开分享测试账号文档。
