create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  username text,
  email text,
  avatar_url text,
  pronouns text,
  job_title text,
  department text,
  role_label text,
  about_me text,
  out_of_office boolean not null default false,
  out_of_office_start timestamptz,
  out_of_office_end timestamptz,
  onboarding_completed boolean not null default false,
  onboarding_step text not null default 'name' check (onboarding_step in ('name', 'work', 'tools')),
  onboarding_role text,
  onboarding_work_function text,
  onboarding_use_case text,
  onboarding_tools text[] not null default '{}',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete set null,
  key text,
  name text not null,
  description text,
  status text not null default 'planned' check (status in ('planned', 'active', 'at_risk', 'completed', 'archived')),
  color text,
  owner_id uuid references public.profiles(id) on delete set null,
  start_date date,
  end_date date,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete set null,
  workspace_id uuid references public.workspaces(id) on delete set null,
  title text not null,
  description text,
  status text not null default 'planned' check (status in ('planned', 'in_progress', 'review', 'blocked', 'done')),
  board_column text,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  assigned_to uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  due_at timestamptz,
  start_at timestamptz,
  completed_at timestamptz,
  sort_order numeric(12,4),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  content text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  role text not null default 'member' check (role in ('owner', 'admin', 'member', 'viewer')),
  invited_by uuid references public.profiles(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_tasks_project_id on public.tasks(project_id);
create index if not exists idx_tasks_assigned_to on public.tasks(assigned_to);
create index if not exists idx_task_comments_task_id on public.task_comments(task_id);
drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists set_workspaces_updated_at on public.workspaces;
create trigger set_workspaces_updated_at before update on public.workspaces for each row execute function public.set_updated_at();
drop trigger if exists set_projects_updated_at on public.projects;
create trigger set_projects_updated_at before update on public.projects for each row execute function public.set_updated_at();
drop trigger if exists set_tasks_updated_at on public.tasks;
create trigger set_tasks_updated_at before update on public.tasks for each row execute function public.set_updated_at();
drop trigger if exists set_task_comments_updated_at on public.task_comments;
create trigger set_task_comments_updated_at before update on public.task_comments for each row execute function public.set_updated_at();
drop trigger if exists set_organization_invitations_updated_at on public.organization_invitations;
create trigger set_organization_invitations_updated_at before update on public.organization_invitations for each row execute function public.set_updated_at();
insert into public.workspaces (id, name, description)
values
  ('22222222-2222-2222-2222-222222222221', 'Product Strategy', 'Product planning and roadmap execution.'),
  ('22222222-2222-2222-2222-222222222222', 'Ops Delivery', 'Operations planning and execution.')
on conflict (id) do update
set
  name = excluded.name,
  description = excluded.description;

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
