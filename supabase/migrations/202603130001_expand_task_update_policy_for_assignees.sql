alter table public.tasks enable row level security;

drop policy if exists "tasks update scoped" on public.tasks;

create policy "tasks update scoped"
on public.tasks
for update
using (
  created_by = auth.uid()
  or assigned_to = auth.uid()
  or exists (
    select 1
    from public.task_assignees ta
    where ta.task_id = tasks.id
      and ta.assignee_id = auth.uid()
  )
)
with check (
  created_by = auth.uid()
  or assigned_to = auth.uid()
  or exists (
    select 1
    from public.task_assignees ta
    where ta.task_id = tasks.id
      and ta.assignee_id = auth.uid()
  )
);
