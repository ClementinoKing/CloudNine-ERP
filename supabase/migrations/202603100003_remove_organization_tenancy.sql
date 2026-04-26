drop policy if exists "organization members can view organizations" on public.organizations;
drop policy if exists "organization admins can update organizations" on public.organizations;
drop policy if exists "organization members can view memberships" on public.organization_members;
drop policy if exists "organization admins can manage memberships" on public.organization_members;
drop policy if exists "users can view profiles in their organization" on public.profiles;
drop policy if exists "organization members can view workspaces" on public.workspaces;
drop policy if exists "organization members can create workspaces" on public.workspaces;
drop policy if exists "organization members can update workspaces" on public.workspaces;
drop policy if exists "organization members can view projects" on public.projects;
drop policy if exists "organization members can create projects" on public.projects;
drop policy if exists "organization members can update projects" on public.projects;
drop policy if exists "organization members can view tasks" on public.tasks;
drop policy if exists "organization members can create tasks" on public.tasks;
drop policy if exists "organization members can update tasks" on public.tasks;
drop policy if exists "organization members can delete tasks" on public.tasks;
drop policy if exists "organization members can view task comments" on public.task_comments;
drop policy if exists "organization members can create task comments" on public.task_comments;
drop policy if exists "organization members can update task comments" on public.task_comments;
drop policy if exists "organization members can view invitations" on public.organization_invitations;
drop policy if exists "organization admins can manage invitations" on public.organization_invitations;

drop policy if exists "authenticated users can view profiles" on public.profiles;
drop policy if exists "users can view their own profile" on public.profiles;
drop policy if exists "users can insert their own profile" on public.profiles;
drop policy if exists "users can update their own profile" on public.profiles;
drop policy if exists "authenticated users can view workspaces" on public.workspaces;
drop policy if exists "authenticated users can create workspaces" on public.workspaces;
drop policy if exists "authenticated users can update workspaces" on public.workspaces;
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

drop trigger if exists set_organizations_updated_at on public.organizations;
drop trigger if exists set_organization_members_updated_at on public.organization_members;

drop function if exists public.is_organization_member(uuid);

drop index if exists public.idx_profiles_organization_id;
drop index if exists public.idx_workspaces_organization_id;
drop index if exists public.idx_projects_organization_id;
drop index if exists public.idx_tasks_organization_id;
drop index if exists public.idx_invitations_organization_id;
drop index if exists public.idx_organization_members_user_id;

alter table if exists public.profiles
  drop column if exists organization_id;

alter table if exists public.workspaces
  drop column if exists organization_id;

alter table if exists public.projects
  drop column if exists organization_id;

alter table if exists public.tasks
  drop column if exists organization_id;

alter table if exists public.task_comments
  drop column if exists organization_id;

alter table if exists public.organization_invitations
  drop column if exists organization_id;

drop table if exists public.organization_members;
drop table if exists public.organizations;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.projects enable row level security;
alter table public.tasks enable row level security;
alter table public.task_comments enable row level security;
alter table public.organization_invitations enable row level security;

create policy "authenticated users can view profiles"
on public.profiles
for select
using (auth.role() = 'authenticated');

create policy "users can view their own profile"
on public.profiles
for select
using (id = auth.uid());

create policy "users can insert their own profile"
on public.profiles
for insert
with check (id = auth.uid());

create policy "users can update their own profile"
on public.profiles
for update
using (id = auth.uid());

create policy "authenticated users can view workspaces"
on public.workspaces
for select
using (auth.role() = 'authenticated');

create policy "authenticated users can create workspaces"
on public.workspaces
for insert
with check (auth.role() = 'authenticated');

create policy "authenticated users can update workspaces"
on public.workspaces
for update
using (auth.role() = 'authenticated');

create policy "authenticated users can view projects"
on public.projects
for select
using (auth.role() = 'authenticated');

create policy "authenticated users can create projects"
on public.projects
for insert
with check (auth.role() = 'authenticated');

create policy "authenticated users can update projects"
on public.projects
for update
using (auth.role() = 'authenticated');

create policy "authenticated users can view tasks"
on public.tasks
for select
using (auth.role() = 'authenticated');

create policy "authenticated users can create tasks"
on public.tasks
for insert
with check (auth.role() = 'authenticated');

create policy "authenticated users can update tasks"
on public.tasks
for update
using (auth.role() = 'authenticated');

create policy "authenticated users can delete tasks"
on public.tasks
for delete
using (auth.role() = 'authenticated');

create policy "authenticated users can view task comments"
on public.task_comments
for select
using (auth.role() = 'authenticated');

create policy "authenticated users can create task comments"
on public.task_comments
for insert
with check (auth.role() = 'authenticated');

create policy "authenticated users can update task comments"
on public.task_comments
for update
using (auth.role() = 'authenticated');

create policy "authenticated users can view invitations"
on public.organization_invitations
for select
using (auth.role() = 'authenticated');

create policy "authenticated users can manage invitations"
on public.organization_invitations
for all
using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');
