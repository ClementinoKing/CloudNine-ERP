-- Force PostgREST schema cache reload by notifying the schema change
-- This ensures the create_task_with_recurrence RPC function is available via the REST API

-- Send notification to reload schema
notify pgrst, 'reload schema';

-- Verify the function exists (this will show in migration logs)
do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on p.pronamespace = n.oid
  where n.nspname = 'public' 
    and p.proname = 'create_task_with_recurrence';
  
  if v_count = 0 then
    raise exception 'create_task_with_recurrence function not found!';
  else
    raise notice 'Found % overload(s) of create_task_with_recurrence', v_count;
  end if;
end $$;
