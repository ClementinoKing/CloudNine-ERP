alter table public.projects
  add column if not exists template text not null default 'blank';

alter table public.boards
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

alter table public.boards enable row level security;
alter table public.task_assignees enable row level security;
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.tasks enable row level security;
alter table public.task_comments enable row level security;
alter table public.organization_invitations enable row level security;

drop policy if exists "authenticated users can view profiles" on public.profiles;
drop policy if exists "users can view their own profile" on public.profiles;
drop policy if exists "users can insert their own profile" on public.profiles;
drop policy if exists "users can update their own profile" on public.profiles;
drop policy if exists "authenticated users can view projects" on public.projects;
drop policy if exists "authenticated users can create projects" on public.projects;
drop policy if exists "authenticated users can update projects" on public.projects;
drop policy if exists "authenticated users can view tasks" on public.tasks;
drop policy if exists "authenticated users can create tasks" on public.tasks;
drop policy if exists "authenticated users can update tasks" on public.tasks;
drop policy if exists "authenticated users can delete tasks" on public.tasks;
drop policy if exists "authenticated users can view task comments" on public.task_comments;
drop policy if exists "authenticated users can create task comments" on public.task_comments;
drop policy if exists "authenticated users can update task comments" on public.task_comments;
drop policy if exists "authenticated users can view invitations" on public.organization_invitations;
drop policy if exists "authenticated users can manage invitations" on public.organization_invitations;
drop policy if exists "boards default select" on public.boards;
drop policy if exists "boards custom select" on public.boards;
drop policy if exists "boards custom insert" on public.boards;
drop policy if exists "boards custom update" on public.boards;
drop policy if exists "boards custom delete" on public.boards;
drop policy if exists "task assignees select" on public.task_assignees;
drop policy if exists "task assignees insert" on public.task_assignees;
drop policy if exists "task assignees update" on public.task_assignees;
drop policy if exists "task assignees delete" on public.task_assignees;

create policy "profiles select self"
on public.profiles
for select
using (id = auth.uid());

create policy "profiles insert self"
on public.profiles
for insert
with check (id = auth.uid());

create policy "profiles update self"
on public.profiles
for update
using (id = auth.uid())
with check (id = auth.uid());

create policy "projects select scoped"
on public.projects
for select
using (
  created_by = auth.uid()
  or owner_id = auth.uid()
  or exists (
    select 1
    from public.tasks t
    left join public.task_assignees ta
      on ta.task_id = t.id
    where t.project_id = projects.id
      and (ta.assignee_id = auth.uid() or t.assigned_to = auth.uid() or t.created_by = auth.uid())
  )
);

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
using (
  created_by = auth.uid()
  or assigned_to = auth.uid()
  or exists (
    select 1
    from public.task_assignees ta
    where ta.task_id = tasks.id
      and ta.assignee_id = auth.uid()
  )
  or exists (
    select 1
    from public.projects p
    where p.id = tasks.project_id
      and (p.created_by = auth.uid() or p.owner_id = auth.uid())
  )
);

create policy "tasks insert self"
on public.tasks
for insert
with check (
  created_by = auth.uid()
  and (
    project_id is null
    or exists (
      select 1
      from public.projects p
      where p.id = tasks.project_id
        and (p.created_by = auth.uid() or p.owner_id = auth.uid())
    )
  )
);

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
      and t.created_by = auth.uid()
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
      and t.created_by = auth.uid()
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
      and t.created_by = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.tasks t
    where t.id = task_assignees.task_id
      and t.created_by = auth.uid()
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
      and t.created_by = auth.uid()
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
      and (
        t.created_by = auth.uid()
        or t.assigned_to = auth.uid()
        or exists (
          select 1
          from public.task_assignees ta
          where ta.task_id = t.id
            and ta.assignee_id = auth.uid()
        )
      )
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
      and (
        t.created_by = auth.uid()
        or t.assigned_to = auth.uid()
        or exists (
          select 1
          from public.task_assignees ta
          where ta.task_id = t.id
            and ta.assignee_id = auth.uid()
        )
      )
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
