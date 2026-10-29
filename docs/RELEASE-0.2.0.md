# 0.2.0（P1）发布记录

发布日期：2026-10-29，Asia/Shanghai。用户授权同步既有 Cloudflare Pages 并更新 GitHub P1 版本。

## 版本与地址

- 网站：[pet-nest-mobile.pages.dev](https://pet-nest-mobile.pages.dev)。设置页实际显示“版本 0.2.0 · P1 宠物记录与社区版”。
- Cloudflare Pages：既有 pet-nest-mobile 项目的 Production，Direct Upload；本次部署编号 `238b5a34-ae98-49fc-bec5-6c0da9859f1b`。未新建站点、Token 或付费服务。
- 私有仓库：[Mai-Cha-Sea/pet-nest](https://github.com/Mai-Cha-Sea/pet-nest)，P1 变更在 [PR #1](https://github.com/Mai-Cha-Sea/pet-nest/pull/1) 归档，版本标签 `v0.2.0`。
- 网页构建对应源码提交 `e8816fc8a6f3dccc0ed0ac66a74d056b4049f42c`。后续发布记录和检查脚本计数修正不改变网页产物。
- 后端继续使用 Supabase pet-nest-dev，六份迁移和三个已部署函数。本轮没有重新执行数据库迁移或修改密钥、Auth 设置。

## 包含内容

保留 P0 的用户体系、宠物档案、六类日常记录、AI 健康助手和 +86 手机/邮箱登录绑定。P1 加入体重成长曲线、图文动态与标签、点赞、评论和一级回复、私有收藏、关注与粉丝、举报及管理员复审操作说明。

包含全面测试后的修正：公开用户协议/隐私政策、注册时明确同意及协议版本留存、个人和社区主页累计获赞、AI 北京时间上下文、隐私公开范围说明和确认弹窗名称。包版本和设置页统一为 0.2.0，依赖版本没有变更。

## 实际上传包

本机文件 `artifacts/pages/pet-nest-pages-20261029-125806.zip`，31 个静态文件，根目录为 index.html。SHA-256：

```text
36b63a8da566c4150dca2c0a10073a4b442eaac4d40160cc396ad644decfde95
```

ZIP 类型、单文件 25 MiB 限制、根入口与路径格式检查通过。前端 Supabase key 为公开 anon；31 个文件没有出现所检查的真实服务端密钥及测试账号密码。源码上传另检查了 146 个候选文件及原始 Word 的 13 个 XML 条目；真实配置、密钥原文件、测试账号文件、构建目录与 ZIP 均被 Git 忽略。

Cloudflare 先确认“31/31 files uploaded / All files were successfully uploaded”，点击 Save and deploy 后显示“Success! Your site was built and deployed to”及正式站点地址，再回到项目核对新 Production 部署编号。

## 本次执行的检查

| 检查           | 实际结果                                                                                                                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 本地完整检查   | 前端与三个 Edge 类型检查、14 个文件共 150 项自动测试、Vite 构建通过；29 个 HTML/JS/CSS 文件的产物扫描通过                                                                                                             |
| 格式与提交     | Prettier 和 Git diff 检查通过；包版本 0.2.0，未改依赖                                                                                                                                                                 |
| 线上入口       | `/`、`/auth`、`/pets/new`、`/profile`、`/ai`、`/settings`、`/timeline`、`/community`、`/community/new`、`/terms`、`/privacy`、动态及社区个人主页深层入口，共 13 个 HTTP 200，逐份摘要匹配 dist/index.html，安全头正确 |
| 线上资源       | 28 个 JS/CSS 均 HTTP 200，SHA-256 与本地逐文件一致，未返回错误的 HTML 回退                                                                                                                                            |
| 后端连接       | ai-chat、storage-cleanup 的 Pages Origin 预检通过；未登录请求均 401，CORS 正确                                                                                                                                        |
| 认证配置       | 云端邮箱、手机号均启用，且均要求真实验证，没有开启自动确认                                                                                                                                                            |
| 浏览器实际读取 | 专用账号 A 登录成功，读取原有测试宠物；社区读取原有动态；个人页显示获赞/关注/粉丝统计；设置页显示 0.2.0；所检查页面无横向溢出                                                                                         |

源码提交 e8816fc 的 GitHub Actions push 和 PR 检查均成功：[push](https://github.com/Mai-Cha-Sea/pet-nest/actions/runs/40820993911)、[PR](https://github.com/Mai-Cha-Sea/pet-nest/actions/runs/40820998555)。后续提交和合并检查以仓库对应提交的 Actions 状态为准，不能用这些旧结果替代。

检查报告在本机忽略的 `test-results/p1-release-check.log`、`test-results/pages-deployment.json`。线上检查脚本已扩展为 13 个入口，汇总数量从实际检查结果计算。本轮没有新发模型、短信或邮件请求，也没有新增社区测试内容。此前云端写入和多尺寸测试结果分别见 [首轮报告](FULL-TEST-REPORT.md)与 [修复记录](GAP-FIXES.md)，不合并宣称本轮又完整执行。

## 范围与后续维护

GAP-03“网站版本落后”已解决。该网站仍是连接开发后端的课设测试站点，用户反馈与真实设备、性能、48 小时条件的边界保留在 [已知问题](KNOWN-ISSUES.md)。当前只做词库文字审核，图片无语义或 OCR 审核；P2 未开发。

源码推送与 Pages 发布仍是独立操作，Git push 不会自动更新本站。后续按 [Pages 文档](CLOUDFLARE-PAGES.md)构建、扫描、上传到同一项目并重新运行线上检查。需要回退前端时，在 Cloudflare 项目的历史成功部署中选择回退并复测；前端回退不回滚数据库，禁止为回退而删除云端数据或已执行迁移。
