/**
 * 使用 PGlite 执行全部真实迁移和权限/RPC SQL，再切换角色验证数据隔离。
 * Auth/Storage 平台对象为测试夹具，不是完整 Supabase 服务；并发排队也不等于真实多连接压测。
 */
import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
let db: PGlite
const a = '11111111-1111-4111-8111-111111111111',
  b = '22222222-2222-4222-8222-222222222222'
/**
 * 在同一事务中使用测试选定的数据库角色与 JWT sub，验证实际 RLS。
 * role 仅由本测试的常量传入，不是接受外部参数的通用 SQL 执行接口。
 */
async function as(user: string, sql: string, params: unknown[] = [], role = 'authenticated') {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`)
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [user])
    return tx.query(sql, params)
  })
}
const pet = (user = a) =>
  as(user, "insert into public.pets(name,species) values('团子','cat') returning *")
async function reserve(
  user: string,
  p: string,
  s = crypto.randomUUID(),
  r = crypto.randomUUID(),
  q = '最近吃得怎么样？',
) {
  return as(
    user,
    'select public.reserve_ai_request($1,$2,$3,$4,$5) as result',
    [user, p, s, r, q],
    'service_role',
  )
}
beforeAll(async () => {
  db = new PGlite()
  // Supabase platform tables are fixtures. Business schema below is the UNMODIFIED migration.
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth; create schema storage;
    create function public.rls_auto_enable() returns event_trigger language plpgsql security definer set search_path='' as $$ begin return; end $$;
    create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(regexp_replace(name,'/[^/]*$',''),'/') $$;
    alter table storage.objects enable row level security;
    grant usage on schema public,auth,storage to anon,authenticated,service_role;
    grant select,insert,delete on storage.objects to authenticated;
    grant all on storage.objects,storage.buckets to service_role;`)
  for (const file of readdirSync('supabase/migrations')
    .filter((file) => file.endsWith('.sql'))
    .sort()) {
    await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'))
  }
})
beforeEach(async () => {
  await db.exec('truncate auth.users,storage.objects,public.storage_cleanup cascade')
  await db.query(
    'insert into auth.users(id,raw_user_meta_data) values($1,\'{"nickname":"小林"}\'),($2,\'{}\')',
    [a, b],
  )
})
afterAll(async () => {
  await db?.close()
})

describe('P1 community migration, RPC permissions and privacy', () => {
  const profile = (u = a) => as(u, "select public.community_set_profile('测试作者')")
  it('counts likes across published posts and reflects unlike, takedown and deletion', async () => {
    const first = await post(),
      second = await post()
    await profile(b)
    for (const [user, target] of [
      [a, first],
      [b, first],
      [b, second],
    ])
      await as(user!, "select public.community_interact($1,'like',true)", [target])
    const total = async () =>
      (await as(b, 'select public.community_person($1) as person', [a])).rows[0] as {
        person: { like_received_count: number }
      }
    expect((await total()).person.like_received_count).toBe(3)
    await as(b, "select public.community_interact($1,'like',true)", [second])
    expect((await total()).person.like_received_count).toBe(3)
    await as(b, "select public.community_interact($1,'like',false)", [first])
    expect((await total()).person.like_received_count).toBe(2)
    await as(a, "select public.community_review($1,false,'测试下架')", [second], 'service_role')
    expect((await total()).person.like_received_count).toBe(1)
    await as(a, 'select public.community_delete_post($1)', [first])
    expect((await total()).person.like_received_count).toBe(0)
  })
  it('validates tags on the server, includes them in feeds, and keeps legacy clients compatible', async () => {
    await profile()
    const id = crypto.randomUUID()
    await as(a, "select public.community_create_post($1,'标签测试',null,$2)", [
      id,
      ['猫咪日常', '晒太阳'],
    ])
    await as(a, "select public.community_create_post($1,'标签测试',null,$2)", [
      id,
      ['猫咪日常', '晒太阳'],
    ])
    await expect(
      as(a, "select public.community_create_post($1,'标签测试',null,$2)", [id, ['换标签']]),
    ).rejects.toThrow(/IDEMPOTENCY_CONFLICT/)
    for (const tags of [['a', 'b', 'c', 'd'], ['重复', '重复'], ['x'.repeat(21)], [null]]) {
      await expect(
        as(a, "select public.community_create_post($1,'非法标签',null,$2)", [
          crypto.randomUUID(),
          tags,
        ]),
      ).rejects.toThrow(/INVALID_TAGS/)
    }
    await expect(
      as(a, "select public.community_create_post($1,'正常配文',null,$2)", [
        crypto.randomUUID(),
        ['裸 聊'],
      ]),
    ).rejects.toThrow(/CONTENT_BLOCKED/)
    await as(a, "select public.community_publish($1,'{}')", [id])
    const rows = (await as(b, 'select public.community_feed(p_post:=$1) as item', [id])).rows as {
      item: { tags: string[] }
    }[]
    expect(rows[0]!.item.tags).toEqual(['猫咪日常', '晒太阳'])
    await expect(
      as(
        '',
        "select public.community_create_post($1,'匿名',null,'{}')",
        [crypto.randomUUID()],
        'anon',
      ),
    ).rejects.toThrow(/permission denied/)
  })
  it('normalizes zero-width and fullwidth characters without allowing clients to edit moderation rules', async () => {
    await profile()
    for (const text of ['裸\u200b聊', '裸\ufe0f聊', '出 售，毒药', '刷单返佣']) {
      await expect(
        as(a, 'select public.community_create_post($1,$2)', [crypto.randomUUID(), text]),
      ).rejects.toThrow(/CONTENT_BLOCKED/)
    }
    await db.exec("insert into community_private.blocked_words values('spamword')")
    try {
      await expect(
        as(a, 'select public.community_create_post($1,$2)', [
          crypto.randomUUID(),
          'ｓｐａｍｗｏｒｄ',
        ]),
      ).rejects.toThrow(/CONTENT_BLOCKED/)
    } finally {
      await db.exec("delete from community_private.blocked_words where word='spamword'")
    }
    await expect(
      as(a, "insert into community_private.blocked_words values('安全')"),
    ).rejects.toThrow(/permission denied/)
    await expect(
      db.exec("insert into community_private.blocked_words values('---')"),
    ).rejects.toThrow(/check constraint/)
  })
  it('retains old pending privacy and rejects attempts to republish a moderator-rejected post', async () => {
    const id = await post(a, '旧版待审测试', false)
    await as(
      a,
      "update public.community_posts set status='pending' where id=$1",
      [id],
      'service_role',
    )
    expect(
      (await as(b, 'select * from public.community_posts where id=$1', [id])).rows,
    ).toHaveLength(0)
    await expect(as(b, "select public.community_publish($1,'{}')", [id])).rejects.toThrow(
      /POST_NOT_FOUND/,
    )
    await as(a, "select public.community_publish($1,'{}')", [id])
    expect(
      (await as(b, 'select * from public.community_posts where id=$1', [id])).rows,
    ).toHaveLength(1)
    await as(a, "select public.community_review($1,false,'人工复核下架')", [id], 'service_role')
    await expect(as(a, "select public.community_publish($1,'{}')", [id])).rejects.toThrow(
      /POST_ALREADY_SUBMITTED/,
    )
  })
  async function post(u = a, body = '今天天气不错，和毛孩子晒太阳', publish = true) {
    const id = crypto.randomUUID()
    await profile(u)
    await as(u, 'select public.community_create_post($1,$2)', [id, body])
    if (publish) await as(u, "select public.community_publish($1,'{}')", [id])
    return id
  }
  it('requires explicit community membership and never exposes personal Auth/profile/pet data', async () => {
    const p = await post()
    expect(
      (await as(b, 'select * from public.community_posts where id=$1', [p])).rows,
    ).toHaveLength(1)
    expect((await as(b, 'select * from public.users where id=$1', [a])).rows).toHaveLength(0)
    expect((await as(b, 'select public.community_person($1) as result', [a])).rows[0]).toEqual({
      result: {
        user_id: a,
        nickname: '测试作者',
        following_count: 0,
        follower_count: 0,
        like_received_count: 0,
        is_following: false,
      },
    })
    await expect(as('', 'select * from public.community_posts', [], 'anon')).rejects.toThrow(
      /permission denied/,
    )
    await expect(as('', 'select public.community_feed()', [], 'anon')).rejects.toThrow(
      /permission denied/,
    )
    await expect(
      as(b, "select public.community_create_post($1,'test')", [crypto.randomUUID()]),
    ).rejects.toThrow(/COMMUNITY_PROFILE_REQUIRED/)
  })
  it('blocks direct writes, forged owners and ordinary moderator access', async () => {
    const id = await post()
    for (const sql of [
      "update public.community_posts set status='published'",
      'delete from public.community_posts',
      'insert into public.community_likes(user_id,post_id) values($1,$2)',
    ]) {
      await expect(as(b, sql, sql.includes('$1') ? [a, id] : [])).rejects.toThrow(
        /permission denied/,
      )
    }
    await expect(as(b, 'select public.community_delete_post($1)', [id])).rejects.toThrow(
      /POST_NOT_FOUND/,
    )
    await expect(as(a, "select public.community_review($1,true,'approved')", [id])).rejects.toThrow(
      /permission denied/,
    )
    await expect(as(a, 'select * from community_private.blocked_words')).rejects.toThrow(
      /permission denied/,
    )
  })
  it('keeps drafts private, checks pet ownership, and returns only an explicitly selected pet name', async () => {
    const p = (await pet()).rows[0] as { id: string }
    const id = await post(a, '草稿', false)
    expect((await as(b, 'select * from public.community_posts')).rows).toHaveLength(0)
    await profile(b)
    await expect(
      as(b, "select public.community_create_post($1,'越权',$2)", [crypto.randomUUID(), p.id]),
    ).rejects.toThrow(/PET_NOT_FOUND/)
    const chosen = crypto.randomUUID()
    await as(a, "select public.community_create_post($1,'一起生活',$2)", [chosen, p.id])
    expect(
      (await as(a, 'select pet_label from public.community_posts where id=$1', [chosen])).rows,
    ).toEqual([{ pet_label: '团子' }])
    await expect(as(b, "select public.community_publish($1,'{}')", [id])).rejects.toThrow(
      /POST_NOT_FOUND/,
    )
  })
  it('checks text on the server, including spaced words, nickname and comments', async () => {
    await expect(as(a, "select public.community_set_profile('裸 聊')")).rejects.toThrow(
      /CONTENT_BLOCKED/,
    )
    const id = await post()
    await expect(
      as(a, "select public.community_create_post($1,'出售 毒药')", [crypto.randomUUID()]),
    ).rejects.toThrow(/CONTENT_BLOCKED/)
    await expect(
      as(a, "select public.community_add_comment($1,$2,'赌博推广')", [crypto.randomUUID(), id]),
    ).rejects.toThrow(/CONTENT_BLOCKED/)
    await expect(
      as(a, 'select public.community_add_comment($1,$2,$3)', [
        crypto.randomUUID(),
        id,
        'x'.repeat(501),
      ]),
    ).rejects.toThrow(/INVALID_COMMENT/)
  })
  it('auto-publishes valid image posts after text checks and still permits service-only takedown', async () => {
    const id = await post(a, '图文', false),
      path = `${a}/posts/${id}/${crypto.randomUUID()}.png`
    await as(a, "insert into storage.objects(bucket_id,name) values('community-media',$1)", [path])
    expect(
      (await as(b, "select * from storage.objects where bucket_id='community-media'")).rows,
    ).toHaveLength(0)
    const published = await as(a, 'select public.community_publish($1,$2) as status', [id, [path]])
    expect(published.rows).toEqual([{ status: 'published' }])
    expect(
      (await as(b, 'select * from public.community_posts where id=$1', [id])).rows,
    ).toHaveLength(1)
    expect(
      (await as(b, "select * from storage.objects where bucket_id='community-media'")).rows,
    ).toHaveLength(1)
    await as(a, "select public.community_review($1,true,'人工检查通过')", [id], 'service_role')
    expect(
      (await as(b, 'select * from public.community_posts where id=$1', [id])).rows,
    ).toHaveLength(1)
    expect(
      (await as(b, "select * from storage.objects where bucket_id='community-media'")).rows,
    ).toHaveLength(1)
    await as(a, "select public.community_review($1,false,'图片内容需调整')", [id], 'service_role')
    expect(
      (await as(b, "select * from storage.objects where bucket_id='community-media'")).rows,
    ).toHaveLength(0)
    await expect(
      as(a, "insert into storage.objects(bucket_id,name) values('community-media',$1)", [
        `${a}/posts/${id}/new.png`,
      ]),
    ).rejects.toThrow(/row-level security/)
  })
  it('rejects foreign, duplicate, non-existent or excessive image paths', async () => {
    const id = await post(a, '图片校验', false)
    for (const images of [
      [`${b}/posts/${id}/a.png`],
      [`${a}/posts/${id}/a.png`],
      Array.from({ length: 10 }, () => `${a}/posts/${id}/a.png`),
    ]) {
      await expect(as(a, 'select public.community_publish($1,$2)', [id, images])).rejects.toThrow(
        /INVALID_IMAGE/,
      )
    }
  })
  it('uses set-to-state interactions so duplicate retries cannot double count or cancel likes', async () => {
    const id = await post()
    await profile(b)
    for (let i = 0; i < 3; i++)
      await as(b, "select public.community_interact($1,'like',true)", [id])
    await as(b, "select public.community_interact($1,'favorite',true)", [id])
    await as(b, "select public.community_interact($1,'follow',true)", [a])
    const feed = (await as(b, "select public.community_feed('following') as item")).rows as {
      item: { like_count: number; liked: boolean; favorited: boolean }
    }[]
    expect(feed[0]!.item).toMatchObject({ like_count: 1, liked: true, favorited: true })
    expect((await as(a, 'select * from public.community_favorites')).rows).toHaveLength(0)
    await as(b, "select public.community_interact($1,'like',false)", [id])
    expect((await as(a, 'select * from public.community_likes')).rows).toHaveLength(0)
    await expect(as(b, "select public.community_interact($1,'follow',true)", [b])).rejects.toThrow(
      /SELF_FOLLOW/,
    )
    expect(
      (await as(a, "select public.community_people($1,'followers') as item", [a])).rows,
    ).toHaveLength(1)
  })
  it('checks same-post replies, one nesting level and idempotent comment IDs', async () => {
    const id = await post(),
      other = await post(b),
      comment = crypto.randomUUID(),
      reply = crypto.randomUUID()
    await as(a, "select public.community_add_comment($1,$2,'你好')", [comment, id])
    await as(a, "select public.community_add_comment($1,$2,'你好')", [comment, id])
    await as(b, "select public.community_add_comment($1,$2,'谢谢',$3)", [reply, id, comment])
    await expect(
      as(b, "select public.community_add_comment($1,$2,'跨帖回复',$3)", [
        crypto.randomUUID(),
        other,
        comment,
      ]),
    ).rejects.toThrow(/INVALID_REPLY/)
    await expect(
      as(b, "select public.community_add_comment($1,$2,'二级回复',$3)", [
        crypto.randomUUID(),
        id,
        reply,
      ]),
    ).rejects.toThrow(/INVALID_REPLY/)
    await expect(as(b, 'select public.community_delete_comment($1)', [comment])).rejects.toThrow(
      /COMMENT_NOT_FOUND/,
    )
    await as(a, 'select public.community_delete_comment($1)', [comment])
    expect((await as(b, 'select * from public.community_comments')).rows).toHaveLength(0)
  })
  it('lets administrators look up a reported comment and dismiss reports without deleting content', async () => {
    const id = await post(),
      comment = crypto.randomUUID(),
      reply = crypto.randomUUID()
    await profile(b)
    await as(a, "select public.community_add_comment($1,$2,'待复核正文')", [comment, id])
    await as(b, "select public.community_add_comment($1,$2,'保留的回复',$3)", [reply, id, comment])
    await as(b, "select public.community_report($1,'测试举报',null,$2)", [
      crypto.randomUUID(),
      comment,
    ])
    const lookup = await db.query(
      `select c.id,c.body,p.nickname as author_nickname,
      (select count(*)::integer from public.community_comments r where r.parent_id=c.id) as reply_count
      from public.community_comments c left join public.community_profiles p on p.user_id=c.user_id
      where c.id=$1`,
      [comment],
    )
    expect(lookup.rows).toEqual([
      { id: comment, body: '待复核正文', author_nickname: '测试作者', reply_count: 1 },
    ])
    await expect(
      as(b, "update public.community_reports set status='dismissed' where comment_id=$1", [
        comment,
      ]),
    ).rejects.toThrow(/permission denied/)
    const changed = await db.query(
      "update public.community_reports set status='dismissed' where comment_id=$1 and status='open' returning status",
      [comment],
    )
    expect(changed.rows).toEqual([{ status: 'dismissed' }])
    expect(
      (await db.query('select id from public.community_comments where post_id=$1', [id])).rows,
    ).toHaveLength(2)
    expect(
      (
        await db.query(
          "update public.community_reports set status='dismissed' where comment_id=$1 and status='open' returning id",
          [comment],
        )
      ).rows,
    ).toHaveLength(0)
  })
  it('guards manual comment deletion by ID and body and cascades both replies and their reports', async () => {
    const id = await post(),
      comment = crypto.randomUUID(),
      reply = crypto.randomUUID()
    await profile(b)
    await as(a, "select public.community_add_comment($1,$2,'已复核正文')", [comment, id])
    await as(b, "select public.community_add_comment($1,$2,'关联回复',$3)", [reply, id, comment])
    await as(b, "select public.community_report($1,'父评论举报',null,$2)", [
      crypto.randomUUID(),
      comment,
    ])
    await as(a, "select public.community_report($1,'回复举报',null,$2)", [
      crypto.randomUUID(),
      reply,
    ])
    expect(
      (
        await db.query(
          "delete from public.community_comments where id=$1 and body='过期正文' returning id",
          [comment],
        )
      ).rows,
    ).toHaveLength(0)
    expect((await db.query('select id from public.community_reports')).rows).toHaveLength(2)
    expect(
      (
        await db.query(
          "delete from public.community_comments where id=$1 and body='已复核正文' returning id",
          [comment],
        )
      ).rows,
    ).toEqual([{ id: comment }])
    expect(
      (await db.query('select id from public.community_comments where post_id=$1', [id])).rows,
    ).toHaveLength(0)
    expect((await db.query('select id from public.community_reports')).rows).toHaveLength(0)
    expect(
      (await db.query('select id from public.community_posts where id=$1', [id])).rows,
    ).toHaveLength(1)
  })
  it('stores deduplicated private reports and enforces the daily post limit', async () => {
    const id = await post()
    await profile(b)
    await as(b, "select public.community_report($1,'垃圾内容',$2)", [crypto.randomUUID(), id])
    await as(b, "select public.community_report($1,'重复举报',$2)", [crypto.randomUUID(), id])
    expect((await as(b, 'select * from public.community_reports')).rows).toHaveLength(1)
    expect((await as(a, 'select * from public.community_reports')).rows).toHaveLength(0)
    for (let i = 1; i < 20; i++)
      await as(a, "select public.community_create_post($1,'限额测试')", [crypto.randomUUID()])
    await expect(
      as(a, "select public.community_create_post($1,'第21条')", [crypto.randomUUID()]),
    ).rejects.toThrow(/COMMUNITY_RATE_LIMIT/)
  })
  it('cascades interactions on post deletion and durably queues image cleanup', async () => {
    const id = await post(a, '删除测试', false),
      path = `${a}/posts/${id}/a.png`
    await as(a, "insert into storage.objects(bucket_id,name) values('community-media',$1)", [path])
    await as(a, 'select public.community_publish($1,$2)', [id, [path]])
    await as(a, "select public.community_review($1,true,'')", [id], 'service_role')
    await profile(b)
    await as(b, "select public.community_interact($1,'like',true)", [id])
    await as(a, 'select public.community_delete_post($1)', [id])
    expect((await as(b, 'select * from public.community_likes')).rows).toHaveLength(0)
    expect((await as(a, 'select path from public.community_media_cleanup')).rows).toEqual([
      { path },
    ])
    expect((await as(b, 'select * from public.community_media_cleanup')).rows).toHaveLength(0)
    await as(a, "delete from storage.objects where bucket_id='community-media' and name=$1", [path])
    expect(
      (await as(a, "select * from storage.objects where bucket_id='community-media'")).rows,
    ).toHaveLength(0)
  })
})
describe('P0 migration and actual PostgreSQL RLS (PGlite)', () => {
  it('records a valid registration declaration at server time and prevents owner mutation', async () => {
    const id = crypto.randomUUID()
    const metadata = {
      nickname: '同意测试',
      legal_consent: {
        accepted: true,
        terms_version: '2026-10-29',
        privacy_version: '2026-10-29',
        accepted_at: '2000-01-01',
      },
    }
    await db.query('insert into auth.users(id,raw_user_meta_data) values($1,$2)', [id, metadata])
    const row = (
      await as(
        id,
        'select terms_version,privacy_version,legal_accepted_at from public.users where id=$1',
        [id],
      )
    ).rows[0] as { terms_version: string; privacy_version: string; legal_accepted_at: string }
    expect(row.terms_version).toBe('2026-10-29')
    expect(row.privacy_version).toBe('2026-10-29')
    expect(new Date(row.legal_accepted_at).getUTCFullYear()).toBe(new Date().getUTCFullYear())
    await expect(
      as(id, "update public.users set legal_accepted_at='2000-01-01' where id=$1", [id]),
    ).rejects.toThrow(/permission denied/)
    await db.query("update auth.users set raw_user_meta_data='{}'::jsonb where id=$1", [id])
    expect(
      (await as(id, 'select terms_version from public.users where id=$1', [id])).rows[0],
    ).toEqual({ terms_version: '2026-10-29' })
    expect((await as(b, 'select id from public.users where id=$1', [id])).rows).toHaveLength(0)
  })
  it('never fabricates consent for old accounts, false declarations or wrong document versions', async () => {
    expect(
      (
        await as(
          a,
          'select terms_version,privacy_version,legal_accepted_at from public.users where id=$1',
          [a],
        )
      ).rows[0],
    ).toEqual({ terms_version: null, privacy_version: null, legal_accepted_at: null })
    for (const consent of [
      { accepted: false, terms_version: '2026-10-29', privacy_version: '2026-10-29' },
      { accepted: 'true', terms_version: '2026-10-29', privacy_version: '2026-10-29' },
      { accepted: true, terms_version: 'old', privacy_version: '2026-10-29' },
    ]) {
      const id = crypto.randomUUID()
      await db.query('insert into auth.users(id,raw_user_meta_data) values($1,$2)', [
        id,
        { legal_consent: consent },
      ])
      expect(
        (await as(id, 'select legal_accepted_at from public.users where id=$1', [id])).rows[0],
      ).toEqual({ legal_accepted_at: null })
    }
  })
  it('keeps SMS callback idempotency records private and unique, without storing OTPs or phones', async () => {
    const id = crypto.randomUUID()
    await expect(as(a, 'select * from public.sms_deliveries')).rejects.toThrow(/permission denied/)
    await expect(
      as(a, 'insert into public.sms_deliveries(event_id) values($1)', [id]),
    ).rejects.toThrow(/permission denied/)
    await as(a, 'insert into public.sms_deliveries(event_id) values($1)', [id], 'service_role')
    await expect(
      as(a, 'insert into public.sms_deliveries(event_id) values($1)', [id], 'service_role'),
    ).rejects.toThrow(/duplicate key/)
    const columns = await db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema='public' and table_name='sms_deliveries'",
    )
    expect(columns.rows.map((c) => c.column_name)).not.toContain('otp')
    expect(columns.rows.map((c) => c.column_name)).not.toContain('phone')
  })
  it('keeps automatic-RLS infrastructure functions inaccessible to API roles', async () => {
    const result = await db.query(
      "select has_function_privilege('anon','public.rls_auto_enable()','execute') as anonymous,has_function_privilege('authenticated','public.rls_auto_enable()','execute') as signed_in",
    )
    expect(result.rows).toEqual([{ anonymous: false, signed_in: false }])
  })
  it('creates profile from auth user and isolates profile updates', async () => {
    expect((await as(a, 'select nickname from public.users')).rows).toEqual([{ nickname: '小林' }])
    expect(
      (await as(b, 'update public.users set nickname=$1 where id=$2 returning id', ['被改名', a]))
        .rows,
    ).toEqual([])
    await expect(as(a, 'update public.users set id=$1', [b])).rejects.toThrow(/permission denied/)
    await expect(
      as(a, 'update public.users set avatar_path=$1', [`${a}/profile/../../${b}/profile/a.jpg`]),
    ).rejects.toThrow(/check constraint/)
    await as(a, 'update public.users set nickname=$1,avatar_path=$2 where id=$3', [
      '新昵称',
      `${a}/profile/a.jpg`,
      a,
    ])
    await as(a, 'update public.users set avatar_path=$1 where id=$2', [`${a}/profile/b.jpg`, a])
    expect((await as(a, 'select nickname from public.users')).rows).toEqual([
      { nickname: '新昵称' },
    ])
    expect((await db.query('select path from public.storage_cleanup')).rows).toEqual([
      { path: `${a}/profile/a.jpg` },
    ])
  })
  it('isolates pet reads, updates, deletes and blocks forged owners', async () => {
    const p = (await pet()).rows[0] as { id: string }
    expect((await as(b, 'select * from public.pets')).rows).toHaveLength(0)
    expect(
      (await as(b, 'update public.pets set name=$1 where id=$2 returning id', ['hacked', p.id]))
        .rows,
    ).toHaveLength(0)
    expect(
      (await as(b, 'delete from public.pets where id=$1 returning id', [p.id])).rows,
    ).toHaveLength(0)
    await expect(
      as(b, "insert into public.pets(user_id,name,species) values($1,'伪造','cat')", [a]),
    ).rejects.toThrow(/row-level security/)
    await expect(as(a, 'update public.pets set user_id=$1', [b])).rejects.toThrow(
      /permission denied/,
    )
    await expect(as('', 'select * from public.pets', [], 'anon')).rejects.toThrow(
      /permission denied/,
    )
  })
  it('enforces 10 pets and releases a slot on delete', async () => {
    for (let i = 0; i < 10; i++) await pet()
    await expect(pet()).rejects.toThrow('PET_LIMIT')
    await as(a, 'delete from public.pets where id=(select id from public.pets limit 1)')
    await pet()
    expect((await as(a, 'select * from public.pets')).rows).toHaveLength(10)
    expect((await pet(b)).rows).toHaveLength(1)
  })
  it('rejects invalid and cross-user records; stores all six types', async () => {
    const p = (await pet()).rows[0] as { id: string }
    const insert = (type: string, content: unknown, user = a) =>
      as(
        user,
        'insert into public.records(pet_id,type,content,occurred_at) values($1,$2,$3,now()) returning *',
        [p.id, type, JSON.stringify(content)],
      )
    await expect(insert('weight', { weight: 3 }, b)).rejects.toThrow(/foreign key/)
    for (const [type, c] of Object.entries({
      feeding: { food: '干粮', amount: 45, unit: 'g' },
      weight: { weight: 4.2 },
      deworming: { kind: 'both', note: '' },
      bath: { note: '' },
      medication: { name: '兽医提供', dosage: '用户填写', note: '' },
      incident: { description: '食欲下降' },
    }))
      await insert(type, c)
    expect((await as(a, 'select * from public.records')).rows).toHaveLength(6)
    expect((await as(b, 'select * from public.records')).rows).toHaveLength(0)
    await expect(insert('feeding', {})).rejects.toThrow(/INVALID/)
    await expect(insert('feeding', { food: '干粮', unit: 'g' })).rejects.toThrow(/INVALID/)
    await expect(insert('feeding', { food: '干粮', amount: 3 })).rejects.toThrow(/INVALID/)
    await expect(insert('weight', { weight: -1 })).rejects.toThrow(/INVALID/)
    await expect(insert('medication', { name: 'x', dosage: '' })).rejects.toThrow(/INVALID/)
    await expect(insert('incident', {})).rejects.toThrow(/INVALID/)
  })
  it('enforces image count, path ownership, and storage object policies', async () => {
    const p = (await pet()).rows[0] as { id: string }
    const r = crypto.randomUUID(),
      path = `${a}/pets/${p.id}/records/${r}/${crypto.randomUUID()}.jpg`
    await as(
      a,
      'insert into public.records(id,pet_id,type,content,occurred_at) values($1,$2,\'incident\',\'{"description":"观察"}\',now())',
      [r, p.id],
    )
    await as(a, "insert into storage.objects(bucket_id,name) values('pet-media',$1)", [path])
    await as(a, 'update public.records set image_paths=$1 where id=$2', [[path], r])
    expect((await as(b, 'select * from storage.objects')).rows).toHaveLength(0)
    await expect(
      as(b, "insert into storage.objects(bucket_id,name) values('pet-media',$1)", [path]),
    ).rejects.toThrow(/row-level security/)
    await expect(
      as(a, 'update public.records set image_paths=$1 where id=$2', [[`${b}/foreign.jpg`], r]),
    ).rejects.toThrow(/INVALID_IMAGE/)
    await expect(
      as(a, 'update public.records set image_paths=$1 where id=$2', [Array(10).fill(path), r]),
    ).rejects.toThrow(/check constraint/)
    await expect(
      as(a, "insert into storage.objects(bucket_id,name) values('pet-media',$1)", [
        `${a}/pets/${crypto.randomUUID()}/avatar/${crypto.randomUUID()}.jpg`,
      ]),
    ).rejects.toThrow(/row-level security/)
  })
  it('queues old avatars and cascades pet records/AI without refunding usage', async () => {
    const p = (await pet()).rows[0] as { id: string },
      r = crypto.randomUUID(),
      s = crypto.randomUUID(),
      req = crypto.randomUUID()
    const avatar = `${a}/pets/${p.id}/avatar/a.jpg`,
      image = `${a}/pets/${p.id}/records/${r}/b.jpg`
    await as(a, 'update public.pets set avatar_path=$1 where id=$2', [avatar, p.id])
    await as(
      a,
      'insert into public.records(id,pet_id,type,content,image_paths,occurred_at) values($1,$2,\'incident\',\'{"description":"观察"}\',$3,now())',
      [r, p.id, [image]],
    )
    await reserve(a, p.id, s, req)
    await as(
      a,
      "select public.finish_ai_request($1,'养护参考',null,'test',10,20,30)",
      [req],
      'service_role',
    )
    await as(a, 'delete from public.pets where id=$1', [p.id])
    for (const table of ['records', 'ai_sessions', 'ai_requests', 'ai_conversations'])
      expect((await db.query(`select * from public.${table}`)).rows).toHaveLength(0)
    expect((await db.query('select path from public.storage_cleanup order by path')).rows).toEqual(
      [{ path: avatar }, { path: image }].sort((x, y) => x.path.localeCompare(y.path)),
    )
    expect((await as(a, 'select used from public.ai_daily_usage')).rows).toEqual([{ used: 1 }])
  })
  it('AI RPC is service-only and validates owner before allocating quota', async () => {
    const p = (await pet()).rows[0] as { id: string }
    await expect(
      as(a, 'select public.reserve_ai_request($1,$2,$3,$4,$5)', [
        a,
        p.id,
        crypto.randomUUID(),
        crypto.randomUUID(),
        '问题',
      ]),
    ).rejects.toThrow(/permission denied/)
    await expect(reserve(b, p.id)).rejects.toThrow('PET_NOT_FOUND')
    expect((await db.query('select * from public.ai_daily_usage')).rows).toHaveLength(0)
    await expect(
      as(a, 'insert into public.ai_daily_usage values($1,current_date,0,now())', [a]),
    ).rejects.toThrow(/permission denied/)
  })
  it('idempotent reservation/finish persists a single question and answer', async () => {
    const p = (await pet()).rows[0] as { id: string },
      s = crypto.randomUUID(),
      r = crypto.randomUUID()
    await reserve(a, p.id, s, r)
    const duplicate = await reserve(a, p.id, s, r)
    expect(duplicate.rows[0]).toMatchObject({ result: { duplicate: true, status: 'pending' } })
    await expect(reserve(a, p.id, s, r, '不同问题')).rejects.toThrow('IDEMPOTENCY_CONFLICT')
    await as(
      a,
      "select public.finish_ai_request($1,'回答',null,'deepseek-flash',100,50,800)",
      [r],
      'service_role',
    )
    expect((await reserve(a, p.id, s, r)).rows[0]).toMatchObject({
      result: { duplicate: true, status: 'succeeded', answer: '回答' },
    })
    await expect(
      as(a, "select public.finish_ai_request($1,'重复',null,'test',0,0,1)", [r], 'service_role'),
    ).rejects.toThrow('REQUEST_NOT_PENDING')
    expect((await as(a, 'select * from public.ai_conversations')).rows).toHaveLength(2)
    expect((await as(b, 'select * from public.ai_conversations')).rows).toHaveLength(0)
    expect((await as(a, 'select used from public.ai_daily_usage')).rows).toEqual([{ used: 1 }])
  })
  it('blocks pending sessions; allows continuation after failure without duplicate charge', async () => {
    const p = (await pet()).rows[0] as { id: string },
      s = crypto.randomUUID(),
      r = crypto.randomUUID()
    await reserve(a, p.id, s, r)
    await expect(reserve(a, p.id, s)).rejects.toThrow('SESSION_BUSY')
    await as(
      a,
      "select public.finish_ai_request($1,null,'UPSTREAM_TIMEOUT','test',0,0,100)",
      [r],
      'service_role',
    )
    expect((await reserve(a, p.id, s, r)).rows[0]).toMatchObject({
      result: { duplicate: true, status: 'failed' },
    })
    await reserve(a, p.id, s)
    expect((await as(a, 'select used from public.ai_daily_usage')).rows).toEqual([{ used: 2 }])
  })
  it('handles 25 queued transactions without exceeding daily cap (single engine)', async () => {
    const p = (await pet()).rows[0] as { id: string }
    const result = await Promise.allSettled(Array.from({ length: 25 }, () => reserve(a, p.id)))
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(20)
    expect(result.filter((r) => r.status === 'rejected')).toHaveLength(5)
    expect((await as(a, 'select used from public.ai_daily_usage')).rows).toEqual([{ used: 20 }])
    expect((await as(b, 'select * from public.ai_daily_usage')).rows).toHaveLength(0)
  })
  it('hides conversation history older than 30 days', async () => {
    const p = (await pet()).rows[0] as { id: string },
      r = crypto.randomUUID()
    await reserve(a, p.id, crypto.randomUUID(), r)
    await db.query(
      "update public.ai_conversations set created_at=now()-interval '31 days' where request_id=$1",
      [r],
    )
    expect((await as(a, 'select * from public.ai_conversations')).rows).toHaveLength(0)
    expect((await db.query('select * from public.ai_conversations')).rows).toHaveLength(1)
  })
})
