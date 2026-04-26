alter table public.tasks
  add column if not exists parent_task_id uuid references public.tasks(id) on delete cascade;

alter table public.tasks
  drop constraint if exists tasks_parent_task_not_self;

alter table public.tasks
  add constraint tasks_parent_task_not_self
  check (parent_task_id is null or parent_task_id <> id);

create index if not exists idx_tasks_parent_task_id on public.tasks(parent_task_id);
create index if not exists idx_tasks_parent_task_status on public.tasks(parent_task_id, status);
