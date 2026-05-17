-- Add org chart hierarchy columns to profiles table
alter table public.profiles
  add column if not exists manager_id uuid references public.profiles(id) on delete set null,
  add column if not exists org_chart_sort_order integer not null default 0,
  add column if not exists job_id uuid references public.jobs(id) on delete set null;

-- Create indexes for efficient hierarchy queries
create index if not exists idx_profiles_manager_id on public.profiles(manager_id);
create index if not exists idx_profiles_org_hierarchy on public.profiles(organization_id, manager_id, org_chart_sort_order);
create index if not exists idx_profiles_job_id on public.profiles(job_id);

-- Backfill job_id from existing job_title and department text fields
update public.profiles p
set job_id = j.id
from public.jobs j
inner join public.departments d on d.id = j.department_id
where p.job_id is null
  and p.organization_id = j.organization_id
  and p.organization_id = d.organization_id
  and lower(trim(p.job_title)) = lower(trim(j.name))
  and lower(trim(p.department)) = lower(trim(d.name))
  and j.is_active = true
  and j.archived_at is null
  and d.is_active = true
  and d.archived_at is null;

-- RPC function to update profile hierarchy with validation
create or replace function public.update_profile_hierarchy(
  p_profile_id uuid,
  p_new_manager_id uuid,
  p_new_sort_order integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_org_id uuid;
  v_manager_org_id uuid;
  v_current_manager_id uuid;
  v_is_admin boolean;
  v_check_id uuid;
  v_depth integer;
begin
  -- Verify caller is an admin
  select public.is_organization_admin(p.organization_id) into v_is_admin
  from public.profiles p
  where p.id = p_profile_id;

  if not v_is_admin then
    return jsonb_build_object(
      'success', false,
      'error', 'Only organization admins can update the hierarchy'
    );
  end if;

  -- Get profile organization
  select organization_id into v_profile_org_id
  from public.profiles
  where id = p_profile_id;

  if v_profile_org_id is null then
    return jsonb_build_object(
      'success', false,
      'error', 'Profile not found'
    );
  end if;

  -- Prevent self-parenting
  if p_new_manager_id = p_profile_id then
    return jsonb_build_object(
      'success', false,
      'error', 'A profile cannot be its own manager'
    );
  end if;

  -- Verify manager exists and is in same organization
  if p_new_manager_id is not null then
    select organization_id into v_manager_org_id
    from public.profiles
    where id = p_new_manager_id;

    if v_manager_org_id is null then
      return jsonb_build_object(
        'success', false,
        'error', 'Manager profile not found'
      );
    end if;

    if v_manager_org_id != v_profile_org_id then
      return jsonb_build_object(
        'success', false,
        'error', 'Manager must be in the same organization'
      );
    end if;

    -- Check for circular reference by walking up the manager chain
    v_check_id := p_new_manager_id;
    v_depth := 0;

    while v_check_id is not null and v_depth < 100 loop
      if v_check_id = p_profile_id then
        return jsonb_build_object(
          'success', false,
          'error', 'This change would create a circular reporting chain'
        );
      end if;

      select manager_id into v_check_id
      from public.profiles
      where id = v_check_id;

      v_depth := v_depth + 1;
    end loop;
  end if;

  -- Update the profile
  update public.profiles
  set
    manager_id = p_new_manager_id,
    org_chart_sort_order = p_new_sort_order,
    updated_at = timezone('utc', now())
  where id = p_profile_id;

  return jsonb_build_object(
    'success', true,
    'profile_id', p_profile_id,
    'manager_id', p_new_manager_id,
    'sort_order', p_new_sort_order
  );
end;
$$;

-- RPC function to get vacant roles (jobs without assigned profiles)
create or replace function public.get_vacant_roles(
  p_organization_id uuid
)
returns table (
  id uuid,
  name text,
  description text,
  department_id uuid,
  department_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    j.id,
    j.name,
    j.description,
    j.department_id,
    d.name as department_name
  from public.jobs j
  inner join public.departments d on d.id = j.department_id
  where j.organization_id = p_organization_id
    and j.is_active = true
    and j.archived_at is null
    and d.is_active = true
    and d.archived_at is null
    and not exists (
      select 1
      from public.profiles p
      where p.job_id = j.id
        and p.organization_id = j.organization_id
    )
  order by d.name, j.name;
$$;

-- Update RLS policies to allow admins to update hierarchy fields
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own"
on public.profiles
for update
using (id = auth.uid())
with check (
  id = auth.uid()
  and (
    -- Users can update their own non-hierarchy fields
    (manager_id is not distinct from (select manager_id from public.profiles where id = auth.uid()))
    and (org_chart_sort_order is not distinct from (select org_chart_sort_order from public.profiles where id = auth.uid()))
    and (job_id is not distinct from (select job_id from public.profiles where id = auth.uid()))
  )
);

drop policy if exists "profiles update org admins" on public.profiles;
create policy "profiles update org admins"
on public.profiles
for update
using (public.is_organization_admin(organization_id))
with check (public.is_organization_admin(organization_id));

-- Grant execute permissions on RPC functions
grant execute on function public.update_profile_hierarchy(uuid, uuid, integer) to authenticated;
grant execute on function public.get_vacant_roles(uuid) to authenticated;
