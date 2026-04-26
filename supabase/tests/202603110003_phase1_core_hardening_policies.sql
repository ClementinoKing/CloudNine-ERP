do $$
declare
  required_policies text[] := array[
    'profiles select authenticated',
    'profiles insert self',
    'profiles update self',
    'projects select authenticated',
    'projects insert self',
    'projects update scoped',
    'projects delete scoped',
    'tasks select authenticated',
    'tasks insert self',
    'tasks update scoped',
    'tasks delete scoped',
    'task assignees select authenticated',
    'task assignees insert',
    'task assignees update',
    'task assignees delete',
    'task comments select scoped',
    'task comments insert scoped',
    'task comments update scoped',
    'task comments delete scoped',
    'invitations select scoped',
    'invitations insert scoped',
    'invitations update scoped',
    'invitations delete scoped',
    'boards default select',
    'boards custom insert',
    'boards custom update',
    'boards custom delete'
  ];
  policy_name text;
  missing_policies text[] := '{}';
  missing_rls_tables text[] := '{}';
begin
  foreach policy_name in array required_policies loop
    if not exists (select 1 from pg_policies where policyname = policy_name) then
      missing_policies := array_append(missing_policies, policy_name);
    end if;
  end loop;

  for policy_name in
    select unnest(array[
      'profiles',
      'projects',
      'tasks',
      'task_assignees',
      'task_comments',
      'organization_invitations',
      'boards'
    ])
  loop
    if not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = policy_name
        and c.relrowsecurity = true
    ) then
      missing_rls_tables := array_append(missing_rls_tables, policy_name);
    end if;
  end loop;

  if cardinality(missing_policies) > 0 then
    raise exception 'Missing Phase 1 policies: %', array_to_string(missing_policies, ', ');
  end if;

  if cardinality(missing_rls_tables) > 0 then
    raise exception 'RLS is not enabled for tables: %', array_to_string(missing_rls_tables, ', ');
  end if;
end $$;
