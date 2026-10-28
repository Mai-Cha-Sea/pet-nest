-- Supabase's optional automatic-RLS event trigger is infrastructure, not an RPC.
-- Event-trigger execution by PostgreSQL continues; API clients cannot invoke it.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;
