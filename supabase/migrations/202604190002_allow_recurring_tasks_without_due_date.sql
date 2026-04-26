alter table public.task_recurrences
  add column if not exists anchor_at_snapshot timestamptz;

update public.task_recurrences
set anchor_at_snapshot = coalesce(anchor_at_snapshot, due_at_snapshot, start_at_snapshot, created_at)
where anchor_at_snapshot is null;

alter table public.task_recurrences
  alter column anchor_at_snapshot set not null,
  alter column due_at_snapshot drop not null;

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
declare
  v_task public.tasks%rowtype;
  v_recurrence_id uuid;
  v_assignee_ids uuid[] := coalesce(p_assignee_ids, '{}'::uuid[]);
  v_mentioned_ids uuid[] := coalesce(p_mentioned_member_ids, '{}'::uuid[]);
  v_anchor_at timestamptz := coalesce(p_due_at, p_start_at, timezone('utc', now()));
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
    p_start_at := coalesce(p_start_at, v_anchor_at)
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

create or replace function public.create_task_from_recurrence(
  p_recurrence_id uuid,
  p_occurrence_at timestamptz
)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recurrence public.task_recurrences%rowtype;
  v_task public.tasks%rowtype;
  v_start_at timestamptz;
  v_due_at timestamptz;
begin
  select *
  into v_recurrence
  from public.task_recurrences
  where id = p_recurrence_id
    and is_active
  for update;

  if not found then
    raise exception 'Recurring task series not found.' using errcode = 'P0002';
  end if;

  v_start_at := v_recurrence.start_at_snapshot + (p_occurrence_at - v_recurrence.anchor_at_snapshot);
  v_due_at := case
    when v_recurrence.due_at_snapshot is null then null
    else p_occurrence_at
  end;

  v_task := public.create_task_core(
    p_title := v_recurrence.title_snapshot,
    p_description := v_recurrence.description_snapshot,
    p_project_id := v_recurrence.project_id_snapshot,
    p_workspace_id := v_recurrence.workspace_id_snapshot,
    p_parent_task_id := null,
    p_status_id := v_recurrence.status_id_snapshot,
    p_status := v_recurrence.status_snapshot,
    p_board_column := v_recurrence.board_column_snapshot,
    p_priority := v_recurrence.priority_snapshot,
    p_assignee_ids := coalesce(v_recurrence.assignee_ids_snapshot, '{}'::uuid[]),
    p_mentioned_member_ids := coalesce(v_recurrence.mentioned_member_ids_snapshot, '{}'::uuid[]),
    p_created_by := v_recurrence.created_by_snapshot,
    p_due_at := v_due_at,
    p_start_at := v_start_at,
    p_recurrence_id := p_recurrence_id,
    p_recurrence_occurrence_at := p_occurrence_at
  );

  return v_task;
end;
$$;

create or replace function public.generate_recurring_tasks()
returns table (
  inserted_tasks integer,
  processed_series integer,
  deactivated_series integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_series public.task_recurrences%rowtype;
  v_occurrence_at timestamptz;
  v_next_run_at timestamptz;
  v_last_generated_at timestamptz;
  v_iterations integer;
begin
  inserted_tasks := 0;
  processed_series := 0;
  deactivated_series := 0;

  for v_series in
    select *
    from public.task_recurrences
    where is_active
      and next_run_at <= v_now
    order by next_run_at asc
    for update skip locked
  loop
    processed_series := processed_series + 1;
    v_iterations := 0;
    v_last_generated_at := null;
    v_occurrence_at := v_series.next_run_at;
    v_next_run_at := public.task_recurrence_next_run_at(v_occurrence_at, v_series.frequency, v_series.interval_count);

    if v_series.end_on is not null and v_occurrence_at::date > v_series.end_on then
      update public.task_recurrences
      set is_active = false,
          updated_at = timezone('utc', now())
      where id = v_series.id;
      deactivated_series := deactivated_series + 1;
      continue;
    end if;

    loop
      exit when v_occurrence_at > v_now;
      exit when v_series.end_on is not null and v_occurrence_at::date > v_series.end_on;

      perform public.create_task_from_recurrence(v_series.id, v_occurrence_at);
      inserted_tasks := inserted_tasks + 1;
      v_last_generated_at := v_occurrence_at;
      v_iterations := v_iterations + 1;

      exit when v_iterations >= 100;

      v_occurrence_at := v_next_run_at;
      v_next_run_at := public.task_recurrence_next_run_at(v_occurrence_at, v_series.frequency, v_series.interval_count);
    end loop;

    update public.task_recurrences
    set
      next_run_at = v_next_run_at,
      last_generated_at = v_last_generated_at,
      is_active = case
        when v_series.end_on is not null and v_next_run_at::date > v_series.end_on then false
        else true
      end,
      updated_at = timezone('utc', now())
    where id = v_series.id;

    if v_series.end_on is not null and v_next_run_at::date > v_series.end_on then
      deactivated_series := deactivated_series + 1;
    end if;
  end loop;

  return query
  select inserted_tasks, processed_series, deactivated_series;
end;
$$;

comment on function public.create_task_with_recurrence(
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
) is
  'Creates a task, its assignees, and task notifications. When recurrence fields are present, it also stores the recurring series metadata.';

comment on function public.create_task_from_recurrence(uuid, timestamptz) is
  'Creates the next task instance for an active recurring series using the stored template snapshot.';

comment on function public.generate_recurring_tasks() is
  'Cron entry point that advances due recurring task series and inserts the next task instances.';
