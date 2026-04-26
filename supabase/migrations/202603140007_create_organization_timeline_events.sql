create table if not exists public.organization_timeline_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  event_type text not null default 'Update',
  starts_at timestamptz not null,
  ends_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_organization_timeline_events_starts_at
  on public.organization_timeline_events (starts_at asc);

create unique index if not exists uq_organization_timeline_events_title_starts_at
  on public.organization_timeline_events (title, starts_at);

drop trigger if exists set_organization_timeline_events_updated_at on public.organization_timeline_events;
create trigger set_organization_timeline_events_updated_at
before update on public.organization_timeline_events
for each row
execute function public.set_updated_at();

alter table public.organization_timeline_events enable row level security;

drop policy if exists "timeline events read" on public.organization_timeline_events;
create policy "timeline events read"
on public.organization_timeline_events
for select
to authenticated
using (true);

drop policy if exists "timeline events write admin" on public.organization_timeline_events;
create policy "timeline events write admin"
on public.organization_timeline_events
for all
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role_label, '')) = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role_label, '')) = 'admin'
  )
);

insert into public.organization_timeline_events (title, event_type, starts_at)
values
  ('Weekly planning', 'Meeting', now() + interval '1 day' + interval '10 hours'),
  ('Release readiness review', 'Review', now() + interval '2 day' + interval '14 hours' + interval '30 minutes'),
  ('Leadership sync', 'Update', now() + interval '4 day' + interval '11 hours')
on conflict (title, starts_at) do nothing;

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    execute 'alter publication supabase_realtime add table public.organization_timeline_events';
  end if;
exception
  when duplicate_object then null;
end
$$;
