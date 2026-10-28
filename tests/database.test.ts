import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
let db: PGlite
const a = '11111111-1111-4111-8111-111111111111',
  b = '22222222-2222-4222-8222-222222222222'
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
describe('P0 migration and actual PostgreSQL RLS (PGlite)', () => {
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
