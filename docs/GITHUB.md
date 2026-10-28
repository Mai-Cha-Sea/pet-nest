# GitHub 源码仓库

仓库：https://github.com/Mai-Cha-Sea/pet-nest 。用户指定创建的私有仓库，保存项目源码、数据库迁移、占位环境示例、测试及开发文档。公开手机测试网站仍为 https://pet-nest-mobile.pages.dev 。

## 提交范围

提交 Vue 前端、共享验证、Supabase 函数/迁移、自动测试、锁文件、README 与项目文档，包括保留的原始 Word 文档和测试截图。`.gitattributes` 统一文本换行并将图片/Word 标为二进制，减少跨系统的格式差异。

真实 `.env` 配置、模型/阿里云密钥原文件、测试账号文件、临时工具/日志、node_modules、dist 和 Pages ZIP 均由 `.gitignore` 排除。上传前检查文件清单、已知真实密钥/密码、常见凭据格式及 Word XML；私有仓库也不作为密钥备份。

Git 提交使用本项目的本地设置和 GitHub 隐私邮箱，不改电脑全局 Git 身份。首次上传分支对齐新仓库的默认 main。GitHub 网页登录与本机 Git 授权独立；需要授权时，通过官方 Git Credential Manager 或 GitHub CLI 完成，密码和令牌不写入源码或远程 URL。

本次内置 Git Credential Manager 连接未返回，实际改用官方 GitHub CLI 2.103.3，由用户在 GitHub 页面亲自完成授权，凭据保存在 Windows 凭据库。上传时仅给当前 Git 命令指定 CLI 凭据助手，没有改全局助手设置；其他电脑需要自行安装、登录官方工具，并按其说明配置 Git。

## 下载并运行

```powershell
git clone https://github.com/Mai-Cha-Sea/pet-nest.git
cd pet-nest
npm.cmd ci
```

私有仓库需要登录拥有权限的 GitHub 账号。新电脑按 README 从 `.env.example` 准备本机公开 Supabase 配置，已有环境文件不要覆盖；服务端密钥只在 Supabase Secrets。克隆仓库不会自动获得本机的真实配置和测试账号密码。

## 后续更新

修改后先运行适当检查，查看 `git status` 和 `git diff`，只提交本次需要的文件，再执行普通 `git push`。不要使用 force push 覆盖远程历史，也不要强制添加被忽略的密钥文件。

`.github/workflows/check.yml` 在 push/pull_request 后运行安装、前端/Edge 类型检查、自动测试、构建和格式检查，不需要真实 API 密钥。云端执行结果查看仓库 Actions 页面，本地通过不能代替 GitHub CI 结果。

上传 GitHub 与更新 Pages 是两个操作。当前 Pages 使用 Direct Upload，不会因为 Git push 自动发布；更新测试网站仍按 CLOUDFLARE-PAGES.md 打包并向既有 Pages 项目上传。此次不改变网站托管方式或开通新的部署服务。
