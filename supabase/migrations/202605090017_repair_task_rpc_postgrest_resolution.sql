drop function if exists public.create_task_with_recurrence(
  text,
  text,
  uuid,
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
  integer,
  uuid
);

create or replace function public.create_task_with_recurrence(
  p_title text,
  p_organization_id uuid,
  p_description text default null,
  p_project_id uuid default null,
  p_workspace_id uuid default null,
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
    p_workspace_id := p_workspace_id,
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

create or replace function public.create_task_with_recurrence(
  p_title text,
  p_description text default null,
  p_project_id uuid default null,
  p_workspace_id uuid default null,
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
begin
  return public.create_task_with_recurrence(
    p_title := p_title,
    p_organization_id := null,
    p_description := p_description,
    p_project_id := p_project_id,
    p_workspace_id := p_workspace_id,
    p_parent_task_id := p_parent_task_id,
    p_status_id := p_status_id,
    p_status := p_status,
    p_board_column := p_board_column,
    p_priority := p_priority,
    p_assignee_ids := p_assignee_ids,
    p_mentioned_member_ids := p_mentioned_member_ids,
    p_due_at := p_due_at,
    p_start_at := p_start_at,
    p_recurrence_frequency := p_recurrence_frequency,
    p_recurrence_end_on := p_recurrence_end_on,
    p_recurrence_interval_count := p_recurrence_interval_count
  );
end;
$$;

revoke all on function public.create_task_with_recurrence(
  text,
  uuid,
  text,
  uuid,
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

grant execute on function public.create_task_with_recurrence(
  text,
  text,
  uuid,
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
