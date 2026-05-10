create or replace function public.create_task_core(
  p_title text,
  p_description text default null,
  p_project_id uuid default null,
  p_parent_task_id uuid default null,
  p_status_id uuid default null,
  p_status text default 'planned',
  p_board_column text default null,
  p_priority text default 'low',
  p_assignee_ids uuid[] default '{}'::uuid[],
  p_mentioned_member_ids uuid[] default '{}'::uuid[],
  p_created_by uuid default null,
  p_due_at timestamptz default null,
  p_start_at timestamptz default null,
  p_recurrence_id uuid default null,
  p_recurrence_occurrence_at timestamptz default null,
  p_organization_id uuid default null
)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.tasks%rowtype;
  v_actor_id uuid := coalesce(p_created_by, auth.uid());
  v_assignee_ids uuid[] := coalesce(p_assignee_ids, '{}'::uuid[]);
  v_mentioned_ids uuid[] := coalesce(p_mentioned_member_ids, '{}'::uuid[]);
  v_primary_assignee_id uuid;
  v_organization_id uuid := p_organization_id;
  v_mismatched_count integer;
begin
  if btrim(coalesce(p_title, '')) = '' then
    raise exception 'Task title is required.' using errcode = '22023';
  end if;

  if v_actor_id is null then
    raise exception 'You must be signed in to create a task.' using errcode = '28000';
  end if;

  if v_organization_id is null and p_parent_task_id is not null then
    select organization_id into v_organization_id
    from public.tasks
    where id = p_parent_task_id;
  end if;

  if v_organization_id is null and p_project_id is not null then
    select organization_id into v_organization_id
    from public.projects
    where id = p_project_id;
  end if;

  v_organization_id := coalesce(v_organization_id, public.current_active_organization_id());

  if v_organization_id is null then
    raise exception 'Select an organization before creating a task.' using errcode = '22023';
  end if;

  if auth.uid() is not null and not public.is_active_organization_member(v_organization_id, v_actor_id) then
    raise exception 'You can only create tasks in your active organization.' using errcode = '42501';
  end if;

  if auth.uid() is null and not public.is_organization_member(v_organization_id, v_actor_id) then
    raise exception 'Task creator must belong to the task organization.' using errcode = '42501';
  end if;

  if p_project_id is not null and not exists (
    select 1 from public.projects p
    where p.id = p_project_id
      and p.organization_id = v_organization_id
  ) then
    raise exception 'Selected project does not belong to the active organization.' using errcode = '42501';
  end if;

  if p_parent_task_id is not null and not exists (
    select 1 from public.tasks t
    where t.id = p_parent_task_id
      and t.organization_id = v_organization_id
  ) then
    raise exception 'Selected parent task does not belong to the active organization.' using errcode = '42501';
  end if;

  if p_status_id is not null and not exists (
    select 1 from public.status s
    where s.id = p_status_id
      and s.organization_id = v_organization_id
  ) then
    raise exception 'Selected status does not belong to the active organization.' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct assignee_id), '{}'::uuid[])
  into v_assignee_ids
  from unnest(v_assignee_ids) as assignee_id
  where assignee_id is not null;

  select count(*)
  into v_mismatched_count
  from unnest(v_assignee_ids) as assignee_id
  where not public.is_organization_member(v_organization_id, assignee_id);

  if v_mismatched_count > 0 then
    raise exception 'Task assignees must belong to the active organization.' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct mentioned_id), '{}'::uuid[])
  into v_mentioned_ids
  from unnest(v_mentioned_ids) as mentioned_id
  where mentioned_id is not null;

  select count(*)
  into v_mismatched_count
  from unnest(v_mentioned_ids) as mentioned_id
  where not public.is_organization_member(v_organization_id, mentioned_id);

  if v_mismatched_count > 0 then
    raise exception 'Mentioned teammates must belong to the active organization.' using errcode = '42501';
  end if;

  v_primary_assignee_id := v_assignee_ids[1];

  insert into public.tasks (
    organization_id,
    title,
    description,
    project_id,
    parent_task_id,
    status_id,
    status,
    board_column,
    priority,
    assigned_to,
    created_by,
    due_at,
    start_at,
    recurrence_id,
    recurrence_occurrence_at
  )
  values (
    v_organization_id,
    p_title,
    p_description,
    p_project_id,
    p_parent_task_id,
    p_status_id,
    p_status,
    null,
    p_priority,
    v_primary_assignee_id,
    v_actor_id,
    p_due_at,
    p_start_at,
    p_recurrence_id,
    p_recurrence_occurrence_at
  )
  returning * into v_task;

  insert into public.task_assignees (task_id, assignee_id)
  select
    v_task.id,
    assignee_id
  from unnest(v_assignee_ids) as assignee_id
  on conflict do nothing;

  insert into public.notifications (id, recipient_id, actor_id, task_id, type, title, message, metadata)
  select
    gen_random_uuid(),
    recipient_id,
    v_actor_id,
    v_task.id,
    'task',
    case when notification_kind = 'mention' then 'You were mentioned' else 'New task assigned to you' end,
    case when notification_kind = 'mention' then format('You were mentioned in "%s".', v_task.title) else format('You were assigned "%s".', v_task.title) end,
    jsonb_build_object(
      'event',
      case when notification_kind = 'mention' then 'task_mentioned' else 'task_assigned' end,
      'source',
      source_label
    )
  from (
    select
      recipient_id,
      notification_kind,
      case when notification_kind = 'mention' then 'task_create_description' else 'task_create' end as source_label
    from (
      select distinct assignee_id as recipient_id, 'task_assigned'::text as notification_kind
      from unnest(v_assignee_ids) as assignee_id
      union all
      select distinct mentioned_id as recipient_id, 'mention'::text as notification_kind
      from unnest(v_mentioned_ids) as mentioned_id
    ) recipient_union
    where recipient_id is not null
      and (v_actor_id is null or recipient_id <> v_actor_id)
  ) notification_rows;

  perform public.dispatch_task_notification_emails(v_task.id);

  return v_task;
end;
$$;

create or replace function public.create_task_with_recurrence(
  p_title text,
  p_organization_id uuid,
  p_description text default null,
  p_project_id uuid default null,
  p_parent_task_id uuid default null,
  p_status_id uuid default null,
  p_status text default 'planned',
  p_board_column text default null,
  p_priority text default 'low',
  p_assignee_ids uuid[] default '{}'::uuid[],
  p_mentioned_member_ids uuid[] default '{}'::uuid[],
  p_due_at timestamptz default null,
  p_start_at timestamptz default null,
  p_recurrence_frequency text default null,
  p_recurrence_end_on date default null,
  p_recurrence_interval_count integer default 1
)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.tasks%rowtype;
  v_recurrence_id uuid;
  v_assignee_ids uuid[] := coalesce(p_assignee_ids, '{}'::uuid[]);
  v_mentioned_ids uuid[] := coalesce(p_mentioned_member_ids, '{}'::uuid[]);
  v_anchor_at timestamptz := coalesce(p_due_at, p_start_at, now());
begin
  if p_recurrence_frequency is not null then
    if p_parent_task_id is not null then
      raise exception 'Recurring tasks are only supported for top-level tasks.' using errcode = '22023';
    end if;

    if p_recurrence_end_on is not null and p_recurrence_end_on < v_anchor_at::date then
      raise exception 'Recurrence end date must be on or after the task start date.' using errcode = '22023';
    end if;
  end if;

  v_task := public.create_task_core(
    p_title := p_title,
    p_description := p_description,
    p_project_id := p_project_id,
    p_parent_task_id := p_parent_task_id,
    p_status_id := p_status_id,
    p_status := p_status,
    p_board_column := p_board_column,
    p_priority := p_priority,
    p_assignee_ids := v_assignee_ids,
    p_mentioned_member_ids := v_mentioned_ids,
    p_created_by := auth.uid(),
    p_due_at := p_due_at,
    p_start_at := coalesce(p_start_at, v_anchor_at),
    p_organization_id := p_organization_id
  );

  if p_recurrence_frequency is not null then
    insert into public.task_recurrences (
      source_task_id,
      frequency,
      interval_count,
      end_on,
      next_run_at,
      title_snapshot,
      description_snapshot,
      project_id_snapshot,
      workspace_id_snapshot,
      status_id_snapshot,
      status_snapshot,
      board_column_snapshot,
      priority_snapshot,
      assignee_ids_snapshot,
      mentioned_member_ids_snapshot,
      created_by_snapshot,
      due_at_snapshot,
      start_at_snapshot,
      anchor_at_snapshot
    )
    values (
      v_task.id,
      p_recurrence_frequency,
      greatest(coalesce(p_recurrence_interval_count, 1), 1),
      p_recurrence_end_on,
      public.task_recurrence_next_run_at(v_anchor_at, p_recurrence_frequency, greatest(coalesce(p_recurrence_interval_count, 1), 1)),
      v_task.title,
      v_task.description,
      v_task.project_id,
      v_task.workspace_id,
      v_task.status_id,
      v_task.status,
      v_task.board_column,
      v_task.priority,
      v_assignee_ids,
      v_mentioned_ids,
      v_task.created_by,
      p_due_at,
      coalesce(v_task.start_at, p_start_at, v_anchor_at),
      v_anchor_at
    )
    returning id into v_recurrence_id;

    update public.tasks
    set recurrence_id = v_recurrence_id,
        recurrence_occurrence_at = v_anchor_at
    where id = v_task.id;

    select * into v_task
    from public.tasks
    where id = v_task.id;
  end if;

  return v_task;
end;
$$;

revoke all on function public.create_task_core(
  text,
  text,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  uuid[],
  uuid[],
  uuid,
  timestamptz,
  timestamptz,
  uuid,
  timestamptz,
  uuid
) from public;

grant execute on function public.create_task_core(
  text,
  text,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  uuid[],
  uuid[],
  uuid,
  timestamptz,
  timestamptz,
  uuid,
  timestamptz,
  uuid
) to authenticated;

revoke all on function public.create_task_with_recurrence(
  text,
  uuid,
  text,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  uuid[],
  uuid[],
  timestamptz,
  timestamptz,
  text,
  date,
  integer
) from public;

grant execute on function public.create_task_with_recurrence(
  text,
  uuid,
  text,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  uuid[],
  uuid[],
  timestamptz,
  timestamptz,
  text,
  date,
  integer
) to authenticated;

comment on function public.create_task_with_recurrence(
  text,
  uuid,
  text,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  uuid[],
  uuid[],
  timestamptz,
  timestamptz,
  text,
  date,
  integer
) is
  'Creates an active-organization-scoped task, its assignees, notifications, and optional recurring series metadata.';

notify pgrst, 'reload schema';
