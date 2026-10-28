-- Additive P1 schema. Private P0 tables and their policies are unchanged.
begin;
create schema if not exists community_private;
revoke all on schema community_private from public,anon,authenticated;
create table community_private.blocked_words(word text primary key);
insert into community_private.blocked_words values ('虐杀动物'),('出售毒药'),('售卖毒药'),('裸聊'),('赌博推广');
create table community_private.daily_usage(
  user_id uuid not null references public.users(id) on delete cascade,
  action text not null, day date not null, used integer not null, primary key(user_id,action,day)
);
create function community_private.check_text(value text) returns void language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from community_private.blocked_words where position(word in regexp_replace(lower(value),'[[:space:][:punct:]​‌‍]','','g'))>0) then raise exception 'CONTENT_BLOCKED'; end if;
end $$;
create function community_private.take_rate(kind text, maximum integer) returns void language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  insert into community_private.daily_usage(user_id,action,day,used) values(auth.uid(),kind,(now() at time zone 'Asia/Shanghai')::date,1)
  on conflict(user_id,action,day) do update set used=community_private.daily_usage.used+1 where community_private.daily_usage.used<maximum returning used into n;
  if n is null then raise exception 'COMMUNITY_RATE_LIMIT'; end if;
end $$;
revoke all on all functions in schema community_private from public,anon,authenticated;

create table public.community_profiles(
  user_id uuid primary key references public.users(id) on delete cascade,
  nickname text not null check(length(trim(nickname)) between 1 and 32),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.community_posts(
  id uuid primary key, user_id uuid not null references public.community_profiles(user_id) on delete cascade,
  body text not null check(length(trim(body)) between 1 and 1000), pet_label text,
  image_paths text[] not null default '{}' check(cardinality(image_paths)<=9),
  status text not null default 'draft' check(status in ('draft','pending','published','rejected')),
  moderation_note text not null default '' check(length(moderation_note)<=500),
  created_at timestamptz not null default now(), published_at timestamptz
);
create index community_feed_order on public.community_posts(published_at desc,id) where status='published';
create index community_posts_author on public.community_posts(user_id,created_at desc);
create table public.community_comments(
  id uuid primary key, post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid not null references public.community_profiles(user_id) on delete cascade,
  body text not null check(length(trim(body)) between 1 and 500),
  parent_id uuid references public.community_comments(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index community_comments_post on public.community_comments(post_id,created_at,id);
create table public.community_likes(
  user_id uuid not null references public.community_profiles(user_id) on delete cascade,
  post_id uuid not null references public.community_posts(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(user_id,post_id)
);
create index community_likes_post on public.community_likes(post_id);
create table public.community_favorites(
  user_id uuid not null references public.community_profiles(user_id) on delete cascade,
  post_id uuid not null references public.community_posts(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(user_id,post_id)
);
create table public.community_follows(
  user_id uuid not null references public.community_profiles(user_id) on delete cascade,
  target_id uuid not null references public.community_profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(), primary key(user_id,target_id), check(user_id<>target_id)
);
create index community_follows_target on public.community_follows(target_id,created_at);
create table public.community_reports(
  id uuid primary key, user_id uuid not null references public.users(id) on delete cascade,
  post_id uuid references public.community_posts(id) on delete cascade,
  comment_id uuid references public.community_comments(id) on delete cascade,
  reason text not null check(length(trim(reason)) between 1 and 200),
  status text not null default 'open' check(status in ('open','resolved','dismissed')),
  created_at timestamptz not null default now(), check(num_nonnulls(post_id,comment_id)=1)
);
create unique index community_report_post_once on public.community_reports(user_id,post_id) where post_id is not null;
create unique index community_report_comment_once on public.community_reports(user_id,comment_id) where comment_id is not null;
create table public.community_media_cleanup(path text primary key,user_id uuid not null,created_at timestamptz not null default now());

-- Public within the signed-in community; personal profiles, pets, and records remain private.
alter table public.community_profiles enable row level security;
alter table public.community_posts enable row level security;
alter table public.community_comments enable row level security;
alter table public.community_likes enable row level security;
alter table public.community_favorites enable row level security;
alter table public.community_follows enable row level security;
alter table public.community_reports enable row level security;
alter table public.community_media_cleanup enable row level security;
create policy community_profiles_read on public.community_profiles for select to authenticated using(true);
create policy community_posts_read on public.community_posts for select to authenticated using(status='published' or user_id=auth.uid());
create policy community_comments_read on public.community_comments for select to authenticated using(exists(select 1 from public.community_posts p where p.id=post_id and p.status='published'));
create policy community_likes_read on public.community_likes for select to authenticated using(exists(select 1 from public.community_posts p where p.id=post_id and p.status='published'));
create policy community_favorites_read on public.community_favorites for select to authenticated using(user_id=auth.uid());
create policy community_follows_read on public.community_follows for select to authenticated using(true);
create policy community_reports_read on public.community_reports for select to authenticated using(user_id=auth.uid());
create policy community_cleanup_read on public.community_media_cleanup for select to authenticated using(user_id=auth.uid());
revoke all on public.community_profiles,public.community_posts,public.community_comments,public.community_likes,public.community_favorites,public.community_follows,public.community_reports,public.community_media_cleanup from public,anon,authenticated;
grant select on public.community_profiles,public.community_posts,public.community_comments,public.community_likes,public.community_favorites,public.community_follows,public.community_reports,public.community_media_cleanup to authenticated;
grant all on public.community_profiles,public.community_posts,public.community_comments,public.community_likes,public.community_favorites,public.community_follows,public.community_reports,public.community_media_cleanup to service_role;

-- RPC writes derive identity from the verified JWT, never from a browser-supplied owner.
create function public.community_set_profile(p_nickname text) returns void language plpgsql security definer set search_path='' as $$
begin
  if p_nickname is null or length(trim(p_nickname)) not between 1 and 32 then raise exception 'INVALID_COMMUNITY_PROFILE'; end if;
  perform community_private.check_text(p_nickname);
  perform community_private.take_rate('profile',20);
  insert into public.community_profiles(user_id,nickname) values(auth.uid(),trim(p_nickname)) on conflict(user_id) do update set nickname=excluded.nickname,updated_at=now();
end $$;
create function public.community_create_post(p_id uuid,p_body text,p_pet uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare existing public.community_posts; label text;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if p_id is null or p_body is null or length(trim(p_body)) not between 1 and 1000 then raise exception 'INVALID_POST'; end if;
  if not exists(select 1 from public.community_profiles where user_id=auth.uid()) then raise exception 'COMMUNITY_PROFILE_REQUIRED'; end if;
  perform 1 from public.community_profiles where user_id=auth.uid() for update;
  if p_pet is not null then
    select name into label from public.pets where id=p_pet and user_id=auth.uid();
    if not found then raise exception 'PET_NOT_FOUND'; end if;
    perform community_private.check_text(label);
  end if;
  select * into existing from public.community_posts where id=p_id;
  if found then
    if existing.user_id<>auth.uid() or existing.body<>trim(p_body) or existing.pet_label is distinct from label then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return existing.id;
  end if;
  perform community_private.check_text(p_body);
  perform community_private.take_rate('post',20);
  insert into public.community_posts(id,user_id,body,pet_label) values(p_id,auth.uid(),trim(p_body),label);
  return p_id;
end $$;
create function public.community_publish(p_post uuid,p_images text[]) returns text language plpgsql security definer set search_path='' as $$
declare p public.community_posts; path text; next_status text;
begin
  select * into p from public.community_posts where id=p_post and user_id=auth.uid() for update;
  if not found then raise exception 'POST_NOT_FOUND'; end if;
  if p_images is null or cardinality(p_images)>9 or cardinality(p_images)<>(select count(distinct x) from unnest(p_images) x) then raise exception 'INVALID_IMAGES'; end if;
  if p.status<>'draft' then
    if p.image_paths=p_images and p.status in ('published','pending') then return p.status; end if;
    raise exception 'POST_ALREADY_SUBMITTED';
  end if;
  foreach path in array p_images loop
    if path is null or path !~ ('^'||auth.uid()::text||'/posts/'||p_post::text||'/[a-f0-9-]+\.(jpg|png|webp)$') or not exists(select 1 from storage.objects where bucket_id='community-media' and name=path) then raise exception 'INVALID_IMAGE_PATH'; end if;
  end loop;
  perform community_private.check_text(p.body);
  next_status:=case when cardinality(p_images)>0 then 'pending' else 'published' end;
  update public.community_posts set image_paths=p_images,status=next_status,published_at=case when next_status='published' then now() else null end where id=p_post;
  return next_status;
end $$;
create function public.community_delete_post(p_post uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  delete from public.community_posts where id=p_post and user_id=auth.uid();
  if not found then raise exception 'POST_NOT_FOUND'; end if;
end $$;
create function community_private.queue_post_images() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.community_media_cleanup(path,user_id) select unnest(old.image_paths),old.user_id on conflict do nothing;
  return null;
end $$;
revoke all on function community_private.queue_post_images() from public,anon,authenticated;
create trigger community_post_cleanup after delete on public.community_posts for each row execute function community_private.queue_post_images();

create function public.community_interact(p_target uuid,p_kind text,p_enabled boolean) returns void language plpgsql security definer set search_path='' as $$
declare was_enabled boolean;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if not exists(select 1 from public.community_profiles where user_id=auth.uid()) then raise exception 'COMMUNITY_PROFILE_REQUIRED'; end if;
  perform 1 from public.community_profiles where user_id=auth.uid() for update;
  if p_enabled is null or p_kind not in ('like','favorite','follow') or p_kind is null then raise exception 'INVALID_INTERACTION'; end if;
  if p_kind='follow' then
    if p_target=auth.uid() then raise exception 'SELF_FOLLOW'; end if;
    if not exists(select 1 from public.community_profiles where user_id=p_target) then raise exception 'AUTHOR_NOT_FOUND'; end if;
    was_enabled:=exists(select 1 from public.community_follows where user_id=auth.uid() and target_id=p_target);
  else
    if not exists(select 1 from public.community_posts where id=p_target and status='published') then raise exception 'POST_NOT_FOUND'; end if;
    if p_kind='like' then was_enabled:=exists(select 1 from public.community_likes where user_id=auth.uid() and post_id=p_target);
    else was_enabled:=exists(select 1 from public.community_favorites where user_id=auth.uid() and post_id=p_target); end if;
  end if;
  if was_enabled=p_enabled then return; end if;
  perform community_private.take_rate('interaction',300);
  if p_kind='follow' then
    if p_enabled then insert into public.community_follows(user_id,target_id) values(auth.uid(),p_target) on conflict do nothing;
    else delete from public.community_follows where user_id=auth.uid() and target_id=p_target; end if;
  elsif p_kind='like' then
    if p_enabled then insert into public.community_likes(user_id,post_id) values(auth.uid(),p_target) on conflict do nothing;
    else delete from public.community_likes where user_id=auth.uid() and post_id=p_target; end if;
  else
    if p_enabled then insert into public.community_favorites(user_id,post_id) values(auth.uid(),p_target) on conflict do nothing;
    else delete from public.community_favorites where user_id=auth.uid() and post_id=p_target; end if;
  end if;
end $$;
create function public.community_add_comment(p_id uuid,p_post uuid,p_body text,p_parent uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.community_comments;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if p_id is null or p_body is null or length(trim(p_body)) not between 1 and 500 then raise exception 'INVALID_COMMENT'; end if;
  if not exists(select 1 from public.community_profiles where user_id=auth.uid()) then raise exception 'COMMUNITY_PROFILE_REQUIRED'; end if;
  perform 1 from public.community_profiles where user_id=auth.uid() for update;
  if not exists(select 1 from public.community_posts where id=p_post and status='published') then raise exception 'POST_NOT_FOUND'; end if;
  select * into c from public.community_comments where id=p_id;
  if found then
    if c.user_id<>auth.uid() or c.post_id<>p_post or c.body<>trim(p_body) or c.parent_id is distinct from p_parent then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return c.id;
  end if;
  if p_parent is not null and not exists(select 1 from public.community_comments where id=p_parent and post_id=p_post and parent_id is null) then raise exception 'INVALID_REPLY'; end if;
  perform community_private.check_text(p_body);
  perform community_private.take_rate('comment',100);
  insert into public.community_comments(id,post_id,user_id,body,parent_id) values(p_id,p_post,auth.uid(),trim(p_body),p_parent);
  return p_id;
end $$;
create function public.community_delete_comment(p_comment uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  delete from public.community_comments where id=p_comment and user_id=auth.uid();
  if not found then raise exception 'COMMENT_NOT_FOUND'; end if;
end $$;
create function public.community_report(p_id uuid,p_reason text,p_post uuid default null,p_comment uuid default null) returns void language plpgsql security definer set search_path='' as $$
begin
  if p_reason is null or length(trim(p_reason)) not between 1 and 200 or num_nonnulls(p_post,p_comment)<>1 then raise exception 'INVALID_REPORT'; end if;
  if p_post is not null and not exists(select 1 from public.community_posts where id=p_post and status='published') then raise exception 'POST_NOT_FOUND'; end if;
  if p_comment is not null and not exists(select 1 from public.community_comments c join public.community_posts p on p.id=c.post_id where c.id=p_comment and p.status='published') then raise exception 'COMMENT_NOT_FOUND'; end if;
  if exists(select 1 from public.community_reports where user_id=auth.uid() and (post_id=p_post or comment_id=p_comment)) then return; end if;
  perform community_private.take_rate('report',20);
  insert into public.community_reports(id,user_id,reason,post_id,comment_id) values(p_id,auth.uid(),trim(p_reason),p_post,p_comment) on conflict do nothing;
end $$;

-- Invoker reads retain RLS; no join to private users/pets/records or Auth identifiers.
create function public.community_feed(p_mode text default 'recommend',p_offset integer default 0,p_author uuid default null,p_post uuid default null) returns setof jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',p.id,'user_id',p.user_id,'body',p.body,'pet_label',p.pet_label,'image_paths',p.image_paths,'status',p.status,'moderation_note',p.moderation_note,'created_at',p.created_at,'nickname',u.nickname,
    'like_count',(select count(*) from public.community_likes l where l.post_id=p.id),'comment_count',(select count(*) from public.community_comments c where c.post_id=p.id),
    'liked',exists(select 1 from public.community_likes l where l.post_id=p.id and l.user_id=auth.uid()),'favorited',exists(select 1 from public.community_favorites f where f.post_id=p.id and f.user_id=auth.uid()))
  from public.community_posts p join public.community_profiles u on u.user_id=p.user_id
  where (p_author is null or p.user_id=p_author) and (p_post is null or p.id=p_post) and
    (p_post is not null or case p_mode when 'mine' then p.user_id=auth.uid() when 'following' then p.status='published' and exists(select 1 from public.community_follows f where f.user_id=auth.uid() and f.target_id=p.user_id) when 'favorites' then p.status='published' and exists(select 1 from public.community_favorites f where f.user_id=auth.uid() and f.post_id=p.id) when 'recommend' then p.status='published' else false end)
  order by case when p_mode='recommend' and p_post is null then extract(epoch from p.published_at)/86400 + least((select count(*) from public.community_likes l where l.post_id=p.id),100)*0.1 + least((select count(*) from public.community_comments c where c.post_id=p.id),100)*0.05 else extract(epoch from p.created_at)/86400 end desc,p.id desc
  limit 20 offset least(greatest(p_offset,0),10000);
$$;
create function public.community_person(p_user uuid) returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('user_id',p.user_id,'nickname',p.nickname,
    'following_count',(select count(*) from public.community_follows f where f.user_id=p.user_id),
    'follower_count',(select count(*) from public.community_follows f where f.target_id=p.user_id),
    'is_following',exists(select 1 from public.community_follows f where f.user_id=auth.uid() and f.target_id=p.user_id)) from public.community_profiles p where p.user_id=p_user;
$$;
create function public.community_people(p_user uuid,p_list text,p_offset integer default 0) returns setof jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('user_id',p.user_id,'nickname',p.nickname) from public.community_follows f join public.community_profiles p on p.user_id=case when p_list='followers' then f.user_id else f.target_id end
  where p_list in ('followers','following') and case when p_list='followers' then f.target_id=p_user else f.user_id=p_user end
  order by f.created_at desc,p.user_id limit 20 offset least(greatest(p_offset,0),10000);
$$;

-- Human image review and report resolution are service-only. No admin key enters the UI.
create function public.community_review(p_post uuid,p_approve boolean,p_note text default '') returns void language plpgsql security definer set search_path='' as $$
begin
  if p_approve is null or p_note is null or length(p_note)>500 then raise exception 'INVALID_REVIEW'; end if;
  update public.community_posts set status=case when p_approve then 'published' else 'rejected' end,moderation_note=p_note,published_at=case when p_approve then coalesce(published_at,now()) else published_at end where id=p_post and status in ('pending','published','rejected');
  if not found then raise exception 'POST_NOT_FOUND'; end if;
  update public.community_reports set status='resolved' where post_id=p_post and status='open';
end $$;

-- Explicitly revoke defaults, including Supabase's automatic function grants.
do $$ declare f record; begin
  for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'community_%' loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
    if f.proname<>'community_review' then execute format('grant execute on function %s to authenticated',f.signature); end if;
  end loop;
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('community-media','community-media',false,5242880,array['image/jpeg','image/png','image/webp']);
create policy community_media_read on storage.objects for select to authenticated using(bucket_id='community-media' and ((storage.foldername(name))[1]=auth.uid()::text or exists(select 1 from public.community_posts p where p.status='published' and storage.objects.name=any(p.image_paths))));
create policy community_media_insert on storage.objects for insert to authenticated with check(bucket_id='community-media' and exists(select 1 from public.community_posts p where p.user_id=auth.uid() and p.status='draft' and storage.objects.name ~ ('^'||auth.uid()::text||'/posts/'||p.id::text||'/[a-f0-9-]+\.(jpg|png|webp)$')));
create policy community_media_delete on storage.objects for delete to authenticated using(bucket_id='community-media' and (storage.foldername(name))[1]=auth.uid()::text and not exists(select 1 from public.community_posts p where storage.objects.name=any(p.image_paths)));
commit;
