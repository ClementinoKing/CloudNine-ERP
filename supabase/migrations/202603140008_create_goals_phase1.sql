create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  owner_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  cycle text not null default 'Q1 2026',
  status text not null default 'active',
  health text not null default 'on_track',
  confidence integer,
  department text,
  due_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goals_confidence_range check (confidence is null or (confidence >= 1 and confidence <= 10)),
  constraint goals_status_allowed check (status in ('draft','active','paused','completed','archived')),
  constraint goals_health_allowed check (health in ('on_track','at_risk','off_track'))
);

create index if not exists idx_goals_owner_id on public.goals (owner_id);
create index if not exists idx_goals_cycle on public.goals (cycle);
create index if not exists idx_goals_status on public.goals (status);
create index if not exists idx_goals_health on public.goals (health);
create index if not exists idx_goals_due_at on public.goals (due_at);

create table if not exists public.goal_key_results (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals(id) on delete cascade,
  title text not null,
  metric_type text not null default 'number',
  baseline_value numeric not null default 0,
  current_value numeric not null default 0,
  target_value numeric not null default 100,
  unit text,
  cadence text not null default 'weekly',
  due_at date,
  owner_id uuid references auth.users(id) on delete set null,
  source text not null default 'manual',
  allow_over_target boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goal_kr_metric_type_allowed check (metric_type in ('percentage','number','currency','boolean')),
  constraint goal_kr_cadence_allowed check (cadence in ('weekly','monthly')),
  constraint goal_kr_source_allowed check (source in ('manual','auto'))
);

create index if not exists idx_goal_key_results_goal_id on public.goal_key_results (goal_id);
create index if not exists idx_goal_key_results_due_at on public.goal_key_results (due_at);
create index if not exists idx_goal_key_results_owner_id on public.goal_key_results (owner_id);
create index if not exists idx_goal_key_results_source on public.goal_key_results (source);

create table if not exists public.goal_checkins (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  progress_delta numeric,
  confidence integer,
  blockers text,
  next_actions text,
  created_at timestamptz not null default now(),
  constraint goal_checkins_confidence_range check (confidence is null or (confidence >= 1 and confidence <= 10))
);

create index if not exists idx_goal_checkins_goal_id on public.goal_checkins (goal_id);
create index if not exists idx_goal_checkins_created_at on public.goal_checkins (created_at desc);

create table if not exists public.goal_links (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals(id) on delete cascade,
  link_type text not null,
  project_id uuid references public.projects(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint goal_links_type_allowed check (link_type in ('project','task')),
  constraint goal_links_ref_consistency check (
    (link_type = 'project' and project_id is not null and task_id is null)
    or (link_type = 'task' and task_id is not null and project_id is null)
  )
);

create index if not exists idx_goal_links_goal_id on public.goal_links (goal_id);
create index if not exists idx_goal_links_project_id on public.goal_links (project_id);
create index if not exists idx_goal_links_task_id on public.goal_links (task_id);

drop trigger if exists set_goals_updated_at on public.goals;
create trigger set_goals_updated_at
before update on public.goals
for each row execute function public.set_updated_at();

drop trigger if exists set_goal_key_results_updated_at on public.goal_key_results;
create trigger set_goal_key_results_updated_at
before update on public.goal_key_results
for each row execute function public.set_updated_at();

alter table public.goals enable row level security;
alter table public.goal_key_results enable row level security;
alter table public.goal_checkins enable row level security;
alter table public.goal_links enable row level security;

create policy "goals_select_authenticated"
on public.goals
for select
to authenticated
using (true);

create policy "goals_insert_owner_or_admin"
on public.goals
for insert
to authenticated
with check (
  auth.uid() = owner_id
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role_label, '')) in ('admin','owner')
  )
);

create policy "goals_update_owner_or_admin"
on public.goals
for update
to authenticated
using (
  auth.uid() = owner_id
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role_label, '')) in ('admin','owner')
  )
)
with check (
  auth.uid() = owner_id
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role_label, '')) in ('admin','owner')
  )
);

create policy "goals_delete_owner_or_admin"
on public.goals
for delete
to authenticated
using (
  auth.uid() = owner_id
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role_label, '')) in ('admin','owner')
  )
);

create policy "goal_key_results_select_authenticated"
on public.goal_key_results
for select
to authenticated
using (true);

create policy "goal_key_results_write_owner_or_admin"
on public.goal_key_results
for all
to authenticated
using (
  exists (
    select 1
    from public.goals g
    left join public.profiles p on p.id = auth.uid()
    where g.id = goal_id
      and (g.owner_id = auth.uid() or lower(coalesce(p.role_label, '')) in ('admin','owner'))
  )
)
with check (
  exists (
    select 1
    from public.goals g
    left join public.profiles p on p.id = auth.uid()
    where g.id = goal_id
      and (g.owner_id = auth.uid() or lower(coalesce(p.role_label, '')) in ('admin','owner'))
  )
);

create policy "goal_checkins_select_authenticated"
on public.goal_checkins
for select
to authenticated
using (true);

create policy "goal_checkins_insert_owner_or_admin"
on public.goal_checkins
for insert
to authenticated
with check (
  exists (
    select 1
    from public.goals g
    left join public.profiles p on p.id = auth.uid()
    where g.id = goal_id
      and (g.owner_id = auth.uid() or lower(coalesce(p.role_label, '')) in ('admin','owner'))
  )
);

create policy "goal_checkins_update_author_or_admin"
on public.goal_checkins
for update
to authenticated
using (
  author_id = auth.uid()
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role_label, '')) in ('admin','owner')
  )
)
with check (
  author_id = auth.uid()
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role_label, '')) in ('admin','owner')
  )
);

create policy "goal_links_select_authenticated"
on public.goal_links
for select
to authenticated
using (true);

create policy "goal_links_write_owner_or_admin"
on public.goal_links
for all
to authenticated
using (
  exists (
    select 1
    from public.goals g
    left join public.profiles p on p.id = auth.uid()
    where g.id = goal_id
      and (g.owner_id = auth.uid() or lower(coalesce(p.role_label, '')) in ('admin','owner'))
  )
)
with check (
  exists (
    select 1
    from public.goals g
    left join public.profiles p on p.id = auth.uid()
    where g.id = goal_id
      and (g.owner_id = auth.uid() or lower(coalesce(p.role_label, '')) in ('admin','owner'))
  )
);

do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    execute 'alter publication supabase_realtime add table public.goals';
    execute 'alter publication supabase_realtime add table public.goal_key_results';
    execute 'alter publication supabase_realtime add table public.goal_checkins';
    execute 'alter publication supabase_realtime add table public.goal_links';
  end if;
exception
  when duplicate_object then null;
end
$$;
