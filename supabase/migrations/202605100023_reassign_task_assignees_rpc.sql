create or replace function public.reassign_task_assignees(
  p_task_ids uuid[],
  p_assignee_ids uuid[] default '{}'::uuid[]
)
returns setof public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_task_ids uuid[] := coalesce(p_task_ids, '{}'::uuid[]);
  v_assignee_ids uuid[] := coalesce(p_assignee_ids, '{}'::uuid[]);
  v_organization_id uuid;
  v_task_count integer;
  v_unauthorized_count integer;
  v_invalid_assignee_count integer;
begin
  if v_actor_id is null then
    raise exception 'You must be signed in to update task assignments.' using errcode = '28000';
  end if;

  select coalesce(array_agg(task_id), '{}'::uuid[])
  into v_task_ids
  from unnest(v_task_ids) as task_id
  where task_id is not null;

  if coalesce(array_length(v_task_ids, 1), 0) = 0 then
    return;
  end if;

  select organization_id
  into v_organization_id
  from public.tasks
  where id = v_task_ids[1];

  if v_organization_id is null then
    raise exception 'Selected task was not found.' using errcode = '22023';
  end if;

  if not public.is_active_organization_member(v_organization_id, v_actor_id) then
    raise exception 'You can only update task assignments in your active organization.' using errcode = '42501';
  end if;

  select count(*)
  into v_task_count
  from public.tasks t
  where t.id = any(v_task_ids)
    and t.organization_id = v_organization_id;

  if v_task_count <> coalesce(array_length(v_task_ids, 1), 0) then
    raise exception 'Selected tasks must belong to the same organization.' using errcode = '42501';
  end if;

  select count(*)
  into v_unauthorized_count
  from public.tasks t
  where t.id = any(v_task_ids)
    and not (
      t.created_by = v_actor_id
      or t.assigned_to = v_actor_id
      or exists (
        select 1
        from public.task_assignees ta
        where ta.task_id = t.id
          and ta.assignee_id = v_actor_id
      )
    );

  if v_unauthorized_count > 0 then
    raise exception 'You can only reassign tasks you created or are already assigned to.' using errcode = '42501';
  end if;

  select count(*)
  into v_invalid_assignee_count
  from unnest(v_assignee_ids) as assignee_id
  where assignee_id is not null
    and not public.is_organization_member(v_organization_id, assignee_id);

  if v_invalid_assignee_count > 0 then
    raise exception 'Task assignees must belong to the active organization.' using errcode = '42501';
  end if;

  update public.tasks
  set assigned_to = v_assignee_ids[1]
  where id = any(v_task_ids);

  delete from public.task_assignees
  where task_id = any(v_task_ids);

  if coalesce(array_length(v_assignee_ids, 1), 0) > 0 then
    insert into public.task_assignees (task_id, assignee_id)
    select task_id, assignee_id
    from unnest(v_task_ids) as task_id
    cross join unnest(v_assignee_ids) as assignee_id
    on conflict do nothing;
  end if;

  return query
  select *
  from public.tasks
  where id = any(v_task_ids);
end;
$$;

revoke all on function public.reassign_task_assignees(uuid[], uuid[]) from public;
grant execute on function public.reassign_task_assignees(uuid[], uuid[]) to authenticated;

comment on function public.reassign_task_assignees(uuid[], uuid[]) is
  'Atomically updates task assignees and the primary assigned_to field for one or more tasks within the active organization.';

notify pgrst, 'reload schema';
