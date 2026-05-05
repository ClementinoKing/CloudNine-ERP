create extension if not exists "pgcrypto";

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  plan text not null default 'Enterprise' check (plan in ('Starter', 'Pro', 'Enterprise')),
  legal_name text,
  website text,
  industry text,
  size text,
  timezone text,
  location text,
  description text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists organizations_slug_key on public.organizations (slug);

drop trigger if exists set_organizations_updated_at on public.organizations;
create trigger set_organizations_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, user_id)
);

create index if not exists idx_organization_members_user_id on public.organization_members(user_id);
create index if not exists idx_organization_members_organization_role on public.organization_members(organization_id, role);

drop trigger if exists set_organization_members_updated_at on public.organization_members;
create trigger set_organization_members_updated_at
before update on public.organization_members
for each row execute function public.set_updated_at();

insert into public.organizations (
  id,
  name,
  slug,
  plan,
  legal_name,
  website,
  industry,
  size,
  timezone,
  location,
  description,
  created_by
)
values (
  '11111111-1111-1111-1111-111111111111',
  'CloudNine ERP',
  'cloudnine-erp',
  'Enterprise',
  'CloudNine ERP Ltd.',
  'https://cloudninetech.co.za',
  'Software & Services',
  '51-200 employees',
  'Africa/Blantyre (CAT)',
  'Lilongwe, Malawi',
  'CloudNine ERP helps organizations run projects, goals, reporting, and delivery operations from one system.',
  (select id from public.profiles order by created_at asc limit 1)
)
on conflict (id) do update
set
  name = excluded.name,
  slug = excluded.slug,
  plan = excluded.plan,
  legal_name = excluded.legal_name,
  website = excluded.website,
  industry = excluded.industry,
  size = excluded.size,
  timezone = excluded.timezone,
  location = excluded.location,
  description = excluded.description;

do $$
declare
  tenant_table text;
begin
  foreach tenant_table in array array[
    'profiles',
    'workspaces',
    'projects',
    'tasks',
    'boards',
    'status',
    'organization_invitations',
    'organization_timeline_events',
    'goals',
    'notifications',
    'notification_email_deliveries',
    'user_presence_sessions',
    'task_recurrences',
    'task_reminders',
    'chat_rooms',
    'drive_folders'
  ]
  loop
    if to_regclass(format('public.%I', tenant_table)) is not null then
      execute format('alter table public.%I add column if not exists organization_id uuid references public.organizations(id) on delete cascade', tenant_table);
      execute format('update public.%I set organization_id = %L where organization_id is null', tenant_table, '11111111-1111-1111-1111-111111111111');
      execute format('alter table public.%I alter column organization_id set not null', tenant_table);
      execute format('create index if not exists idx_%s_organization_id on public.%I(organization_id)', tenant_table, tenant_table);
    end if;
  end loop;
end
$$;

insert into public.organization_members (organization_id, user_id, role)
select
  p.organization_id,
  p.id,
  case
    when lower(coalesce(p.role_label, '')) in ('owner', 'admin') then lower(p.role_label)
    when p.id = (select created_by from public.organizations where id = p.organization_id) then 'owner'
    else 'member'
  end
from public.profiles p
on conflict (organization_id, user_id) do update
set role = excluded.role;

create or replace function public.is_organization_member(
  p_organization_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = coalesce(p_user_id, auth.uid())
  );
$$;

create or replace function public.is_organization_admin(
  p_organization_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = coalesce(p_user_id, auth.uid())
      and om.role in ('owner', 'admin')
  );
$$;

create or replace function public.current_user_default_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select om.organization_id
  from public.organization_members om
  where om.user_id = auth.uid()
  order by
    case om.role
      when 'owner' then 0
      when 'admin' then 1
      when 'member' then 2
      else 3
    end,
    om.created_at asc
  limit 1;
$$;

create or replace function public.resolve_row_organization_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_default_organization_id constant uuid := '11111111-1111-1111-1111-111111111111';
  v_user_organization_id uuid;
begin
  if new.organization_id is not null then
    return new;
  end if;

  v_user_organization_id := public.current_user_default_organization_id();

  case tg_table_name
    when 'profiles' then
      new.organization_id := coalesce(v_user_organization_id, v_default_organization_id);
    when 'projects' then
      select w.organization_id into new.organization_id
      from public.workspaces w
      where w.id = new.workspace_id;
      new.organization_id := coalesce(new.organization_id, v_user_organization_id, v_default_organization_id);
    when 'tasks' then
      select p.organization_id into new.organization_id
      from public.projects p
      where p.id = new.project_id;
      if new.organization_id is null then
        select w.organization_id into new.organization_id
        from public.workspaces w
        where w.id = new.workspace_id;
      end if;
      new.organization_id := coalesce(new.organization_id, v_user_organization_id, v_default_organization_id);
    when 'status' then
      select p.organization_id into new.organization_id
      from public.projects p
      where p.id = new.project_id;
      new.organization_id := coalesce(new.organization_id, v_user_organization_id, v_default_organization_id);
    when 'notifications' then
      select t.organization_id into new.organization_id
      from public.tasks t
      where t.id = new.task_id;
      if new.organization_id is null then
        select p.organization_id into new.organization_id
        from public.profiles p
        where p.id = new.recipient_id;
      end if;
      if new.organization_id is null then
        select p.organization_id into new.organization_id
        from public.profiles p
        where p.id = new.actor_id;
      end if;
      new.organization_id := coalesce(new.organization_id, v_user_organization_id, v_default_organization_id);
    when 'notification_email_deliveries' then
      select n.organization_id into new.organization_id
      from public.notifications n
      where n.id = new.notification_id;
      new.organization_id := coalesce(new.organization_id, v_user_organization_id, v_default_organization_id);
    when 'user_presence_sessions' then
      select p.organization_id into new.organization_id
      from public.profiles p
      where p.id = new.user_id;
      new.organization_id := coalesce(new.organization_id, v_user_organization_id, v_default_organization_id);
    when 'task_recurrences' then
      select t.organization_id into new.organization_id
      from public.tasks t
      where t.id = new.source_task_id;
      new.organization_id := coalesce(new.organization_id, v_user_organization_id, v_default_organization_id);
    when 'task_reminders' then
      select t.organization_id into new.organization_id
      from public.tasks t
      where t.id = new.task_id;
      new.organization_id := coalesce(new.organization_id, v_user_organization_id, v_default_organization_id);
    when 'drive_folders' then
      select f.organization_id into new.organization_id
      from public.drive_folders f
      where f.id = new.parent_id;
      new.organization_id := coalesce(new.organization_id, v_user_organization_id, v_default_organization_id);
    else
      new.organization_id := coalesce(v_user_organization_id, v_default_organization_id);
  end case;

  return new;
end;
$$;

do $$
declare
  tenant_table text;
begin
  foreach tenant_table in array array[
    'profiles',
    'workspaces',
    'projects',
    'tasks',
    'boards',
    'status',
    'organization_invitations',
    'organization_timeline_events',
    'goals',
    'notifications',
    'notification_email_deliveries',
    'user_presence_sessions',
    'task_recurrences',
    'task_reminders',
    'chat_rooms',
    'drive_folders'
  ]
  loop
    if to_regclass(format('public.%I', tenant_table)) is not null then
      execute format('alter table public.%I alter column organization_id set default public.current_user_default_organization_id()', tenant_table);
      execute format('drop trigger if exists resolve_%s_organization_id on public.%I', tenant_table, tenant_table);
      execute format(
        'create trigger resolve_%s_organization_id before insert on public.%I for each row execute function public.resolve_row_organization_id()',
        tenant_table,
        tenant_table
      );
    end if;
  end loop;
end
$$;

create or replace function public.ensure_default_organization_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.organization_members (organization_id, user_id, role)
  values (
    new.organization_id,
    new.id,
    case when lower(coalesce(new.role_label, '')) in ('owner', 'admin') then lower(new.role_label) else 'member' end
  )
  on conflict (organization_id, user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists ensure_default_organization_membership on public.profiles;
create trigger ensure_default_organization_membership
after insert on public.profiles
for each row execute function public.ensure_default_organization_membership();

create or replace function public.ensure_organization_creator_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by is not null then
    insert into public.organization_members (organization_id, user_id, role)
    values (new.id, new.created_by, 'owner')
    on conflict (organization_id, user_id) do update
    set role = 'owner';
  end if;

  return new;
end;
$$;

drop trigger if exists ensure_organization_creator_membership on public.organizations;
create trigger ensure_organization_creator_membership
after insert on public.organizations
for each row execute function public.ensure_organization_creator_membership();

drop index if exists public.idx_status_global_key_unique;
drop index if exists public.idx_status_global_label_unique;
create unique index if not exists idx_status_org_global_key_unique
  on public.status(organization_id, key)
  where project_id is null;
create unique index if not exists idx_status_org_global_label_unique
  on public.status(organization_id, label)
  where project_id is null;

drop index if exists public.idx_drive_folders_shared_root_unique;
drop index if exists public.idx_drive_folders_private_root_unique;
drop index if exists public.idx_drive_folders_unique_siblings;
create unique index if not exists idx_drive_folders_org_shared_root_unique
  on public.drive_folders(organization_id, name)
  where parent_id is null and visibility = 'shared' and deleted_at is null;
create unique index if not exists idx_drive_folders_org_private_root_unique
  on public.drive_folders(organization_id, owner_id, name)
  where parent_id is null and visibility = 'private' and deleted_at is null;
create unique index if not exists idx_drive_folders_org_unique_siblings
  on public.drive_folders(organization_id, parent_id, name)
  where parent_id is not null and deleted_at is null;

alter table if exists public.chat_rooms drop constraint if exists chat_rooms_slug_key;
drop index if exists public.idx_chat_rooms_slug;
create unique index if not exists idx_chat_rooms_organization_slug
  on public.chat_rooms(organization_id, slug);

drop index if exists public.uq_organization_timeline_events_title_starts_at;
create unique index if not exists uq_organization_timeline_events_org_title_starts_at
  on public.organization_timeline_events(organization_id, title, starts_at);

create index if not exists idx_projects_organization_name on public.projects(organization_id, name);
create index if not exists idx_tasks_organization_created_at on public.tasks(organization_id, created_at desc);
create index if not exists idx_goals_organization_created_at on public.goals(organization_id, created_at desc);
create index if not exists idx_notifications_organization_recipient_created_at on public.notifications(organization_id, recipient_id, created_at desc);
create index if not exists idx_chat_rooms_organization_last_message_at on public.chat_rooms(organization_id, last_message_at desc);
create index if not exists idx_drive_folders_organization_parent_sort on public.drive_folders(organization_id, parent_id, sort_order, name);

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;

do $$
declare
  policy_row record;
  policy_table text;
begin
  foreach policy_table in array array[
    'organizations',
    'organization_members',
    'profiles',
    'workspaces',
    'projects',
    'tasks',
    'boards',
    'status',
    'organization_invitations',
    'organization_timeline_events',
    'goals',
    'notifications',
    'notification_email_deliveries',
    'user_presence_sessions',
    'task_recurrences',
    'task_reminders',
    'chat_rooms',
    'drive_folders',
    'task_assignees',
    'task_comments',
    'task_comment_reactions',
    'goal_key_results',
    'goal_checkins',
    'goal_links',
    'chat_room_members',
    'chat_messages',
    'chat_message_mentions',
    'chat_message_attachments',
    'chat_room_typing_states',
    'drive_documents'
  ]
  loop
    if to_regclass(format('public.%I', policy_table)) is not null then
      execute format('alter table public.%I enable row level security', policy_table);
      for policy_row in
        select policyname
        from pg_policies
        where schemaname = 'public'
          and tablename = policy_table
      loop
        execute format('drop policy if exists %I on public.%I', policy_row.policyname, policy_table);
      end loop;
    end if;
  end loop;
end
$$;

create policy "organizations select member"
on public.organizations
for select
to authenticated
using (public.is_organization_member(id));

create policy "organizations insert authenticated"
on public.organizations
for insert
to authenticated
with check (created_by = auth.uid());

create policy "organizations update admin"
on public.organizations
for update
to authenticated
using (public.is_organization_admin(id))
with check (public.is_organization_admin(id));

create policy "organization members select same org"
on public.organization_members
for select
to authenticated
using (public.is_organization_member(organization_id));

create policy "organization members insert admin"
on public.organization_members
for insert
to authenticated
with check (public.is_organization_admin(organization_id));

create policy "organization members update admin"
on public.organization_members
for update
to authenticated
using (public.is_organization_admin(organization_id))
with check (public.is_organization_admin(organization_id));

create policy "organization members delete admin"
on public.organization_members
for delete
to authenticated
using (public.is_organization_admin(organization_id));

create policy "profiles select organization"
on public.profiles
for select
to authenticated
using (id = auth.uid() or public.is_organization_member(organization_id));

create policy "profiles insert self"
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

create policy "profiles update self or admin"
on public.profiles
for update
to authenticated
using (id = auth.uid() or public.is_organization_admin(organization_id))
with check (id = auth.uid() or public.is_organization_admin(organization_id));

do $$
begin
  if to_regclass('public.workspaces') is not null then
    create policy "workspaces organization access"
    on public.workspaces
    for all
    to authenticated
    using (public.is_organization_member(organization_id))
    with check (public.is_organization_member(organization_id));
  end if;
end
$$;

create policy "projects organization access"
on public.projects
for all
to authenticated
using (public.is_organization_member(organization_id))
with check (public.is_organization_member(organization_id));

create policy "tasks organization access"
on public.tasks
for all
to authenticated
using (public.is_organization_member(organization_id))
with check (public.is_organization_member(organization_id));

create policy "boards organization access"
on public.boards
for all
to authenticated
using (public.is_organization_member(organization_id))
with check (public.is_organization_member(organization_id));

create policy "status organization access"
on public.status
for all
to authenticated
using (public.is_organization_member(organization_id))
with check (public.is_organization_member(organization_id));

create policy "invitations select organization"
on public.organization_invitations
for select
to authenticated
using (
  public.is_organization_admin(organization_id)
  or lower(email) = lower(coalesce((select p.email from public.profiles p where p.id = auth.uid()), ''))
);

create policy "invitations manage admin"
on public.organization_invitations
for all
to authenticated
using (public.is_organization_admin(organization_id))
with check (public.is_organization_admin(organization_id));

create policy "timeline events read organization"
on public.organization_timeline_events
for select
to authenticated
using (public.is_organization_member(organization_id));

create policy "timeline events write admin"
on public.organization_timeline_events
for all
to authenticated
using (public.is_organization_admin(organization_id))
with check (public.is_organization_admin(organization_id));

create policy "goals organization access"
on public.goals
for all
to authenticated
using (public.is_organization_member(organization_id))
with check (public.is_organization_member(organization_id));

create policy "notifications select own organization"
on public.notifications
for select
to authenticated
using (recipient_id = auth.uid() and public.is_organization_member(organization_id));

create policy "notifications insert organization"
on public.notifications
for insert
to authenticated
with check (
  public.is_organization_member(organization_id)
  and (actor_id is null or actor_id = auth.uid())
);

create policy "notifications update own organization"
on public.notifications
for update
to authenticated
using (recipient_id = auth.uid() and public.is_organization_member(organization_id))
with check (recipient_id = auth.uid() and public.is_organization_member(organization_id));

create policy "notifications delete own organization"
on public.notifications
for delete
to authenticated
using (recipient_id = auth.uid() and public.is_organization_member(organization_id));

create policy "notification email deliveries admin read"
on public.notification_email_deliveries
for select
to authenticated
using (public.is_organization_admin(organization_id));

create policy "presence select organization"
on public.user_presence_sessions
for select
to authenticated
using (public.is_organization_member(organization_id));

create policy "presence insert own"
on public.user_presence_sessions
for insert
to authenticated
with check (user_id = auth.uid() and public.is_organization_member(organization_id));

create policy "presence update own"
on public.user_presence_sessions
for update
to authenticated
using (user_id = auth.uid() and public.is_organization_member(organization_id))
with check (user_id = auth.uid() and public.is_organization_member(organization_id));

create policy "presence delete own"
on public.user_presence_sessions
for delete
to authenticated
using (user_id = auth.uid() and public.is_organization_member(organization_id));

create policy "task recurrences organization access"
on public.task_recurrences
for all
to authenticated
using (public.is_organization_member(organization_id))
with check (public.is_organization_member(organization_id));

create policy "task reminders select own organization"
on public.task_reminders
for select
to authenticated
using (user_id = auth.uid() and public.is_organization_member(organization_id));

create policy "chat rooms organization access"
on public.chat_rooms
for all
to authenticated
using (public.is_organization_member(organization_id))
with check (public.is_organization_member(organization_id));

create policy "drive folders organization access"
on public.drive_folders
for all
to authenticated
using (
  public.is_organization_member(organization_id)
  and (visibility = 'shared' or owner_id = auth.uid())
)
with check (
  public.is_organization_member(organization_id)
  and (visibility = 'shared' or owner_id = auth.uid())
);

create policy "task assignees organization access"
on public.task_assignees
for all
to authenticated
using (
  exists (
    select 1 from public.tasks t
    where t.id = task_id
      and public.is_organization_member(t.organization_id)
  )
)
with check (
  exists (
    select 1 from public.tasks t
    where t.id = task_id
      and public.is_organization_member(t.organization_id)
  )
);

create policy "task comments organization access"
on public.task_comments
for all
to authenticated
using (
  exists (
    select 1 from public.tasks t
    where t.id = task_id
      and public.is_organization_member(t.organization_id)
  )
)
with check (
  exists (
    select 1 from public.tasks t
    where t.id = task_id
      and public.is_organization_member(t.organization_id)
  )
);

create policy "task comment reactions organization access"
on public.task_comment_reactions
for all
to authenticated
using (
  exists (
    select 1
    from public.task_comments tc
    join public.tasks t on t.id = tc.task_id
    where tc.id = comment_id
      and public.is_organization_member(t.organization_id)
  )
)
with check (
  exists (
    select 1
    from public.task_comments tc
    join public.tasks t on t.id = tc.task_id
    where tc.id = comment_id
      and public.is_organization_member(t.organization_id)
  )
);

create policy "goal key results organization access"
on public.goal_key_results
for all
to authenticated
using (
  exists (
    select 1 from public.goals g
    where g.id = goal_id
      and public.is_organization_member(g.organization_id)
  )
)
with check (
  exists (
    select 1 from public.goals g
    where g.id = goal_id
      and public.is_organization_member(g.organization_id)
  )
);

create policy "goal checkins organization access"
on public.goal_checkins
for all
to authenticated
using (
  exists (
    select 1 from public.goals g
    where g.id = goal_id
      and public.is_organization_member(g.organization_id)
  )
)
with check (
  exists (
    select 1 from public.goals g
    where g.id = goal_id
      and public.is_organization_member(g.organization_id)
  )
);

create policy "goal links organization access"
on public.goal_links
for all
to authenticated
using (
  exists (
    select 1 from public.goals g
    where g.id = goal_id
      and public.is_organization_member(g.organization_id)
  )
)
with check (
  exists (
    select 1 from public.goals g
    where g.id = goal_id
      and public.is_organization_member(g.organization_id)
  )
);

create policy "chat room members organization access"
on public.chat_room_members
for all
to authenticated
using (
  exists (
    select 1 from public.chat_rooms r
    where r.id = room_id
      and public.is_organization_member(r.organization_id)
  )
)
with check (
  exists (
    select 1 from public.chat_rooms r
    where r.id = room_id
      and public.is_organization_member(r.organization_id)
  )
);

create policy "chat messages organization access"
on public.chat_messages
for all
to authenticated
using (
  exists (
    select 1 from public.chat_rooms r
    where r.id = room_id
      and public.is_organization_member(r.organization_id)
  )
)
with check (
  exists (
    select 1 from public.chat_rooms r
    where r.id = room_id
      and public.is_organization_member(r.organization_id)
  )
);

create policy "chat message mentions organization access"
on public.chat_message_mentions
for all
to authenticated
using (
  exists (
    select 1
    from public.chat_messages m
    join public.chat_rooms r on r.id = m.room_id
    where m.id = message_id
      and public.is_organization_member(r.organization_id)
  )
)
with check (
  exists (
    select 1
    from public.chat_messages m
    join public.chat_rooms r on r.id = m.room_id
    where m.id = message_id
      and public.is_organization_member(r.organization_id)
  )
);

create policy "chat message attachments organization access"
on public.chat_message_attachments
for all
to authenticated
using (
  exists (
    select 1
    from public.chat_messages m
    join public.chat_rooms r on r.id = m.room_id
    where m.id = message_id
      and public.is_organization_member(r.organization_id)
  )
)
with check (
  exists (
    select 1
    from public.chat_messages m
    join public.chat_rooms r on r.id = m.room_id
    where m.id = message_id
      and public.is_organization_member(r.organization_id)
  )
);

create policy "chat typing organization access"
on public.chat_room_typing_states
for all
to authenticated
using (
  exists (
    select 1 from public.chat_rooms r
    where r.id = room_id
      and public.is_organization_member(r.organization_id)
  )
)
with check (
  exists (
    select 1 from public.chat_rooms r
    where r.id = room_id
      and public.is_organization_member(r.organization_id)
  )
);

create policy "drive documents organization access"
on public.drive_documents
for all
to authenticated
using (
  exists (
    select 1 from public.drive_folders f
    where f.id = folder_id
      and public.is_organization_member(f.organization_id)
      and (visibility = 'shared' or owner_id = auth.uid())
  )
)
with check (
  exists (
    select 1 from public.drive_folders f
    where f.id = folder_id
      and public.is_organization_member(f.organization_id)
      and (visibility = 'shared' or owner_id = auth.uid())
  )
);

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  metadata jsonb;
  v_organization_id uuid := '11111111-1111-1111-1111-111111111111';
begin
  metadata := coalesce(new.raw_user_meta_data, '{}'::jsonb);

  insert into public.profiles (
    id,
    organization_id,
    full_name,
    username,
    email,
    avatar_url,
    onboarding_completed,
    onboarding_step,
    onboarding_role,
    onboarding_work_function,
    onboarding_use_case,
    onboarding_tools
  )
  values (
    new.id,
    v_organization_id,
    nullif(metadata ->> 'full_name', ''),
    nullif(metadata ->> 'username', ''),
    new.email,
    nullif(metadata ->> 'avatar_path', ''),
    coalesce((metadata -> 'onboarding' ->> 'completed')::boolean, false),
    case
      when coalesce(nullif(metadata -> 'onboarding' ->> 'currentStep', ''), 'name') = 'invite' then 'tools'
      else coalesce(nullif(metadata -> 'onboarding' ->> 'currentStep', ''), 'name')
    end,
    nullif(metadata -> 'onboarding' ->> 'role', ''),
    nullif(metadata -> 'onboarding' ->> 'workFunction', ''),
    nullif(metadata -> 'onboarding' ->> 'useCase', ''),
    coalesce(
      array(
        select jsonb_array_elements_text(coalesce(metadata -> 'onboarding' -> 'tools', '[]'::jsonb))
      ),
      '{}'::text[]
    )
  )
  on conflict (id) do nothing;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_organization_id, new.id, 'member')
  on conflict (organization_id, user_id) do nothing;

  return new;
end;
$$;
