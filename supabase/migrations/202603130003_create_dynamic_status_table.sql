create table if not exists public.status (
  id uuid primary key default gen_random_uuid(),
  project_id uuid null references public.projects(id) on delete cascade,
  key text not null,
  label text not null,
  sort_order integer not null default 0,
  color text null,
  is_default boolean not null default false,
  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists set_status_updated_at on public.status;
create trigger set_status_updated_at before update on public.status for each row execute function public.set_updated_at();

create unique index if not exists idx_status_project_key_unique on public.status(project_id, key) where project_id is not null;
create unique index if not exists idx_status_project_label_unique on public.status(project_id, label) where project_id is not null;
create unique index if not exists idx_status_global_key_unique on public.status(key) where project_id is null;
create unique index if not exists idx_status_global_label_unique on public.status(label) where project_id is null;
create index if not exists idx_status_project_sort on public.status(project_id, sort_order);

alter table public.tasks
  add column if not exists status_id uuid null references public.status(id) on delete set null;

create index if not exists idx_tasks_status_id on public.tasks(status_id);

-- Legacy compatibility: allow dynamic keys during phased migration.
alter table public.tasks
  drop constraint if exists tasks_status_check;

-- Seed global default statuses.
insert into public.status (project_id, key, label, sort_order, color, is_default, created_by)
select * from (
  values
    (null::uuid, 'planned'::text, 'Planned'::text, 0::integer, null::text, true, null::uuid),
    (null::uuid, 'in_progress'::text, 'In Progress'::text, 1::integer, null::text, true, null::uuid),
    (null::uuid, 'review'::text, 'Review'::text, 2::integer, null::text, true, null::uuid),
    (null::uuid, 'blocked'::text, 'Blocked'::text, 3::integer, null::text, true, null::uuid),
    (null::uuid, 'done'::text, 'Done'::text, 4::integer, null::text, true, null::uuid)
) as seed(project_id, key, label, sort_order, color, is_default, created_by)
where not exists (
  select 1 from public.status s where s.project_id is null and s.key = seed.key
);

-- Seed project-specific statuses from boards.
update public.status s
set
  label = seeded.label,
  sort_order = seeded.sort_order,
  is_default = seeded.is_default
from (
  select
    p.id as project_id,
    b.id as key,
    b.name as label,
    b.sort_order,
    coalesce(b.is_default, false) as is_default
  from public.projects p
  cross join public.boards b
) as seeded
where s.project_id = seeded.project_id
  and s.key = seeded.key;

insert into public.status (project_id, key, label, sort_order, is_default, created_by)
select
  p.id as project_id,
  b.id as key,
  b.name as label,
  b.sort_order,
  coalesce(b.is_default, false),
  coalesce(b.created_by, p.created_by) as created_by
from public.projects p
cross join public.boards b
where not exists (
  select 1
  from public.status s
  where s.project_id = p.id
    and s.key = b.id
);

-- Seed any task-derived status/board values missing in project status catalog.
insert into public.status (project_id, key, label, sort_order, is_default, created_by)
select
  t.project_id,
  source.key,
  initcap(replace(source.key, '_', ' ')),
  100 + row_number() over (partition by t.project_id order by source.key),
  false,
  null::uuid
from public.tasks t
join lateral (
  values (nullif(t.board_column, '')), (nullif(t.status, ''))
) as source(key) on source.key is not null
where t.project_id is not null
group by t.project_id, source.key
having not exists (
  select 1
  from public.status s
  where s.project_id = t.project_id
    and s.key = source.key
);

-- Backfill task status_id from project-specific status first.
update public.tasks t
set status_id = s.id
from public.status s
where t.status_id is null
  and s.project_id = t.project_id
  and s.key = coalesce(nullif(t.board_column, ''), nullif(t.status, ''), 'planned');

-- Backfill task status_id from global defaults as fallback.
update public.tasks t
set status_id = s.id
from public.status s
where t.status_id is null
  and s.project_id is null
  and s.key = coalesce(nullif(t.board_column, ''), nullif(t.status, ''), 'planned');
