-- P0 schema. Auth stores passwords; all business IDs refer to auth.users UUIDs.
begin;
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null default '新朋友' check (char_length(trim(nickname)) between 1 and 64),
  bio text not null default '' check (char_length(bio) <= 128), avatar_path text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (avatar_path is null or avatar_path ~ ('^' || id::text || '/profile/[a-f0-9-]+\.(jpg|png|webp)$'))
);
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.users(id,nickname) values(new.id, coalesce(nullif(left(trim(new.raw_user_meta_data->>'nickname'),64),''),'新朋友'));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
insert into public.users(id) select id from auth.users on conflict do nothing;

create table public.pets (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 32),
  species text not null check (species in ('cat','dog','other')), breed text not null default '' check (length(breed)<=64),
  gender text not null default 'unknown' check (gender in ('unknown','male','female')),
  date_kind text not null default 'birth' check (date_kind in ('birth','adoption')), birth_date date,
  weight numeric(7,3) check (weight>0 and weight<=1000), sterilized boolean not null default false,
  avatar_path text, remark text not null default '' check (length(remark)<=1000),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,user_id),
  check (birth_date is null or birth_date <= (now() at time zone 'Asia/Shanghai')::date),
  check (avatar_path is null or avatar_path ~ ('^' || user_id::text || '/pets/' || id::text || '/avatar/[a-f0-9-]+\.(jpg|png|webp)$'))
);
create index pets_owner_created on public.pets(user_id,created_at desc);
-- Serializes concurrent inserts for the SAME owner, including direct REST writes.
create function public.limit_pets() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.users where id=new.user_id for update;
  -- Let a same-ID retry hit the primary key; it is not an eleventh pet.
  if exists(select 1 from public.pets where id=new.id and user_id=new.user_id) then return new; end if;
  if (select count(*) from public.pets where user_id=new.user_id)>=10 then raise exception 'PET_LIMIT' using errcode='P0001'; end if;
  return new;
end $$;
create trigger enforce_pet_limit before insert on public.pets for each row execute function public.limit_pets();

create table public.records (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(), pet_id uuid not null,
  type text not null check (type in ('feeding','weight','deworming','bath','medication','incident')),
  content jsonb not null, image_paths text[] not null default '{}', occurred_at timestamptz not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (pet_id,user_id) references public.pets(id,user_id) on delete cascade,
  check (cardinality(image_paths)<=9), check (type='incident' or cardinality(image_paths)=0)
);
create index records_pet_time on public.records(pet_id,occurred_at desc,id desc);
create index records_owner on public.records(user_id);
create function public.validate_record() returns trigger language plpgsql set search_path = '' as $$
declare c jsonb := new.content; path text;
begin
  if jsonb_typeof(c)<>'object' or length(c::text)>6000 or new.occurred_at>now()+interval '1 minute' then raise exception 'INVALID_RECORD'; end if;
  if new.type='feeding' then
    if not coalesce(jsonb_typeof(c->'food')='string' and length(trim(c->>'food')) between 1 and 100 and jsonb_typeof(c->'amount')='number' and (c->>'amount')::numeric>0 and (c->>'amount')::numeric<=100000 and c->>'unit' in ('g','ml'),false) then raise exception 'INVALID_FEEDING'; end if;
  elsif new.type='weight' then
    if not coalesce(jsonb_typeof(c->'weight')='number' and (c->>'weight')::numeric>0 and (c->>'weight')::numeric<=1000,false) then raise exception 'INVALID_WEIGHT'; end if;
  elsif new.type='deworming' then
    if not coalesce(c->>'kind' in ('internal','external','both'),false) then raise exception 'INVALID_DEWORMING'; end if;
  elsif new.type='medication' then
    if not coalesce(jsonb_typeof(c->'name')='string' and length(trim(c->>'name')) between 1 and 100 and jsonb_typeof(c->'dosage')='string' and length(trim(c->>'dosage')) between 1 and 100,false) then raise exception 'INVALID_MEDICATION'; end if;
  elsif new.type='incident' then
    if not coalesce(jsonb_typeof(c->'description')='string' and length(trim(c->>'description')) between 1 and 2000,false) then raise exception 'INVALID_INCIDENT'; end if;
  end if;
  if c ? 'note' and (jsonb_typeof(c->'note')<>'string' or length(c->>'note')>500) then raise exception 'INVALID_NOTE'; end if;
  foreach path in array new.image_paths loop
    if path is null or path !~ ('^' || new.user_id::text || '/pets/' || new.pet_id::text || '/records/' || new.id::text || '/[a-f0-9-]+\.(jpg|png|webp)$') then raise exception 'INVALID_IMAGE_PATH'; end if;
  end loop;
  return new;
end $$;
create trigger validate_record_write before insert or update on public.records for each row execute function public.validate_record();

create table public.ai_sessions (
  id uuid primary key, user_id uuid not null, pet_id uuid not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(id,user_id,pet_id), foreign key (pet_id,user_id) references public.pets(id,user_id) on delete cascade
);
create table public.ai_daily_usage (
  user_id uuid not null references public.users(id) on delete cascade, usage_date date not null,
  used integer not null default 0 check (used between 0 and 20), updated_at timestamptz not null default now(), primary key(user_id,usage_date)
);
create table public.ai_requests (
  id uuid primary key, user_id uuid not null, pet_id uuid not null, session_id uuid not null,
  question text not null check (length(trim(question)) between 1 and 2000),
  status text not null default 'pending' check (status in ('pending','succeeded','failed')),
  answer text, error_code text, model text, prompt_tokens integer not null default 0 check(prompt_tokens>=0),
  completion_tokens integer not null default 0 check(completion_tokens>=0), latency_ms integer check(latency_ms>=0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(session_id,user_id,pet_id) references public.ai_sessions(id,user_id,pet_id) on delete cascade
);
create index ai_requests_owner_created on public.ai_requests(user_id,created_at desc);
create unique index ai_one_pending_per_session on public.ai_requests(session_id) where status='pending';
create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(), request_id uuid not null references public.ai_requests(id) on delete cascade,
  user_id uuid not null, pet_id uuid not null, session_id uuid not null,
  role text not null check(role in ('user','assistant')), content text not null check(length(content) between 1 and 12000),
  token_used integer not null default 0 check(token_used>=0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(request_id,role), foreign key(session_id,user_id,pet_id) references public.ai_sessions(id,user_id,pet_id) on delete cascade
);
create index ai_history on public.ai_conversations(user_id,pet_id,session_id,created_at desc);

-- Only Edge service_role may reserve/finish. A transaction reserves quota AND the question.
create function public.reserve_ai_request(p_user uuid,p_pet uuid,p_session uuid,p_request uuid,p_question text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare existing public.ai_requests; n integer; day date := (now() at time zone 'Asia/Shanghai')::date;
begin
  perform 1 from public.users where id=p_user for update;
  if not exists(select 1 from public.pets where id=p_pet and user_id=p_user) then raise exception 'PET_NOT_FOUND'; end if;
  select * into existing from public.ai_requests where id=p_request;
  if found then
    if existing.user_id<>p_user or existing.pet_id<>p_pet or existing.session_id<>p_session or existing.question<>p_question then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('status',existing.status,'answer',existing.answer,'error_code',existing.error_code,'duplicate',true);
  end if;
  -- A crashed invocation cannot lock a session forever. Expired attempts still consume one quota.
  update public.ai_requests set status='failed',error_code='INTERRUPTED',updated_at=now()
    where session_id=p_session and user_id=p_user and status='pending' and created_at<now()-interval '2 minutes';
  if exists(select 1 from public.ai_requests where session_id=p_session and status='pending') then raise exception 'SESSION_BUSY'; end if;
  insert into public.ai_sessions(id,user_id,pet_id) values(p_session,p_user,p_pet) on conflict do nothing;
  if not exists(select 1 from public.ai_sessions where id=p_session and user_id=p_user and pet_id=p_pet) then raise exception 'SESSION_NOT_FOUND'; end if;
  insert into public.ai_daily_usage(user_id,usage_date) values(p_user,day) on conflict do nothing;
  update public.ai_daily_usage set used=used+1,updated_at=now() where user_id=p_user and usage_date=day and used<20 returning used into n;
  if n is null then raise exception 'DAILY_LIMIT'; end if;
  insert into public.ai_requests(id,user_id,pet_id,session_id,question) values(p_request,p_user,p_pet,p_session,p_question);
  insert into public.ai_conversations(request_id,user_id,pet_id,session_id,role,content) values(p_request,p_user,p_pet,p_session,'user',p_question);
  return jsonb_build_object('status','pending','duplicate',false,'used',n);
end $$;
create function public.finish_ai_request(p_request uuid,p_answer text,p_error text,p_model text,p_prompt integer,p_completion integer,p_latency integer) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.ai_requests;
begin
  select * into r from public.ai_requests where id=p_request for update;
  if not found or r.status<>'pending' then raise exception 'REQUEST_NOT_PENDING'; end if;
  update public.ai_requests set status=case when p_error is null then 'succeeded' else 'failed' end,
    answer=p_answer,error_code=p_error,model=p_model,prompt_tokens=p_prompt,completion_tokens=p_completion,latency_ms=p_latency,updated_at=now() where id=p_request;
  if p_error is null then
    insert into public.ai_conversations(request_id,user_id,pet_id,session_id,role,content,token_used)
      values(r.id,r.user_id,r.pet_id,r.session_id,'assistant',p_answer,p_prompt+p_completion);
  end if;
end $$;

-- Object deletion must use Storage API, never DELETE storage.objects directly.
create table public.storage_cleanup (
  path text primary key, user_id uuid not null, created_at timestamptz not null default now()
);
create function public.queue_removed_images() returns trigger language plpgsql security definer set search_path = '' as $$
declare paths text[]; newer text[]; path text; owner uuid;
begin
  -- Use separate statements: PL/pgSQL resolves all OLD fields in one CASE,
  -- and public.users has id rather than user_id.
  if tg_table_name='users' then owner:=old.id; else owner:=old.user_id; end if;
  if tg_table_name='records' then
    paths:=old.image_paths; newer:=case when tg_op='UPDATE' then new.image_paths else '{}'::text[] end;
  else
    paths:=array[old.avatar_path]; newer:=case when tg_op='UPDATE' then array[new.avatar_path] else '{}'::text[] end;
  end if;
  foreach path in array paths loop
    if path is not null and not (path=any(array_remove(newer,null))) then
      insert into public.storage_cleanup(path,user_id) values(path,owner) on conflict do nothing;
    end if;
  end loop;
  return null;
end $$;
create trigger cleanup_user_images after update or delete on public.users for each row execute function public.queue_removed_images();
create trigger cleanup_pet_images after update or delete on public.pets for each row execute function public.queue_removed_images();
create trigger cleanup_record_images after update or delete on public.records for each row execute function public.queue_removed_images();

create function public.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$ begin new.updated_at=now(); return new; end $$;
create trigger touch_users before update on public.users for each row execute function public.touch_updated_at();
create trigger touch_pets before update on public.pets for each row execute function public.touch_updated_at();
create trigger touch_records before update on public.records for each row execute function public.touch_updated_at();

alter table public.users enable row level security;
alter table public.pets enable row level security;
alter table public.records enable row level security;
alter table public.ai_sessions enable row level security;
alter table public.ai_requests enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_daily_usage enable row level security;
alter table public.storage_cleanup enable row level security;
create policy own_profile_select on public.users for select to authenticated using(id=auth.uid());
create policy own_profile_update on public.users for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
create policy own_pets on public.pets for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy own_records on public.records for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy own_sessions on public.ai_sessions for select to authenticated using(user_id=auth.uid());
create policy own_requests on public.ai_requests for select to authenticated using(user_id=auth.uid() and created_at>=now()-interval '30 days');
create policy own_conversations on public.ai_conversations for select to authenticated using(user_id=auth.uid() and created_at>=now()-interval '30 days');
create policy own_usage on public.ai_daily_usage for select to authenticated using(user_id=auth.uid());
create policy own_cleanup on public.storage_cleanup for select to authenticated using(user_id=auth.uid());

-- Reset default Supabase grants before issuing least-privilege column grants.
revoke all on public.users,public.pets,public.records,public.ai_sessions,public.ai_requests,public.ai_conversations,public.ai_daily_usage,public.storage_cleanup from anon,authenticated;
grant select on public.users,public.pets,public.records,public.ai_sessions,public.ai_requests,public.ai_conversations,public.ai_daily_usage,public.storage_cleanup to authenticated;
grant update(nickname,bio,avatar_path) on public.users to authenticated;
grant insert(id,user_id,name,species,breed,gender,date_kind,birth_date,weight,sterilized,avatar_path,remark) on public.pets to authenticated;
grant update(name,species,breed,gender,date_kind,birth_date,weight,sterilized,avatar_path,remark) on public.pets to authenticated;
grant delete on public.pets to authenticated;
grant insert(id,user_id,pet_id,type,content,image_paths,occurred_at) on public.records to authenticated;
grant update(image_paths) on public.records to authenticated;
grant delete on public.records to authenticated;
grant all on public.users,public.pets,public.records,public.ai_sessions,public.ai_requests,public.ai_conversations,public.ai_daily_usage,public.storage_cleanup to service_role;
revoke all on function public.reserve_ai_request(uuid,uuid,uuid,uuid,text),public.finish_ai_request(uuid,text,text,text,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.reserve_ai_request(uuid,uuid,uuid,uuid,text),public.finish_ai_request(uuid,text,text,text,integer,integer,integer) to service_role;
revoke execute on function public.handle_new_user(),public.limit_pets(),public.validate_record(),public.queue_removed_images(),public.touch_updated_at() from public,anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('pet-media','pet-media',false,5242880,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
create policy private_media_read on storage.objects for select to authenticated using(bucket_id='pet-media' and (storage.foldername(name))[1]=auth.uid()::text);
create policy private_media_insert on storage.objects for insert to authenticated with check(
  bucket_id='pet-media' and (storage.foldername(name))[1]=auth.uid()::text and name !~ '\.\.' and
  (storage.objects.name ~ ('^' || auth.uid()::text || '/profile/[a-f0-9-]+\.(jpg|png|webp)$') or
    exists(select 1 from public.pets p where p.user_id=auth.uid() and
      (storage.objects.name ~ ('^' || p.user_id::text || '/pets/' || p.id::text || '/avatar/[a-f0-9-]+\.(jpg|png|webp)$') or
        exists(select 1 from public.records r where r.pet_id=p.id and r.type='incident' and storage.objects.name ~ ('^' || p.user_id::text || '/pets/' || p.id::text || '/records/' || r.id::text || '/[a-f0-9-]+\.(jpg|png|webp)$')))))
);
create policy private_media_delete on storage.objects for delete to authenticated using(bucket_id='pet-media' and (storage.foldername(name))[1]=auth.uid()::text);
commit;
