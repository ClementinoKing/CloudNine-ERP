-- Strict multi-tenancy hardening:
-- - remove default-organization fallback behavior
-- - enforce active organization context for runtime access
-- - scope reporting RPCs by explicit organization id

alter table public.profiles
  add column if not exists active_organization_id uuid references public.organizations(id) on delete set null;

update public.profiles p
set active_organization_id = p.organization_id
where p.active_organization_id is null
  and exists (
    select 1
    from public.organization_members om
    where om.user_id = p.id
      and om.organization_id = p.organization_id
  );

create index if not exists idx_profiles_active_organization_id on public.profiles(active_organization_id);

create or replace function public.current_active_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.active_organization_id
  from public.profiles p
  where p.id = auth.uid()
    and p.active_organization_id is not null
    and exists (
      select 1
      from public.organization_members om
      where om.user_id = p.id
        and om.organization_id = p.active_organization_id
    )
  limit 1;
$$;

create or replace function public.is_active_organization_member(
  p_organization_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.current_active_organization_id() = p_organization_id
    and public.is_organization_member(p_organization_id, p_user_id);
$$;

create or replace function public.resolve_row_organization_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.organization_id is not null then
    return new;
  end if;

  case tg_table_name
    when 'projects' then
      select w.organization_id into new.organization_id
      from public.workspaces w
      where w.id = new.workspace_id;
    when 'tasks' then
      select p.organization_id into new.organization_id
      from public.projects p
      where p.id = new.project_id;
      if new.organization_id is null and new.workspace_id is not null then
        select w.organization_id into new.organization_id
        from public.workspaces w
        where w.id = new.workspace_id;
      end if;
    when 'status' then
      select p.organization_id into new.organization_id
      from public.projects p
      where p.id = new.project_id;
    when 'notifications' then
      select t.organization_id into new.organization_id
      from public.tasks t
      where t.id = new.task_id;
      if new.organization_id is null and new.recipient_id is not null then
        select p.organization_id into new.organization_id
        from public.profiles p
        where p.id = new.recipient_id;
      end if;
      if new.organization_id is null and new.actor_id is not null then
        select p.organization_id into new.organization_id
        from public.profiles p
        where p.id = new.actor_id;
      end if;
    when 'notification_email_deliveries' then
      select n.organization_id into new.organization_id
      from public.notifications n
      where n.id = new.notification_id;
    when 'user_presence_sessions' then
      select p.organization_id into new.organization_id
      from public.profiles p
      where p.id = new.user_id;
    when 'task_recurrences' then
      select t.organization_id into new.organization_id
      from public.tasks t
      where t.id = new.source_task_id;
    when 'task_reminders' then
      select t.organization_id into new.organization_id
      from public.tasks t
      where t.id = new.task_id;
    when 'drive_folders' then
      select f.organization_id into new.organization_id
      from public.drive_folders f
      where f.id = new.parent_id;
    else
      null;
  end case;

  if new.organization_id is null then
    raise exception 'organization_id is required for table %', tg_table_name
      using errcode = 'P0001';
  end if;

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
      execute format('alter table public.%I alter column organization_id drop default', tenant_table);
    end if;
  end loop;
end
$$;

drop policy if exists "organization members select same org" on public.organization_members;
create policy "organization members select active org"
on public.organization_members
for select
to authenticated
using (public.is_active_organization_member(organization_id));

drop policy if exists "organization members insert admin" on public.organization_members;
create policy "organization members insert active org admin"
on public.organization_members
for insert
to authenticated
with check (public.is_active_organization_member(organization_id) and public.is_organization_admin(organization_id));

drop policy if exists "organization members update admin" on public.organization_members;
create policy "organization members update active org admin"
on public.organization_members
for update
to authenticated
using (public.is_active_organization_member(organization_id) and public.is_organization_admin(organization_id))
with check (public.is_active_organization_member(organization_id) and public.is_organization_admin(organization_id));

drop policy if exists "organization members delete admin" on public.organization_members;
create policy "organization members delete active org admin"
on public.organization_members
for delete
to authenticated
using (public.is_active_organization_member(organization_id) and public.is_organization_admin(organization_id));

drop policy if exists "profiles select organization" on public.profiles;
create policy "profiles select active organization"
on public.profiles
for select
to authenticated
using (id = auth.uid() or public.is_active_organization_member(organization_id));

drop policy if exists "profiles update self or admin" on public.profiles;
create policy "profiles update self or active admin"
on public.profiles
for update
to authenticated
using (
  id = auth.uid()
  or (public.is_active_organization_member(organization_id) and public.is_organization_admin(organization_id))
)
with check (
  id = auth.uid()
  or (public.is_active_organization_member(organization_id) and public.is_organization_admin(organization_id))
);

drop policy if exists "projects organization access" on public.projects;
create policy "projects active organization access"
on public.projects
for all
to authenticated
using (public.is_active_organization_member(organization_id))
with check (public.is_active_organization_member(organization_id));

drop policy if exists "tasks organization access" on public.tasks;
create policy "tasks active organization access"
on public.tasks
for all
to authenticated
using (public.is_active_organization_member(organization_id))
with check (public.is_active_organization_member(organization_id));

drop policy if exists "goals organization access" on public.goals;
create policy "goals active organization access"
on public.goals
for all
to authenticated
using (public.is_active_organization_member(organization_id))
with check (public.is_active_organization_member(organization_id));

drop policy if exists "drive folders organization access" on public.drive_folders;
create policy "drive folders active organization access"
on public.drive_folders
for all
to authenticated
using (
  public.is_active_organization_member(organization_id)
  and (visibility = 'shared' or owner_id = auth.uid())
)
with check (
  public.is_active_organization_member(organization_id)
  and (visibility = 'shared' or owner_id = auth.uid())
);

drop policy if exists "drive documents organization access" on public.drive_documents;
create policy "drive documents active organization access"
on public.drive_documents
for all
to authenticated
using (
  exists (
    select 1 from public.drive_folders f
    where f.id = folder_id
      and public.is_active_organization_member(f.organization_id)
      and (visibility = 'shared' or owner_id = auth.uid())
  )
)
with check (
  exists (
    select 1 from public.drive_folders f
    where f.id = folder_id
      and public.is_active_organization_member(f.organization_id)
      and (visibility = 'shared' or owner_id = auth.uid())
  )
);

create or replace function public.reporting_base_tasks(
  p_organization_id uuid,
  p_cycle text default null,
  p_department text default null,
  p_owner uuid default null,
  p_status text default null,
  p_project uuid default null,
  p_search text default null
)
returns table (
  task_id uuid,
  title text,
  created_at timestamptz,
  due_at timestamptz,
  completed_at timestamptz,
  project_id uuid,
  project_name text,
  owner_id uuid,
  owner_name text,
  owner_department text,
  status_key text
)
language sql
stable
security invoker
as $$
  with normalized as (
    select
      case when p_cycle is null or trim(p_cycle) = '' or p_cycle = 'all' then null::text else trim(p_cycle) end as cycle_value,
      case when p_department is null or trim(p_department) = '' or p_department = 'all' then null::text else trim(p_department) end as department_value,
      p_owner as owner_value,
      case when p_status is null or trim(p_status) = '' or p_status = 'all' then null::text else trim(p_status) end as status_value,
      p_project as project_value,
      case when p_search is null or trim(p_search) = '' then null::text else lower(trim(p_search)) end as search_value
  ),
  cycle_bounds as (
    select
      n.*,
      case
        when n.cycle_value ~ '^Q[1-4] [0-9]{4}$' then
          make_date(split_part(n.cycle_value, ' ', 2)::int, ((substring(split_part(n.cycle_value, ' ', 1) from 2)::int - 1) * 3) + 1, 1)::date
        else null::date
      end as cycle_start
    from normalized n
  )
  select
    t.id as task_id,
    t.title,
    t.created_at,
    t.due_at,
    t.completed_at,
    t.project_id,
    p.name as project_name,
    t.assigned_to as owner_id,
    coalesce(owner_profile.full_name, 'Unassigned') as owner_name,
    coalesce(nullif(owner_profile.department, ''), 'No department') as owner_department,
    coalesce(s.key, t.status, 'planned') as status_key
  from public.tasks t
  left join public.status s on s.id = t.status_id
  left join public.projects p on p.id = t.project_id
  left join public.profiles owner_profile on owner_profile.id = t.assigned_to
  cross join cycle_bounds f
  where t.organization_id = p_organization_id
    and public.is_active_organization_member(t.organization_id)
    and (f.project_value is null or t.project_id = f.project_value)
    and (f.owner_value is null or t.assigned_to = f.owner_value)
    and (f.status_value is null or coalesce(s.key, t.status, 'planned') = f.status_value)
    and (f.department_value is null or coalesce(nullif(owner_profile.department, ''), 'No department') = f.department_value)
    and (
      f.cycle_start is null
      or (
        t.due_at is not null
        and t.due_at >= f.cycle_start::timestamptz
        and t.due_at < (f.cycle_start::timestamptz + interval '3 months')
      )
    )
    and (
      f.search_value is null
      or lower(coalesce(t.title, '')) like '%' || f.search_value || '%'
      or lower(coalesce(p.name, '')) like '%' || f.search_value || '%'
      or lower(coalesce(owner_profile.full_name, '')) like '%' || f.search_value || '%'
      or lower(coalesce(s.key, t.status, '')) like '%' || f.search_value || '%'
    );
$$;

create or replace function public.reporting_kpis(
  p_organization_id uuid,
  p_cycle text default null,
  p_department text default null,
  p_owner uuid default null,
  p_status text default null,
  p_project uuid default null,
  p_search text default null
)
returns table (
  on_time_delivery_pct integer,
  cycle_time_days numeric,
  blocked_rate_pct integer,
  completed_count integer,
  total_tasks integer,
  due_tasks integer,
  blocked_count integer
)
language sql
stable
security invoker
as $$
  with base as (
    select *, (completed_at is not null or status_key = 'done') as is_complete
    from public.reporting_base_tasks(p_organization_id, p_cycle, p_department, p_owner, p_status, p_project, p_search)
  ),
  stats as (
    select
      count(*)::int as total_tasks,
      count(*) filter (where due_at is not null)::int as due_tasks,
      count(*) filter (where status_key = 'blocked')::int as blocked_count,
      count(*) filter (where is_complete)::int as completed_count,
      count(*) filter (
        where due_at is not null and is_complete and completed_at is not null
          and date(completed_at at time zone 'utc') <= date(due_at at time zone 'utc')
      )::int as on_time_count,
      avg(extract(epoch from (completed_at - created_at)) / 86400.0) filter (
        where is_complete and completed_at is not null and created_at is not null and completed_at >= created_at
      ) as avg_cycle_days
    from base
  )
  select
    case when due_tasks > 0 then round((on_time_count::numeric / due_tasks::numeric) * 100)::int else 0 end as on_time_delivery_pct,
    case when avg_cycle_days is null then null else round(avg_cycle_days::numeric, 1) end as cycle_time_days,
    case when total_tasks > 0 then round((blocked_count::numeric / total_tasks::numeric) * 100)::int else 0 end as blocked_rate_pct,
    completed_count,
    total_tasks,
    due_tasks,
    blocked_count
  from stats;
$$;

create or replace function public.reporting_trend_weekly(
  p_organization_id uuid,
  p_cycle text default null,
  p_department text default null,
  p_owner uuid default null,
  p_status text default null,
  p_project uuid default null,
  p_search text default null
)
returns table (
  week_start date,
  created_count integer,
  completed_count integer,
  overdue_count integer
)
language sql
stable
security invoker
as $$
  with base as (
    select *, (completed_at is not null or status_key = 'done') as is_complete
    from public.reporting_base_tasks(p_organization_id, p_cycle, p_department, p_owner, p_status, p_project, p_search)
  ),
  weeks as (
    select generate_series(
      date_trunc('week', timezone('utc', now()))::date - interval '7 weeks',
      date_trunc('week', timezone('utc', now()))::date,
      interval '1 week'
    )::date as week_start
  )
  select
    w.week_start,
    count(*) filter (where b.created_at >= w.week_start::timestamptz and b.created_at < (w.week_start::timestamptz + interval '1 week'))::int as created_count,
    count(*) filter (where b.completed_at >= w.week_start::timestamptz and b.completed_at < (w.week_start::timestamptz + interval '1 week'))::int as completed_count,
    count(*) filter (where b.due_at >= w.week_start::timestamptz and b.due_at < (w.week_start::timestamptz + interval '1 week') and not b.is_complete)::int as overdue_count
  from weeks w
  left join base b on true
  group by w.week_start
  order by w.week_start;
$$;

create or replace function public.reporting_status_mix(
  p_organization_id uuid,
  p_cycle text default null,
  p_department text default null,
  p_owner uuid default null,
  p_status text default null,
  p_project uuid default null,
  p_search text default null
)
returns table (
  status_key text,
  status_label text,
  task_count integer,
  share_pct numeric
)
language sql
stable
security invoker
as $$
  with base as (
    select status_key, count(*)::int as task_count
    from public.reporting_base_tasks(p_organization_id, p_cycle, p_department, p_owner, p_status, p_project, p_search)
    group by status_key
  ),
  totals as (
    select coalesce(sum(task_count), 0)::int as total_count from base
  )
  select
    b.status_key,
    initcap(replace(b.status_key, '_', ' ')) as status_label,
    b.task_count,
    case when t.total_count > 0 then round((b.task_count::numeric / t.total_count::numeric) * 100, 2) else 0::numeric end as share_pct
  from base b
  cross join totals t
  order by b.task_count desc, b.status_key;
$$;

create or replace function public.reporting_action_panels(
  p_organization_id uuid,
  p_cycle text default null,
  p_department text default null,
  p_owner uuid default null,
  p_status text default null,
  p_project uuid default null,
  p_search text default null
)
returns table (
  overdue_by_owner jsonb,
  at_risk_goals jsonb,
  recent_changes jsonb
)
language sql
stable
security invoker
as $$
  with base as (
    select *, (completed_at is not null or status_key = 'done') as is_complete
    from public.reporting_base_tasks(p_organization_id, p_cycle, p_department, p_owner, p_status, p_project, p_search)
  ),
  normalized as (
    select
      case when p_cycle is null or trim(p_cycle) = '' or p_cycle = 'all' then null::text else trim(p_cycle) end as cycle_value,
      case when p_department is null or trim(p_department) = '' or p_department = 'all' then null::text else trim(p_department) end as department_value,
      p_owner as owner_value,
      p_project as project_value,
      case when p_search is null or trim(p_search) = '' then null::text else lower(trim(p_search)) end as search_value
  ),
  overdue_owners as (
    select owner_id, owner_name, count(*)::int as overdue_count
    from base
    where due_at is not null and due_at < now() and not is_complete
    group by owner_id, owner_name
    order by overdue_count desc, owner_name
    limit 10
  ),
  at_risk as (
    select
      g.id as goal_id,
      g.title,
      coalesce(owner_profile.full_name, 'Unowned') as owner_name,
      coalesce(nullif(g.department, ''), nullif(owner_profile.department, ''), 'No department') as department,
      g.due_at
    from public.goals g
    left join public.profiles owner_profile on owner_profile.id = g.owner_id
    left join public.goal_links gl on gl.goal_id = g.id
    cross join normalized n
    where
      g.organization_id = p_organization_id
      and public.is_active_organization_member(g.organization_id)
      and g.health = 'at_risk'
      and (n.cycle_value is null or g.cycle = n.cycle_value)
      and (n.department_value is null or coalesce(nullif(g.department, ''), nullif(owner_profile.department, ''), 'No department') = n.department_value)
      and (n.owner_value is null or g.owner_id = n.owner_value)
      and (n.project_value is null or gl.project_id = n.project_value)
      and (
        n.search_value is null
        or lower(coalesce(g.title, '')) like '%' || n.search_value || '%'
        or lower(coalesce(owner_profile.full_name, '')) like '%' || n.search_value || '%'
        or lower(coalesce(g.department, owner_profile.department, '')) like '%' || n.search_value || '%'
      )
    group by g.id, g.title, owner_profile.full_name, owner_profile.department, g.department, g.due_at
    order by g.due_at nulls last, g.updated_at desc
    limit 10
  ),
  recent_task_changes as (
    select
      ('task:' || b.task_id::text) as id,
      'Task completed'::text as type,
      b.title,
      (coalesce(b.project_name, 'No project') || ' • ' || coalesce(b.owner_name, 'Unassigned'))::text as context,
      b.completed_at as happened_at
    from base b
    where b.completed_at is not null
    order by b.completed_at desc
    limit 20
  ),
  recent_goal_changes as (
    select
      ('checkin:' || gc.id::text) as id,
      'Goal check-in'::text as type,
      g.title,
      coalesce(gc.blockers, gc.next_actions, author_profile.full_name, 'Progress update logged')::text as context,
      gc.created_at as happened_at
    from public.goal_checkins gc
    join public.goals g on g.id = gc.goal_id
    left join public.profiles owner_profile on owner_profile.id = g.owner_id
    left join public.profiles author_profile on author_profile.id = gc.author_id
    left join public.goal_links gl on gl.goal_id = g.id
    cross join normalized n
    where
      g.organization_id = p_organization_id
      and public.is_active_organization_member(g.organization_id)
      and (n.cycle_value is null or g.cycle = n.cycle_value)
      and (n.department_value is null or coalesce(nullif(g.department, ''), nullif(owner_profile.department, ''), 'No department') = n.department_value)
      and (n.owner_value is null or g.owner_id = n.owner_value)
      and (n.project_value is null or gl.project_id = n.project_value)
      and (
        n.search_value is null
        or lower(coalesce(g.title, '')) like '%' || n.search_value || '%'
        or lower(coalesce(author_profile.full_name, '')) like '%' || n.search_value || '%'
      )
    group by gc.id, g.title, gc.blockers, gc.next_actions, author_profile.full_name, gc.created_at
    order by gc.created_at desc
    limit 20
  ),
  recent_changes_union as (
    select * from recent_task_changes
    union all
    select * from recent_goal_changes
  )
  select
    coalesce((select jsonb_agg(jsonb_build_object('owner_id', o.owner_id, 'owner_name', o.owner_name, 'overdue_count', o.overdue_count) order by o.overdue_count desc, o.owner_name) from overdue_owners o), '[]'::jsonb) as overdue_by_owner,
    coalesce((select jsonb_agg(jsonb_build_object('goal_id', a.goal_id, 'title', a.title, 'owner_name', a.owner_name, 'department', a.department, 'due_at', a.due_at) order by a.due_at nulls last, a.title) from at_risk a), '[]'::jsonb) as at_risk_goals,
    coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'type', c.type, 'title', c.title, 'context', c.context, 'happened_at', c.happened_at) order by c.happened_at desc) from (select * from recent_changes_union order by happened_at desc limit 12) c), '[]'::jsonb) as recent_changes;
$$;

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  metadata jsonb;
  v_organization_id uuid;
  v_organization_name text;
  v_role text;
begin
  metadata := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_organization_name := nullif(btrim(coalesce(metadata ->> 'organization_name', '')), '');
  v_role := lower(coalesce(nullif(metadata ->> 'role_label', ''), case when v_organization_name is not null then 'owner' else 'member' end));

  if v_role not in ('owner', 'admin', 'member', 'viewer') then
    v_role := 'member';
  end if;

  if nullif(metadata ->> 'organization_id', '') is not null then
    begin
      v_organization_id := (metadata ->> 'organization_id')::uuid;
    exception
      when invalid_text_representation then
        v_organization_id := null;
    end;
  end if;

  if v_organization_id is not null and not exists (select 1 from public.organizations where id = v_organization_id) then
    v_organization_id := null;
  end if;

  if v_organization_id is null then
    v_organization_id := gen_random_uuid();
    insert into public.organizations (id, name, slug, plan, legal_name, timezone, created_by)
    values (
      v_organization_id,
      coalesce(v_organization_name, split_part(coalesce(new.email, 'organization@example.com'), '@', 1)),
      public.generate_unique_organization_slug(coalesce(v_organization_name, split_part(coalesce(new.email, 'organization@example.com'), '@', 1)), v_organization_id),
      'Starter',
      coalesce(v_organization_name, split_part(coalesce(new.email, 'organization@example.com'), '@', 1)),
      'Africa/Blantyre (CAT)',
      new.id
    );
    v_role := 'owner';
  end if;

  insert into public.profiles (
    id,
    organization_id,
    active_organization_id,
    full_name,
    username,
    email,
    avatar_url,
    role_label,
    job_title,
    department,
    must_reset_password
  )
  values (
    new.id,
    v_organization_id,
    v_organization_id,
    nullif(metadata ->> 'full_name', ''),
    nullif(metadata ->> 'username', ''),
    new.email,
    coalesce(nullif(metadata ->> 'avatar_path', ''), nullif(metadata ->> 'avatar_url', '')),
    v_role,
    nullif(metadata ->> 'job_title', ''),
    nullif(metadata ->> 'department', ''),
    coalesce((metadata ->> 'must_reset_password')::boolean, false)
  )
  on conflict (id) do update
  set
    organization_id = excluded.organization_id,
    active_organization_id = excluded.active_organization_id,
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    username = coalesce(excluded.username, public.profiles.username),
    email = coalesce(excluded.email, public.profiles.email),
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
    role_label = coalesce(excluded.role_label, public.profiles.role_label),
    job_title = coalesce(excluded.job_title, public.profiles.job_title),
    department = coalesce(excluded.department, public.profiles.department),
    must_reset_password = excluded.must_reset_password;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_organization_id, new.id, v_role)
  on conflict (organization_id, user_id) do update
  set role = excluded.role;

  update public.organizations
  set created_by = coalesce(created_by, new.id)
  where id = v_organization_id
    and v_role = 'owner';

  return new;
end;
$$;
