-- No phone, OTP, or credentials are stored here. Signup users may still be
-- uncommitted inside Auth while its HTTP hook executes, so no auth.users FK.
create table public.sms_deliveries (
  event_id text primary key check (length(event_id) between 1 and 200),
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  provider_code text check (provider_code is null or length(provider_code)<=80),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.sms_deliveries enable row level security;
revoke all on public.sms_deliveries from public, anon, authenticated;
grant select,insert,update on public.sms_deliveries to service_role;
create index sms_deliveries_created_at_idx on public.sms_deliveries(created_at);
