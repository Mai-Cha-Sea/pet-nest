-- User-selected keyword automation. Preserve historical migrations and legacy pending privacy.
begin;
create function community_private.normalize_text(value text) returns text language sql immutable set search_path='' as $$
  select regexp_replace(lower(normalize(coalesce(value,''),NFKC)),'[[:space:][:punct:]​‌‍﻿⁠️]','','g');
$$;
revoke all on function community_private.normalize_text(text) from public,anon,authenticated;
alter table community_private.blocked_words add constraint valid_blocked_word check(length(community_private.normalize_text(word)) between 2 and 80);
insert into community_private.blocked_words(word) values
  ('虐待动物视频'),('贩卖毒品'),('出售毒品'),('代购毒品'),('迷奸药出售'),('迷药出售'),
  ('出售枪支'),('非法售枪'),('出售弹药'),('色情直播'),('招嫖'),('约炮服务'),('博彩代理'),
  ('网赌推广'),('在线赌场'),('包赢赌博'),('刷单返佣'),('刷单返利'),('买卖银行卡'),
  ('银行卡四件套'),('买卖身份证'),('出售身份证'),('出售假发票') on conflict do nothing;
create or replace function community_private.check_text(value text) returns void language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from community_private.blocked_words where position(community_private.normalize_text(word) in community_private.normalize_text(value))>0) then raise exception 'CONTENT_BLOCKED'; end if;
end $$;
create function community_private.validate_tags(p_tags text[]) returns text[] language plpgsql security definer set search_path='' as $$
declare tag text; result text[] := '{}';
begin
  if p_tags is null or cardinality(p_tags)>3 then raise exception 'INVALID_TAGS'; end if;
  foreach tag in array p_tags loop
    tag:=regexp_replace(btrim(tag),'^#+','');
    if tag is null or length(tag) not between 1 and 20 or tag ~ '[[:cntrl:]]' or tag=any(result) then raise exception 'INVALID_TAGS'; end if;
    perform community_private.check_text(tag);
    result:=array_append(result,tag);
  end loop;
  return result;
end $$;
revoke all on function community_private.validate_tags(text[]) from public,anon,authenticated;
alter table public.community_posts add column tags text[] not null default '{}' check(cardinality(tags)<=3 and array_position(tags,null) is null);

-- The four-argument variant has no defaults; old clients keep an unambiguous three-argument RPC.
create function public.community_create_post(p_id uuid,p_body text,p_pet uuid,p_tags text[]) returns uuid language plpgsql security definer set search_path='' as $$
declare existing public.community_posts; label text; tags_value text[];
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if p_id is null or p_body is null or length(trim(p_body)) not between 1 and 1000 then raise exception 'INVALID_POST'; end if;
  if not exists(select 1 from public.community_profiles where user_id=auth.uid()) then raise exception 'COMMUNITY_PROFILE_REQUIRED'; end if;
  perform 1 from public.community_profiles where user_id=auth.uid() for update;
  tags_value:=community_private.validate_tags(p_tags);
  if p_pet is not null then
    select name into label from public.pets where id=p_pet and user_id=auth.uid();
    if not found then raise exception 'PET_NOT_FOUND'; end if;
    perform community_private.check_text(label);
  end if;
  select * into existing from public.community_posts where id=p_id;
  if found then
    if existing.user_id<>auth.uid() or existing.body<>trim(p_body) or existing.pet_label is distinct from label or existing.tags<>tags_value then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return existing.id;
  end if;
  perform community_private.check_text(p_body);
  perform community_private.take_rate('post',20);
  insert into public.community_posts(id,user_id,body,pet_label,tags) values(p_id,auth.uid(),trim(p_body),label,tags_value);
  return p_id;
end $$;
revoke all on function public.community_create_post(uuid,text,uuid,text[]) from public,anon,authenticated;
grant execute on function public.community_create_post(uuid,text,uuid,text[]) to authenticated,service_role;
create or replace function public.community_create_post(p_id uuid,p_body text,p_pet uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
begin return public.community_create_post(p_id,p_body,p_pet,'{}'::text[]); end $$;

create or replace function public.community_publish(p_post uuid,p_images text[]) returns text language plpgsql security definer set search_path='' as $$
declare p public.community_posts; path text;
begin
  select * into p from public.community_posts where id=p_post and user_id=auth.uid() for update;
  if not found then raise exception 'POST_NOT_FOUND'; end if;
  if p_images is null or cardinality(p_images)>9 or cardinality(p_images)<>(select count(distinct x) from unnest(p_images) x) then raise exception 'INVALID_IMAGES'; end if;
  if p.status='published' and p.image_paths=p_images then return p.status; end if;
  if p.status not in ('draft','pending') or (p.status='pending' and p.image_paths<>p_images) then raise exception 'POST_ALREADY_SUBMITTED'; end if;
  foreach path in array p_images loop
    if path is null or path !~ ('^'||auth.uid()::text||'/posts/'||p_post::text||'/[a-f0-9-]+\.(jpg|png|webp)$') or not exists(select 1 from storage.objects where bucket_id='community-media' and name=path) then raise exception 'INVALID_IMAGE_PATH'; end if;
  end loop;
  perform community_private.check_text(p.body);
  perform community_private.validate_tags(p.tags);
  if p.pet_label is not null then perform community_private.check_text(p.pet_label); end if;
  update public.community_posts set image_paths=p_images,status='published',published_at=coalesce(published_at,now()),
    moderation_note=case when cardinality(p_images)>0 then '配文与标签通过词库检查；图片未做语义识别。' else '文字与标签通过词库检查。' end where id=p_post;
  return 'published';
end $$;
-- No bulk update: legacy pending rows remain private until the author resubmits.

create or replace function public.community_feed(p_mode text default 'recommend',p_offset integer default 0,p_author uuid default null,p_post uuid default null) returns setof jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',p.id,'user_id',p.user_id,'body',p.body,'pet_label',p.pet_label,'tags',p.tags,'image_paths',p.image_paths,'status',p.status,'moderation_note',p.moderation_note,'created_at',p.created_at,'nickname',u.nickname,
    'like_count',(select count(*) from public.community_likes l where l.post_id=p.id),'comment_count',(select count(*) from public.community_comments c where c.post_id=p.id),
    'liked',exists(select 1 from public.community_likes l where l.post_id=p.id and l.user_id=auth.uid()),'favorited',exists(select 1 from public.community_favorites f where f.post_id=p.id and f.user_id=auth.uid()))
  from public.community_posts p join public.community_profiles u on u.user_id=p.user_id
  where (p_author is null or p.user_id=p_author) and (p_post is null or p.id=p_post) and
    (p_post is not null or case p_mode when 'mine' then p.user_id=auth.uid() when 'following' then p.status='published' and exists(select 1 from public.community_follows f where f.user_id=auth.uid() and f.target_id=p.user_id) when 'favorites' then p.status='published' and exists(select 1 from public.community_favorites f where f.user_id=auth.uid() and f.post_id=p.id) when 'recommend' then p.status='published' else false end)
  order by case when p_mode='recommend' and p_post is null then extract(epoch from p.published_at)/86400 + least((select count(*) from public.community_likes l where l.post_id=p.id),100)*0.1 + least((select count(*) from public.community_comments c where c.post_id=p.id),100)*0.05 else extract(epoch from p.created_at)/86400 end desc,p.id desc
  limit 20 offset least(greatest(p_offset,0),10000);
$$;
commit;
