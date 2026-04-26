alter table public.projects enable row level security;
alter table public.tasks enable row level security;
alter table public.task_assignees enable row level security;

drop policy if exists "projects select scoped" on public.projects;
drop policy if exists "tasks select scoped" on public.tasks;
drop policy if exists "task assignees select" on public.task_assignees;

create policy "projects select authenticated"
on public.projects
for select
using (auth.role() = 'authenticated');

create policy "tasks select authenticated"
on public.tasks
for select
using (auth.role() = 'authenticated');

create policy "task assignees select authenticated"
on public.task_assignees
for select
using (auth.role() = 'authenticated');
