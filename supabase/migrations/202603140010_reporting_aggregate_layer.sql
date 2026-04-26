create index if not exists idx_tasks_due_at on public.tasks(due_at);
create index if not exists idx_tasks_completed_at on public.tasks(completed_at);
create index if not exists idx_tasks_status_id on public.tasks(status_id);
create index if not exists idx_tasks_assigned_to on public.tasks(assigned_to);
create index if not exists idx_tasks_project_id on public.tasks(project_id);
create index if not exists idx_goals_health on public.goals(health);
create index if not exists idx_goals_cycle on public.goals(cycle);

create or replace function public.reporting_base_tasks(
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
      case
        when p_cycle is null or trim(p_cycle) = '' or p_cycle = 'all' then null::text
        else trim(p_cycle)
      end as cycle_value,
      case
        when p_department is null or trim(p_department) = '' or p_department = 'all' then null::text
        else trim(p_department)
      end as department_value,
      p_owner as owner_value,
      case
        when p_status is null or trim(p_status) = '' or p_status = 'all' then null::text
        else trim(p_status)
      end as status_value,
      p_project as project_value,
      case
        when p_search is null or trim(p_search) = '' then null::text
        else lower(trim(p_search))
      end as search_value
  ),
  cycle_bounds as (
    select
      n.*,
      case
        when n.cycle_value ~ '^Q[1-4] [0-9]{4}$' then
          make_date(
            split_part(n.cycle_value, ' ', 2)::int,
            ((substring(split_part(n.cycle_value, ' ', 1) from 2)::int - 1) * 3) + 1,
            1
          )::date
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
  where
    (f.project_value is null or t.project_id = f.project_value)
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
    select
      *,
      (completed_at is not null or status_key = 'done') as is_complete
    from public.reporting_base_tasks(p_cycle, p_department, p_owner, p_status, p_project, p_search)
  ),
  stats as (
    select
      count(*)::int as total_tasks,
      count(*) filter (where due_at is not null)::int as due_tasks,
      count(*) filter (where status_key = 'blocked')::int as blocked_count,
      count(*) filter (where is_complete)::int as completed_count,
      count(*) filter (
        where
          due_at is not null
          and is_complete
          and completed_at is not null
          and date(completed_at at time zone 'utc') <= date(due_at at time zone 'utc')
      )::int as on_time_count,
      avg(extract(epoch from (completed_at - created_at)) / 86400.0) filter (
        where
          is_complete
          and completed_at is not null
          and created_at is not null
          and completed_at >= created_at
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
    select
      *,
      (completed_at is not null or status_key = 'done') as is_complete
    from public.reporting_base_tasks(p_cycle, p_department, p_owner, p_status, p_project, p_search)
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
    count(*) filter (
      where b.created_at >= w.week_start::timestamptz
        and b.created_at < (w.week_start::timestamptz + interval '1 week')
    )::int as created_count,
    count(*) filter (
      where b.completed_at >= w.week_start::timestamptz
        and b.completed_at < (w.week_start::timestamptz + interval '1 week')
    )::int as completed_count,
    count(*) filter (
      where b.due_at >= w.week_start::timestamptz
        and b.due_at < (w.week_start::timestamptz + interval '1 week')
        and not b.is_complete
    )::int as overdue_count
  from weeks w
  left join base b on true
  group by w.week_start
  order by w.week_start;
$$;

create or replace function public.reporting_status_mix(
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
    select
      status_key,
      count(*)::int as task_count
    from public.reporting_base_tasks(p_cycle, p_department, p_owner, p_status, p_project, p_search)
    group by status_key
  ),
  totals as (
    select coalesce(sum(task_count), 0)::int as total_count from base
  )
  select
    b.status_key,
    initcap(replace(b.status_key, '_', ' ')) as status_label,
    b.task_count,
    case
      when t.total_count > 0 then round((b.task_count::numeric / t.total_count::numeric) * 100, 2)
      else 0::numeric
    end as share_pct
  from base b
  cross join totals t
  order by b.task_count desc, b.status_key;
$$;

create or replace function public.reporting_action_panels(
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
    select
      *,
      (completed_at is not null or status_key = 'done') as is_complete
    from public.reporting_base_tasks(p_cycle, p_department, p_owner, p_status, p_project, p_search)
  ),
  normalized as (
    select
      case
        when p_cycle is null or trim(p_cycle) = '' or p_cycle = 'all' then null::text
        else trim(p_cycle)
      end as cycle_value,
      case
        when p_department is null or trim(p_department) = '' or p_department = 'all' then null::text
        else trim(p_department)
      end as department_value,
      p_owner as owner_value,
      p_project as project_value,
      case
        when p_search is null or trim(p_search) = '' then null::text
        else lower(trim(p_search))
      end as search_value
  ),
  overdue_owners as (
    select
      owner_id,
      owner_name,
      count(*)::int as overdue_count
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
      g.health = 'at_risk'
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
      (n.cycle_value is null or g.cycle = n.cycle_value)
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
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'owner_id', o.owner_id,
            'owner_name', o.owner_name,
            'overdue_count', o.overdue_count
          )
          order by o.overdue_count desc, o.owner_name
        )
        from overdue_owners o
      ),
      '[]'::jsonb
    ) as overdue_by_owner,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'goal_id', a.goal_id,
            'title', a.title,
            'owner_name', a.owner_name,
            'department', a.department,
            'due_at', a.due_at
          )
          order by a.due_at nulls last, a.title
        )
        from at_risk a
      ),
      '[]'::jsonb
    ) as at_risk_goals,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', c.id,
            'type', c.type,
            'title', c.title,
            'context', c.context,
            'happened_at', c.happened_at
          )
          order by c.happened_at desc
        )
        from (
          select *
          from recent_changes_union
          order by happened_at desc
          limit 12
        ) c
      ),
      '[]'::jsonb
    ) as recent_changes;
$$;
