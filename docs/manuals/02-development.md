# 宠物小窝开发接手与维护指南

适用版本：0.2.0（P1），含 main 分支 9259ee8 的源码注释与交接资料。编写日期：2026-10-29。本册面向实际接手的开发者，说明如何获取源码、理解关键约束、定位修改入口并完成一次可验证的维护。应能从 GitHub 取得代码和公开资料；平台权限、真实密钥和云端数据需另行交接。

## 获取完整项目

克隆 [项目 main 分支](https://github.com/Mai-Cha-Sea/pet-nest/tree/main)。仓库由用户主动设为公开，推送仍需要写权限。旧 v0.2.0 标签是较早快照，不包含后来补充的全部注释和交接指南。

```powershell
git clone --branch main https://github.com/Mai-Cha-Sea/pet-nest.git
cd pet-nest
npm.cmd ci
```

使用 Node.js 22.12 及以上或项目已验证的 24.12.0，按 package-lock.json 安装。仓库含 Vue 前端、共享规则、三个 Edge Functions、六份迁移、测试、占位环境示例、原始项目 Word 和开发文档，不包含 node_modules、dist、本机工具或真实测试密码。

先复制新的 .env.example 为 .env.local，仅填写前端项目地址和公开 key；已有配置不能覆盖。运行 npm.cmd run dev。无连接配置时可预览部分界面，真实登录、保存和 AI 需要后端。纯本地自动测试使用受控夹具，不要求真实模型或短信服务。

## 阅读顺序与架构

建议先读 README、HANDOVER，再读 DATABASE 和 API；随后从 shared/domain.ts、src/lib/api.ts 和一个记录页面跟踪完整流程。社区阅读 shared/community.ts、src/lib/community.ts 和 P1；AI 阅读 AIView.vue、ai-handler.ts、ai-core.ts 与 repository.ts。

| 层次       | 位置                                     | 责任                                         |
| ---------- | ---------------------------------------- | -------------------------------------------- |
| 页面与组件 | src/views 和 src/components              | 表单、加载状态、确认、分页与即时反馈         |
| 前端访问层 | src/lib/api.ts、community.ts、account.ts | SDK 调用、前端预检、错误传递与重试恢复       |
| 共享规则   | shared                                   | 字段类型、Zod、号码格式、成长图与协议版本    |
| 服务端     | supabase/functions                       | 验证真实身份、模型请求、短信 Hook 和图片清理 |
| 数据库     | supabase/migrations                      | 真实权限、归属、约束、幂等、计次与删除一致性 |
| 验证和维护 | tests、scripts、docs                     | 自动回归、显式云端验收、部署与交接记录       |

前端校验负责交互质量，不能代替数据库 RLS、RPC 的归属检查或 Edge 的鉴权。高权限客户端位于服务端，查询必须显式限定已验证用户、宠物及会话。普通社区用户看不到私有档案、记录和 AI 对话。

## 按任务定位修改入口

| 任务            | 主要源码与回归                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| 注册 登录和绑定 | AuthView、AccountBindings、lib/account、stores/auth；auth-view、account、bindings-view、router 测试          |
| 宠物和六类记录  | PetEditView、RecordView、RecordList、lib/api、shared/domain；api、domain、views、database 测试               |
| 体重图          | WeightChart、shared/growth、getWeightRecords；growth、api 测试                                               |
| 社区和互动      | Community 各页面、CommunityFeed、CommunityPostCard、lib/community；community、community-views、database 测试 |
| AI 页面与后端   | AIView、askAI、ai-handler、ai-core、repository；views、api、ai、database 测试                                |
| 短信 Hook       | send-sms、sms-handler、aliyun-sms；sms 测试与真实开发项目验证                                                |
| 协议与获赞      | content/legal、shared/legal、两个主页、community_person；legal-profile、auth-view、database 测试             |

文件名以仓库实际目录为准，上表省略公共路径和 .vue/.ts 后缀。新增状态、字段或错误码时同时核对调用者、共享类型、数据库定义、统一错误映射和对应测试。

## 必须保持的行为约束

### 账号与资料隔离

Supabase Auth 管理密码。手机号固定中国大陆 +86，注册确认使用 sms，已登录绑定使用 phone_change；每次绑定响应需核对原用户 ID。SDK 持久会话和路由守卫不是数据库授权凭据。RouterView 按用户和路径重建，防止切换账号复用旧界面状态。

宠物每人最多 10 只，数据库按同用户锁定后计数。private users/pets/records 与 community_profiles 分开；社区仅复制主动选择的宠物名称，不把宠物 ID、头像或健康记录公开。

### AI 请求与状态恢复

AI 顺序为鉴权、参数、配置、事务受理、上下文、上游或急症指引、输出检查、保存、返回。reserve 在一个事务内校验归属、会话、日额度与请求幂等，新受理请求计次并写 pending。失败也占次，同 ID 受理不重复调用。finish 只接受 pending，重复完成报错，不插入第二条回答。

前端 messages/requests 是云端快照，liveTurns 保留本页问答。按 request_id 和角色合并，已收到的回答不因历史暂时滞后而消失。generation 防止过期加载覆盖当前宠物；已知 pending 每两秒只读检查、最长两分钟，不新调模型。新问题和同请求重试的标识策略不能混用。

模型与数据库无法组成跨服务原子事务，保存结果未知时先核对历史。token 为零可能代表没拿到统计，不能推断没有计费。AI 文字上下文有 30 天、100 条记录、字符预算和最近 10 轮成功问答边界；不传图片路径或身份资料。

### 图片与社区幂等

先上传后关联。网络失败可能发生在数据库提交之后，必须先回查引用；无法确认时保留文件，不按前端猜测删除。已关联文件通过持久队列交给 Storage API 清理；未关联孤立对象需要另行核查。

发布页固定动态 UUID，保存草稿、续传路径再发布；未知结果保留原请求。点赞、收藏、关注采用设置目标状态，重复请求不反转。评论 UUID 与首次正文绑定，只允许同帖一级回复。

词库在数据库执行，不做图片语义或 OCR。旧 pending 保持私有直到作者主动重审，rejected 不可直接重发。获赞是当前已发布动态的真实点赞合计，不维护前端伪造累计数。

## 数据库和接口维护

六份迁移按文件名顺序执行，已执行文件不删除或改写。新增业务变更使用新迁移，经 SQL 回归和 dry-run 再部署。函数可能被后续 CREATE OR REPLACE 替换，应从 [最终函数索引](https://github.com/Mai-Cha-Sea/pet-nest/blob/main/docs/DATABASE-FUNCTIONS.md)定位 25 个最终签名及权限，不只读最初的 P1 文件。

接口以 Supabase 官方 SDK 和 RPC 为主，继续检查 data/error，不为了统一格式包裹所有标准行为。ai-chat 使用 {error:{code}}；短信 Hook 返回其标准 error.http_code/message，不混用错误约定。统一用户提示在 lib/errors.ts；未知短消息会保留，因此调用端必须去敏。

Supabase 数据库类型目前主要手写，as T 不构成运行时验证。更改 SQL 返回字段时同步共享接口与测试。自动生成类型、更多返回值 schema 和 ESLint 属于后续维护改造，本次没有宣称已完成。

协议正文版本改变时，更新 content/legal.ts、shared/legal.ts 并新增迁移维护可接受声明版本。旧用户同意保持原值，不补造历史；同意快照不能作为身份或授权依据。

## 修改与验证流程

修改前检查 git status，阅读目标文件、调用者和回归。选择最小可维护改动，新增必要的行为测试；不复制一套认证、图片存储或模型客户端。保留已有环境文件及未知用途文件。

```powershell
npm.cmd run check
npm.cmd run format:check
npm.cmd run test:preview
```

check 执行前端及三个 Edge 类型检查、测试和构建。当前回归为 14 个文件共 150 项；以后增减测试须以实际输出为准，不把本册数字当作必须硬编码的断言。数据库专项运行 npm.cmd run test:database。真实云端脚本会写入或清理数据，先看各脚本开关和隔离范围，不加入默认 CI。

改动后核对 Git diff 和待上传清单，确认真实密钥、账号、原始日志、node_modules、dist 与 ZIP 被排除。main 的 GitHub Actions 执行安装、check 和格式检查，以对应提交状态为准。Git 推送与 Pages 发布是两个独立动作。

## 接手清单与后续维护

平台权限由维护者分别授予：GitHub 推送、Supabase 项目、Cloudflare Pages，以及模型和短信服务。真实配置通过安全渠道交接或由新维护者创建，不从公开仓库寻找密钥。被忽略的 .tools 是原电脑临时工具，不是新电脑的必要依赖。

接手验收应由新人独立完成：克隆并启动、跑通本地检查、解释一个 AI 网络恢复路径和一个社区发布失败路径，定位一条 RLS/RPC 约束，并在测试环境完成一个小修改和验证。目前没有真人独立接手演练结果，不把这个建议写为已经通过。

原始指南和详细记录位于 [docs 目录](https://github.com/Mai-Cha-Sea/pet-nest/tree/main/docs)。后续继续保持注释、Markdown 和 Word 同步；更新 Word 的方法见同目录文档索引。历史测试次数、云端调用与发布结果应保留日期，不改写为本次执行。
