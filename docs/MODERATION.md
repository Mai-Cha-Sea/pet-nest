# 内容审核方案与操作说明

核查日期：2026-10-28。用户在看到免费方案后明确选择“本阶段仅用敏感词自动审核”，因此本次没有开通外部服务、创建其密钥、发送用户内容到审核供应商或产生审核 API 费用。

## 免费 API 调研结果

| 服务                                     | 官方确认的免费范围                                                          | 接入条件与结论                                                                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Azure AI Content Safety F0               | 每月 5000 条文本记录、5000 张图片；免费档达到额度即停止使用，不产生超额费用 | 支持中文的文本和图片检测，需要 Azure 订阅及 F0 资源；确实存在可持续免费额度。本阶段用户决定不接入，不能写成“没有免费 API”。               |
| 腾讯云图片内容安全                       | 新用户 3000 张图片，资源包有效期 15 天                                      | 属于限期试用，过期/超量可能进入计费，不作为永久免费依赖。                                                                                 |
| 阿里云内容安全 1.0                       | 首次调用后 31 天内每日 3000 张图片或条文本的试用额度                        | 1.0 需企业认证，超量和试用结束均收费；增强版需单独开通按量计费。现有短信 AccessKey 不代表已经开通此服务，本次没有复用短信凭据去请求审核。 |
| Cloudflare Workers AI + Llama Guard 3 8B | Workers Free 每日 10000 Neurons，超额失败；Llama Guard 为文本内容分类模型   | 免费额度按模型消耗计量，不能等同于固定图片审核次数；本次不增加模型审核或凭据。                                                            |

来源：[Azure 价格及免费档限制](https://azure.microsoft.com/en-us/pricing/details/content-safety/)、[Azure 支持语言与媒体](https://learn.microsoft.com/en-us/azure/ai-services/content-safety/overview)、[腾讯云免费试用说明](https://cloud.tencent.com/document/faq/1125/62796)、[阿里云 1.0 开通/试用](https://help.aliyun.com/zh/document_detail/69806.html)、[阿里云增强版计费](https://help.aliyun.com/zh/document_detail/477720.html)、[Cloudflare 免费额度](https://developers.cloudflare.com/workers-ai/platform/pricing/)、[Llama Guard 模型说明](https://developers.cloudflare.com/workers-ai/models/llama-guard-3-8b/)。开通前应重新核对控制台资格和价格，未进行任何真实审核 API 调用测试。

## Azure 开户核查与最终决定（2026-10-28）

用户曾提出改用 Azure，随后说明没有可用于开户的信用卡。经官方资料核实：普通 Azure 免费账户需要手机号、Microsoft/GitHub 账号及信用卡或非预付费借记卡，具体卡种与地区有关；Azure for Students 免信用卡，但要求符合年龄/全日制学籍条件，并通过学校邮箱验证。分别见[普通账户开户要求](https://azure.microsoft.com/en-us/pricing/purchase-options/azure-account)、[学生账户](https://azure.microsoft.com/en-us/free/students)、[学生资格条款](https://azure.microsoft.com/en-us/pricing/offers/ms-azr-0170p)。因此不能笼统写成“所有 Azure 账户必须有信用卡”。

用户了解上述区别后，明确选择“放弃 Azure，保留词库审核”。本次只准备过服务端占位配置，未创建 Azure 账户/资源、取得或部署其 Key，也未发送审核请求。未填写的临时配置已清理，Azure 切换未部署，现有词库自动审核、举报复审、数据和发布行为保持原样。

## 当前发布行为

新文字和图文动态都通过数据库自动检查后发布：昵称、配文、可选宠物名称与最多 3 个标签执行敏感词检查；评论继续执行相同规则。检查发生在服务端，直接调用 RPC 也不能绕过。发布时再次检查配文、标签及宠物名称，避免草稿保存后规则发生变化而跳过新规则。

图文发布仍检查真实对象是否存在、目录归属、最多 9 张、类型及 5 MiB 上限。**这些是文件与权限校验，不是图片语义审核；不会 OCR 图片文字或识别画面。** 页面明确说明这一范围。通过文本检查不代表图片内容已被机器判断安全。

原来已存在的 pending 动态不批量公开。作者可在自己的详情页点击“重新提交自动审核”，使用相同的已关联图片路径重新检查并发布；其他账号不能操作。管理员已下架的 rejected 动态不能用该入口直接重新发布。

普通用户仍无权写审核状态、编辑词库或调用管理员复核 RPC。举报和人工复审保留：通过 `community_reports` 查看 open 举报，核实后使用 `community_review` 下架违规动态；动态审核流程见 [P1 指南](P1.md#自动检查与举报复审)，评论操作见下节。已有签名图片链接可能继续有效最多 5 分钟，下架不等于撤销旧链接。

## 人工审核：按 comment_id 查找、复核或下架评论

当前没有应用内的管理员审核页面。管理员使用拥有该项目管理权限的 Supabase 账号，打开 [pet-nest-dev 控制台](https://supabase.com/dashboard/project/httzsurpqbbqwazrunsu)，进入 **SQL Editor → New query**。应用中的 Test_01 或普通测试账号不具备项目管理权限；不要把管理密钥放到前端。

举报表 `public.community_reports.comment_id` 对应评论表 `public.community_comments.id`，不是举报记录自身的 `id`。以下用 `635b3e9c-5c2f-49ce-8db4-63ab8fb5595a` 演示；处理其他评论时，替换每条 SQL 中的评论 ID。**先查询，再选择一个处理分支，单独运行对应 SQL，不要一次运行本节全部代码。** 本节是操作说明，写入文档不代表已修改或删除该评论。

### 1. 查询评论、作者、回复数量和关联举报

先运行以下只读查询：

```sql
select c.id, c.post_id, c.body, c.parent_id, c.created_at,
       p.nickname as author_nickname,
       (select count(*) from public.community_comments reply
        where reply.parent_id = c.id) as reply_count
from public.community_comments c
left join public.community_profiles p on p.user_id = c.user_id
where c.id = '635b3e9c-5c2f-49ce-8db4-63ab8fb5595a'::uuid;

select id as report_id, comment_id, reason, status, created_at
from public.community_reports
where comment_id = '635b3e9c-5c2f-49ce-8db4-63ab8fb5595a'::uuid
order by created_at desc;
```

`body` 是评论正文，`parent_id` 非空表示该评论是回复；`post_id` 可用于在应用的 `/community/posts/<post_id>` 详情页核对上下文。举报状态 `open` 表示待处理，`dismissed` 表示举报不成立，`resolved` 表示已处理。不能仅凭举报理由就认定评论违规。

查询没有返回评论时，先检查 ID、所在项目或评论是否已被删除，停止执行写操作。若准备删除，先保存查询结果；有回复时，还需查询并保存回复及其举报，避免级联删除后丢失复核依据：

```sql
select * from public.community_comments
where parent_id = '635b3e9c-5c2f-49ce-8db4-63ab8fb5595a'::uuid;

select * from public.community_reports
where comment_id in (
  select id from public.community_comments
  where id = '635b3e9c-5c2f-49ce-8db4-63ab8fb5595a'::uuid
     or parent_id = '635b3e9c-5c2f-49ce-8db4-63ab8fb5595a'::uuid
);
```

### 2A. 复核正常：保留评论，驳回举报

确认评论正常后，运行下面的 SQL，将该评论当前所有未处理举报改为 `dismissed`，评论及回复保留。若只处理一条举报，再在 `where` 中添加其 `id = '实际举报UUID'::uuid` 条件。

```sql
update public.community_reports
set status = 'dismissed'
where comment_id = '635b3e9c-5c2f-49ce-8db4-63ab8fb5595a'::uuid
  and status = 'open'
returning id, comment_id, status;
```

检查返回的举报 ID 和状态，再运行第 1 步查询，确认评论仍在、对应举报已处理。返回 0 行说明没有匹配的 open 举报，应重新核查，不能据此宣称完成处理。

### 2B. 确认违规：删除评论

**当前评论下架采用永久删除，没有隐藏状态或应用内恢复入口。删除父评论还会级联删除它的回复，以及这些评论关联的举报记录。** 保存必要证据并确认影响范围后，再单独执行。`community_review` 只审核动态，不能传入评论 ID；`community_delete_comment` 只允许登录用户删除本人评论，不用于管理员处理其他人的评论。

下面示例使用评论 ID 和此前查到的正文 `11` 双重限定；**执行前必须以第 1 步的最新结果核对正文，处理其他内容时同步替换，正文中的单引号写成两个单引号。**

```sql
delete from public.community_comments
where id = '635b3e9c-5c2f-49ce-8db4-63ab8fb5595a'::uuid
  and body = '11'
returning id, body;
```

成功时返回被删除的目标评论；返回 0 行时应停止并重新查询，不要通过移除 `where` 条件扩大删除范围。随后验证目标评论和关联举报均已不存在：

```sql
select
  (select count(*) from public.community_comments
   where id = '635b3e9c-5c2f-49ce-8db4-63ab8fb5595a'::uuid)
    as remaining_comment,
  (select count(*) from public.community_reports
   where comment_id = '635b3e9c-5c2f-49ce-8db4-63ab8fb5595a'::uuid)
    as remaining_reports;
```

两项应均为 0，再刷新对应动态详情页确认评论不再显示。由于举报也被级联删除，不能再把这些举报更新为 `resolved`；当前数据库没有独立的管理员操作审计表，审核人需另外记录处理时间、目标 ID、结论、原因及保存的证据。

## 词库维护与边界

词库在受限 `community_private.blocked_words`。初始 5 条规则扩为 28 条高风险短语；新增迁移保留原词条，未引入来源或授权不明的外部词库。匹配前统一 Unicode NFKC、小写、空格、标点及部分零宽字符；新增词条必须归一化后长度为 2–80，防止空规则匹配全部内容。

管理员在开发项目 SQL Editor 维护（示意词需替换为实际业务规则）：

```sql
insert into community_private.blocked_words(word)
values ('需要拦截的具体短语') on conflict do nothing;
```

规则修改即时作用于后续提交和发布检查。误拦截需管理员核查后调整对应词条，不提供普通用户绕过开关。该基础库不能理解上下文，也不能穷尽同音字、变体或图像风险；若进入正式运营，应根据举报样本持续维护，并重新评估专业审核服务。不会自动扫描或批量修改既有公开动态。

## 文档一致性

原始 V3.0 的 5.4 节规定敏感词检查及可选第三方审核，并要求举报和人工复审；本方案保留这些流程。补齐动态最多 3 个标签的发布、显示和服务端验证，每个标签最多 20 字。标签作为动态元数据展示，不实现 P2 的话题聚合或搜索。

数据库变更使用 `20261028151228_keyword_moderation_tags.sql`，不修改已执行的历史迁移。保留旧三参数创建 RPC，新增无默认参数的四参数版本用于标签，避免破坏旧客户端。原私有档案、记录、图片隔离及 AI 接口保持原有权限。
