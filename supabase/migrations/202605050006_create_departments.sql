create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz
);

create index if not exists idx_departments_organization_id on public.departments(organization_id);
create index if not exists idx_departments_organization_active on public.departments(organization_id, is_active);
create unique index if not exists idx_departments_org_name_unique
  on public.departments(organization_id, lower(name));

drop trigger if exists set_departments_updated_at on public.departments;
create trigger set_departments_updated_at
before update on public.departments
for each row execute function public.set_updated_at();

insert into public.departments (organization_id, name, created_by)
select distinct
  p.organization_id,
  trim(p.department) as name,
  p.id as created_by
from public.profiles p
where p.organization_id is not null
  and p.department is not null
  and trim(p.department) <> ''
on conflict do nothing;

alter table public.departments enable row level security;

drop policy if exists "departments select org members" on public.departments;
drop policy if exists "departments insert org admins" on public.departments;
drop policy if exists "departments update org admins" on public.departments;
drop policy if exists "departments delete org admins" on public.departments;

create policy "departments select org members"
on public.departments
for select
using (public.is_organization_member(organization_id));

create policy "departments insert org admins"
on public.departments
for insert
with check (
  public.is_organization_admin(organization_id)
  and (created_by is null or created_by = auth.uid())
);

create policy "departments update org admins"
on public.departments
for update
using (public.is_organization_admin(organization_id))
with check (public.is_organization_admin(organization_id));

create policy "departments delete org admins"
on public.departments
for delete
using (public.is_organization_admin(organization_id));
