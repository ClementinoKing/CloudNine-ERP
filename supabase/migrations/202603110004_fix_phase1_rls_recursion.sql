alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.tasks enable row level security;
alter table public.task_assignees enable row level security;
alter table public.task_comments enable row level security;
alter table public.organization_invitations enable row level security;
alter table public.boards enable row level security;

drop policy if exists "projects select scoped" on public.projects;
drop policy if exists "projects insert self" on public.projects;
drop policy if exists "projects update scoped" on public.projects;
drop policy if exists "projects delete scoped" on public.projects;

drop policy if exists "tasks select scoped" on public.tasks;
drop policy if exists "tasks insert self" on public.tasks;
drop policy if exists "tasks update scoped" on public.tasks;
drop policy if exists "tasks delete scoped" on public.tasks;

drop policy if exists "task assignees select" on public.task_assignees;
drop policy if exists "task assignees insert" on public.task_assignees;
drop policy if exists "task assignees update" on public.task_assignees;
drop policy if exists "task assignees delete" on public.task_assignees;

drop policy if exists "task comments select scoped" on public.task_comments;
drop policy if exists "task comments insert scoped" on public.task_comments;
drop policy if exists "task comments update scoped" on public.task_comments;
drop policy if exists "task comments delete scoped" on public.task_comments;

drop policy if exists "invitations select scoped" on public.organization_invitations;
drop policy if exists "invitations insert scoped" on public.organization_invitations;
drop policy if exists "invitations update scoped" on public.organization_invitations;
drop policy if exists "invitations delete scoped" on public.organization_invitations;

drop policy if exists "boards default select" on public.boards;
drop policy if exists "boards custom insert" on public.boards;
drop policy if exists "boards custom update" on public.boards;
drop policy if exists "boards custom delete" on public.boards;

create policy "projects select scoped"
on public.projects
for select
using (created_by = auth.uid() or owner_id = auth.uid());

create policy "projects insert self"
on public.projects
for insert
with check (created_by = auth.uid());

create policy "projects update scoped"
on public.projects
for update
using (created_by = auth.uid() or owner_id = auth.uid())
with check (created_by = auth.uid() or owner_id = auth.uid());

create policy "projects delete scoped"
on public.projects
for delete
using (created_by = auth.uid() or owner_id = auth.uid());

create policy "tasks select scoped"
on public.tasks
for select
using (created_by = auth.uid() or assigned_to = auth.uid());

create policy "tasks insert self"
on public.tasks
for insert
with check (created_by = auth.uid());

create policy "tasks update scoped"
on public.tasks
for update
using (created_by = auth.uid() or assigned_to = auth.uid())
with check (created_by = auth.uid() or assigned_to = auth.uid());

create policy "tasks delete scoped"
on public.tasks
for delete
using (created_by = auth.uid());

create policy "task assignees select"
on public.task_assignees
for select
using (
  assignee_id = auth.uid()
  or exists (
    select 1
    from public.tasks t
    where t.id = task_assignees.task_id
      and (t.created_by = auth.uid() or t.assigned_to = auth.uid())
  )
);

create policy "task assignees insert"
on public.task_assignees
for insert
with check (
  assignee_id = auth.uid()
  or exists (
    select 1
    from public.tasks t
    where t.id = task_assignees.task_id
      and (t.created_by = auth.uid() or t.assigned_to = auth.uid())
  )
);

create policy "task assignees update"
on public.task_assignees
for update
using (
  exists (
    select 1
    from public.tasks t
    where t.id = task_assignees.task_id
      and (t.created_by = auth.uid() or t.assigned_to = auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.tasks t
    where t.id = task_assignees.task_id
      and (t.created_by = auth.uid() or t.assigned_to = auth.uid())
  )
);

create policy "task assignees delete"
on public.task_assignees
for delete
using (
  assignee_id = auth.uid()
  or exists (
    select 1
    from public.tasks t
    where t.id = task_assignees.task_id
      and (t.created_by = auth.uid() or t.assigned_to = auth.uid())
  )
);

create policy "task comments select scoped"
on public.task_comments
for select
using (
  author_id = auth.uid()
  or exists (
    select 1
    from public.tasks t
    where t.id = task_comments.task_id
      and (t.created_by = auth.uid() or t.assigned_to = auth.uid())
  )
);

create policy "task comments insert scoped"
on public.task_comments
for insert
with check (
  author_id = auth.uid()
  and exists (
    select 1
    from public.tasks t
    where t.id = task_comments.task_id
      and (t.created_by = auth.uid() or t.assigned_to = auth.uid())
  )
);

create policy "task comments update scoped"
on public.task_comments
for update
using (author_id = auth.uid())
with check (author_id = auth.uid());

create policy "task comments delete scoped"
on public.task_comments
for delete
using (author_id = auth.uid());

create policy "invitations select scoped"
on public.organization_invitations
for select
using (
  invited_by = auth.uid()
  or lower(email) = lower(coalesce((select p.email from public.profiles p where p.id = auth.uid()), ''))
);

create policy "invitations insert scoped"
on public.organization_invitations
for insert
with check (invited_by = auth.uid());

create policy "invitations update scoped"
on public.organization_invitations
for update
using (invited_by = auth.uid())
with check (invited_by = auth.uid());

create policy "invitations delete scoped"
on public.organization_invitations
for delete
using (invited_by = auth.uid());

create policy "boards default select"
on public.boards
for select
using (is_default = true or created_by = auth.uid());

create policy "boards custom insert"
on public.boards
for insert
with check (created_by = auth.uid() and coalesce(is_default, false) = false);

create policy "boards custom update"
on public.boards
for update
using (created_by = auth.uid() and coalesce(is_default, false) = false)
with check (created_by = auth.uid() and coalesce(is_default, false) = false);

create policy "boards custom delete"
on public.boards
for delete
using (created_by = auth.uid() and coalesce(is_default, false) = false);
