create table if not exists public.task_assignees (
  task_id uuid not null references public.tasks(id) on delete cascade,
  assignee_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (task_id, assignee_id)
);

create index if not exists idx_task_assignees_task_id on public.task_assignees(task_id);
create index if not exists idx_task_assignees_assignee_id on public.task_assignees(assignee_id);

insert into public.task_assignees (task_id, assignee_id)
select id, assigned_to
from public.tasks
where assigned_to is not null
on conflict (task_id, assignee_id) do nothing;
