begin;

-- A server-time snapshot of the declaration submitted by the new registration UI.
-- Existing/legacy accounts remain NULL; never invent prior consent or trust it for authorization.
alter table public.users
  add column terms_version text,
  add column privacy_version text,
  add column legal_accepted_at timestamptz,
  add constraint users_legal_consent_complete check (
    (terms_version is null and privacy_version is null and legal_accepted_at is null)
    or (terms_version is not null and privacy_version is not null and legal_accepted_at is not null)
  );

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  consent jsonb := new.raw_user_meta_data->'legal_consent';
  accepted boolean := coalesce(
    consent->'accepted'='true'::jsonb
    and consent->>'terms_version'='2026-10-29'
    and consent->>'privacy_version'='2026-10-29', false);
begin
  insert into public.users(id,nickname,terms_version,privacy_version,legal_accepted_at)
  values(
    new.id,
    coalesce(nullif(left(trim(new.raw_user_meta_data->>'nickname'),64),''),'新朋友'),
    case when accepted then consent->>'terms_version' end,
    case when accepted then consent->>'privacy_version' end,
    case when accepted then now() end
  );
  return new;
end $$;
revoke all on function public.handle_new_user() from public,anon,authenticated;
grant execute on function public.handle_new_user() to service_role;
-- The original column-level UPDATE grant covers only nickname/bio/avatar_path.
-- Adding fields does not grant clients permission to forge or change the snapshot.

create or replace function public.community_person(p_user uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'user_id',p.user_id,'nickname',p.nickname,
    'following_count',(select count(*) from public.community_follows f where f.user_id=p.user_id),
    'follower_count',(select count(*) from public.community_follows f where f.target_id=p.user_id),
    'like_received_count',(select count(*) from public.community_likes l
      join public.community_posts post on post.id=l.post_id
      where post.user_id=p.user_id and post.status='published'),
    'is_following',exists(select 1 from public.community_follows f where f.user_id=auth.uid() and f.target_id=p.user_id)
  ) from public.community_profiles p where p.user_id=p_user;
$$;
revoke all on function public.community_person(uuid) from public,anon;
grant execute on function public.community_person(uuid) to authenticated,service_role;

commit;
