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

alter table public.profiles disable row level security;
alter table public.workspaces disable row level security;
alter table public.projects disable row level security;
alter table public.tasks disable row level security;
alter table public.task_comments disable row level security;
alter table public.organization_invitations disable row level security;
