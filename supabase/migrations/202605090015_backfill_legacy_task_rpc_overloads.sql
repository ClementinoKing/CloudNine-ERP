create or replace function public.create_task_core(
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
  p_created_by uuid default null,
  p_due_at timestamptz default null,
  p_start_at timestamptz default null,
  p_recurrence_id uuid default null,
  p_recurrence_occurrence_at timestamptz default null
)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.create_task_core(
    p_title := p_title,
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
    p_created_by := p_created_by,
    p_due_at := p_due_at,
    p_start_at := p_start_at,
    p_recurrence_id := p_recurrence_id,
    p_recurrence_occurrence_at := p_recurrence_occurrence_at,
    p_organization_id := null
  );
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
    p_recurrence_interval_count := p_recurrence_interval_count,
    p_organization_id := null
  );
end;
$$;
