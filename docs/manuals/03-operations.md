# 宠物小窝部署与内容审核指南

适用版本：0.2.0（P1）。编写日期：2026-10-29。本册面向维护者和拥有项目权限的管理员，涵盖环境配置、迁移、服务部署、网站发布、举报复核和内容下架。命令与 SQL 是操作说明，本次编写没有执行部署、发短信、调模型或删除评论。

## 确认目标和权限

现有手机测试站点为 https://pet-nest-mobile.pages.dev，连接 Supabase 开发项目 pet-nest-dev，项目引用 httzsurpqbbqwazrunsu。它是课设开发环境，不能据此认定正式生产验收完成。接手现有项目时先核对账号、项目和域名，不重复初始化数据库；建立新环境时替换项目引用、Hook URL、回跳及 Origin。

| 平台              | 需要的能力                                                   |
| ----------------- | ------------------------------------------------------------ |
| GitHub            | 拉取源码；推送另需仓库写权限                                 |
| Supabase          | 核对迁移、Auth、Storage、Edge 与 Secrets；审核需受控管理权限 |
| Cloudflare        | 更新既有 pet-nest-mobile 的 Pages Production 部署            |
| DeepSeek 和阿里云 | 维护服务端凭据、余额或额度及调用情况，不向前端提供密钥       |

普通应用账号即使可以注册登录，也不是 Supabase 管理员。管理权限通过平台单独交接，Service Role Key 不能填到浏览器环境变量、聊天或公开仓库。

## 配置与密钥

| 配置                                                           | 保存位置和含义                                                         |
| -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY                    | 前端公开连接配置，配合 Auth 和 RLS；不填写高权限 key                   |
| DEEPSEEK_API_KEY 和 DEEPSEEK_MODEL                             | Supabase Functions Secrets；模型配置以项目已验证设置为基线             |
| ALLOWED_ORIGINS                                                | 服务端逗号分隔的准确 origin，例如本站 HTTPS 根 origin；不带 /auth 路径 |
| ALIBABA_CLOUD_ACCESS_KEY_ID 和 ALIBABA_CLOUD_ACCESS_KEY_SECRET | 仅服务端的阿里云 RAM 凭据；采用项目所需最小权限                        |
| ALIYUN_SMS_SIGN_NAME 和 ALIYUN_SMS_TEMPLATE_CODE               | 号码认证 PNVS 对应签名及数字模板编号                                   |
| SEND_SMS_HOOK_SECRET                                           | Auth Hook HMAC 签名密钥；config.toml 仅引用环境变量                    |
| 测试密码和管理测试 key                                         | 被忽略的本机文件或临时进程环境，不能写进源码                           |

公开仓库仅提供 .env.example、.env.test.example 与 supabase/.env.sms.example。模板中的敏感值是占位符。真实 .env 文件、密钥原文件、测试账号文档、工具授权状态和原始报告均排除。Git 忽略规则不移除已经跟踪的文件，提交前还要核对实际暂存区与历史。

## 部署数据库和服务端

本项目已有六份迁移。现有环境先查迁移历史；新环境先确认目标为空或完成已存在数据库的迁移基线登记。先 dry-run，再审查将执行内容；未经明确授权不运行 reset 或删除真实数据。

```powershell
npx supabase@2.122.0 login
npx supabase@2.122.0 link --project-ref 你的测试项目引用
npx supabase@2.122.0 db push --dry-run
npx supabase@2.122.0 db push
```

以下部署命令按顺序在项目根目录执行。服务端配置必须已准备，函数内部鉴权不能移除。

```powershell
npx supabase@2.122.0 functions deploy ai-chat storage-cleanup send-sms --use-api --no-verify-jwt --import-map supabase/functions/deno.json
npx supabase@2.122.0 secrets set --env-file supabase/.env.local
npx supabase@2.122.0 secrets set --env-file supabase/.env.sms.local
```

三个函数的 import_map 显式配置。网关 verify_jwt=false 配合应用内验证：ai-chat、storage-cleanup 调用 Auth.getUser；send-sms 验证 Hook 原始正文签名。这不是允许匿名业务访问。部署后核对函数状态、真实无登录拒绝和授权读写，不只看命令返回。

Auth 中开启邮箱和手机号验证，Site URL 指向实际前端，回跳允许 /auth 和 /profile。两个 Storage bucket 都保持私有，限制 JPG、PNG、WebP 和 5 MiB；不得通过关闭 RLS 或改公开 bucket 解决权限错误。

## 配置和核验短信

项目使用阿里云号码认证 PNVS 的 SendSmsVerifyCode，不能把普通 SMS 的模板或测试包当作相同产品。Supabase 生成和验证 OTP，Hook 将同一验证码交给 PNVS 发送。模板验证码变量通常是 code，额外参数 min=5；当前服务有效期 300 秒，发送间隔 60 秒。

在本机已忽略的 supabase/.env.sms.local 填写 RAM 凭据、签名、数字模板及变量名；SEND_SMS_HOOK_SECRET 由维护者安全生成并部署。配置 Hook 时检查 URL 指向目标 send-sms，并将同一签名密钥安全注入 CLI 进程。不要在命令参数或终端历史暴露密钥。

项目固定使用 CLI 2.122.0 的已验证映射：auth.sms.enable_confirmations=false 才得到云端 phone_autoconfirm=false。字段名称容易误导，升级 CLI 后必须重新核实实际结果，不直接反转。

```powershell
npm.cmd run check:auth
```

此命令只读设置，不发送验证码。真实收件和双向绑定需用本人号码、邮箱另行验收；供应商受理成功不等于手机实际收到。短信事件按 webhook-id 去重，pending 或结果未知不会自动重发同一事件，应先核对投递及状态。

## 发布和回退前端

在项目根目录安装锁定依赖并检查，公开连接配置正确后构建和打包。

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd run format:check
npm.cmd run package:pages
```

ZIP 位于本机忽略的 artifacts/pages，根目录应直接包含 index.html，不能再包一层 dist。只上传构建静态文件，不上传项目根目录、环境文件、账号文档或 Word 原始资料。打包脚本检查类型、大小、路径和摘要，但仍需核对你选择的是本次成功构建的包。

在 Cloudflare Workers & Pages 打开已有 pet-nest-mobile，创建新的 Production 部署，上传核对过的 ZIP 并发布；不要为每次更新新建项目。Git push 不会自动发布此 Direct Upload 项目。网址未变时通常不需反复调整 Supabase 白名单。

```powershell
npm.cmd run test:pages
npm.cmd run check:auth
```

线上检查将入口和全部 JS/CSS 与本地 dist 比较，并核对安全头、CORS 与未登录拒绝。部署后另用测试账号读取原有数据，查看设置页版本。若需要回退，选择既有历史成功部署并重新验收；前端回退不回滚数据库，不为回退删除迁移或云端数据。

## 人工审核的入口

当前没有应用内管理员审核后台。拥有项目管理权限的审核员进入 Supabase 控制台的 SQL Editor。通过 public.community_reports 查看 open 举报，并核对目标正文与上下文；举报理由不直接等于违规事实。

| 状态                       | 含义                                             |
| -------------------------- | ------------------------------------------------ |
| 动态 draft 或 pending      | 草稿或历史待作者重新检查，不能批量公开           |
| 动态 published 或 rejected | 已发布或人工下架；下架不代表已有签名链接立即失效 |
| 举报 open                  | 待处理                                           |
| 举报 dismissed             | 复核认为不成立，保留内容                         |
| 举报 resolved              | 对应举报已处理                                   |

普通客户端无权改审核状态、编辑词库或调用 community_review。该 RPC 只处理动态，不处理评论。正文和标签经过词库自动检查，图片没有语义或 OCR 审核，人工复核仍需检查画面与上下文。

## 按评论编号查询和处理

下面统一使用全零 UUID 作为占位，必须把每段中的目标替换成已核对的真实 comment_id；占位值不代表存在的评论。comment_id 对应 community_comments.id，不是举报行自身的 id。先只运行查询，再选择一个处理分支，不能整章一次性执行。

### 查询与保存证据

```sql
select c.id, c.post_id, c.body, c.parent_id,
       c.created_at, p.nickname as author_nickname,
       (select count(*) from public.community_comments r
        where r.parent_id = c.id) as reply_count
from public.community_comments c
left join public.community_profiles p on p.user_id = c.user_id
where c.id = '00000000-0000-0000-0000-000000000000'::uuid;

select id as report_id, comment_id, reason, status, created_at
from public.community_reports
where comment_id = '00000000-0000-0000-0000-000000000000'::uuid
order by created_at desc;
```

没有返回评论时先检查项目、ID 或是否已删除，停止写操作。使用 post_id 在动态详情核对上下文；准备删除时，先保存目标、回复和关联举报的必要证据。

```sql
select * from public.community_comments
where parent_id = '00000000-0000-0000-0000-000000000000'::uuid;

select * from public.community_reports
where comment_id in (
  select id from public.community_comments
  where id = '00000000-0000-0000-0000-000000000000'::uuid
     or parent_id = '00000000-0000-0000-0000-000000000000'::uuid
);
```

### 复核正常时保留评论

以下只驳回目标当前 open 举报，保留评论与回复；只处理某一举报时，再加该举报 id 条件。

```sql
update public.community_reports
set status = 'dismissed'
where comment_id = '00000000-0000-0000-0000-000000000000'::uuid
  and status = 'open'
returning id, comment_id, status;
```

核对返回 ID 与状态，再重跑查询确认评论仍在。零行返回只说明没有匹配的 open 举报，不能宣布已处理目标。

### 确认违规后删除评论

当前评论下架是永久删除，没有隐藏或应用内恢复入口。删除父评论会级联删除回复及这些评论关联的举报。审核员必须先保存证据、确认影响范围，再单独执行。不要把 comment_id 交给仅处理动态的 community_review。

下列命令还用已查到的正文限定目标。替换正文占位，正文中的单引号写成两个单引号；目标或正文变化应重新核对，不能移除 where 来扩大范围。

```sql
delete from public.community_comments
where id = '00000000-0000-0000-0000-000000000000'::uuid
  and body = '此处替换为已核对的完整原正文'
returning id, body;
```

成功应返回已核对评论，零行时停止并重新查。之后验证目标评论和关联举报均为零，并刷新对应动态详情；回复和证据也应按前述保存清单核查。

```sql
select
  (select count(*) from public.community_comments
   where id = '00000000-0000-0000-0000-000000000000'::uuid)
    as remaining_comment,
  (select count(*) from public.community_reports
   where comment_id = '00000000-0000-0000-0000-000000000000'::uuid)
    as remaining_reports;
```

举报已级联删除后不能再更新为 resolved。当前没有独立管理员操作审计表，审核员另记处理时间、项目、目标 ID、原因、返回结果和证据保存位置；这些私人证据不上传公开仓库。

## 动态复核与词库维护

核对动态后，管理员可选择批准或下架之一执行。占位 UUID 必须替换为真实动态 ID。

```sql
select public.community_review(
  '00000000-0000-0000-0000-000000000000'::uuid,
  true, '已核对的复核结论');
```

下架分支使用 false。完成后检查动态状态与相关举报。此操作针对动态，与上一节的永久删除评论不同；已发出的图片签名 URL 可能继续有效最多五分钟。

```sql
select public.community_review(
  '00000000-0000-0000-0000-000000000000'::uuid,
  false, '已核对的下架原因');
```

词库位于 community_private.blocked_words，只向受控管理员开放。新增词条先明确业务依据；系统归一化后长度须为 2 至 80，避免空规则匹配全部内容。

```sql
insert into community_private.blocked_words(word)
values ('需要拦截的具体短语') on conflict do nothing;
```

调整词库作用于之后的提交和发布检查，不自动重扫或批量修改已发布内容。现有基础词库有限，可能误拦截或漏判；管理员根据实际举报核查，不能向普通用户开放关闭审核的开关。

## 故障核查与维护记录

| 现象              | 核对顺序                                                                         |
| ----------------- | -------------------------------------------------------------------------------- |
| AI 超时或保存失败 | 查看 request_id 状态、函数配置、上游状态及用量；先核对历史，不盲目重复模型请求   |
| 验证码不达或报错  | 核对 Hook 签名、PNVS 产品/模板、发送状态和真实回执；不记录 OTP 或完整请求        |
| 上传或图片不显示  | 核对格式/大小、对象路径归属、私有 bucket 规则与签名续期                          |
| 删除后图片待清理  | 查看本人队列及 storage-cleanup；先删实际对象再清队列，不能直接删 storage.objects |
| 新网页看起来仍旧  | 核对 ZIP、Production 部署和入口资源摘要；确认更新 Pages 而不仅 GitHub            |

用量统计未拿到上游 token 时不能认定无费用。平台余额、套餐与服务可用性由实际控制台核对，本册不承诺永久免费。未关联孤立图片和长期无人登录的队列需计划维护；不未经确认自动清理云端数据。

完整依据见仓库 docs 中的 DEPLOYMENT、CLOUDFLARE-PAGES、SMS-SETUP、MODERATION、SECRET-SAFETY 和 KNOWN-ISSUES。旧阶段日志保留历史日期，本册整理的是当前操作口径，不把文档中的 SQL 写成已执行结果。
