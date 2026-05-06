create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete restrict,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz
);

create index if not exists idx_jobs_organization_id on public.jobs(organization_id);
create index if not exists idx_jobs_department_id on public.jobs(department_id);
create index if not exists idx_jobs_organization_department on public.jobs(organization_id, department_id);
create unique index if not exists idx_jobs_org_department_name_unique
  on public.jobs(organization_id, department_id, lower(name));

drop trigger if exists set_jobs_updated_at on public.jobs;
create trigger set_jobs_updated_at
before update on public.jobs
for each row execute function public.set_updated_at();

alter table public.jobs enable row level security;

drop policy if exists "jobs select org members" on public.jobs;
drop policy if exists "jobs insert org admins" on public.jobs;
drop policy if exists "jobs update org admins" on public.jobs;
drop policy if exists "jobs delete org admins" on public.jobs;

create policy "jobs select org members"
on public.jobs
for select
using (public.is_organization_member(organization_id));

create policy "jobs insert org admins"
on public.jobs
for insert
with check (
  public.is_organization_admin(organization_id)
  and public.is_organization_member(organization_id)
  and (created_by is null or created_by = auth.uid())
  and exists (
    select 1
    from public.departments d
    where d.id = department_id
      and d.organization_id = jobs.organization_id
  )
);

create policy "jobs update org admins"
on public.jobs
for update
using (public.is_organization_admin(organization_id))
with check (
  public.is_organization_admin(organization_id)
  and exists (
    select 1
    from public.departments d
    where d.id = department_id
      and d.organization_id = jobs.organization_id
  )
);

create policy "jobs delete org admins"
on public.jobs
for delete
using (public.is_organization_admin(organization_id));
