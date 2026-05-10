create or replace function public.bootstrap_profile_organization_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organization_id uuid;
  v_active_organization_id uuid;
  v_name text;
begin
  if new.organization_id is not null then
    if new.active_organization_id is null then
      new.active_organization_id := new.organization_id;
    end if;
    return new;
  end if;

  select p.organization_id, p.active_organization_id
  into v_organization_id, v_active_organization_id
  from public.profiles p
  where p.id = new.id
    and p.organization_id is not null;

  if v_organization_id is null then
    select om.organization_id
    into v_organization_id
    from public.organization_members om
    where om.user_id = new.id
    order by om.created_at asc
    limit 1;
  end if;

  if v_organization_id is null and new.id = auth.uid() then
    v_organization_id := gen_random_uuid();
    v_name := coalesce(nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'Onboarding organization');

    insert into public.organizations (
      id,
      name,
      slug,
      plan,
      legal_name,
      timezone,
      created_by
    )
    values (
      v_organization_id,
      v_name,
      public.generate_unique_organization_slug(v_name, v_organization_id),
      'Starter',
      v_name,
      'Africa/Blantyre (CAT)',
      null
    );
  end if;

  if v_organization_id is not null then
    new.organization_id := v_organization_id;
    new.active_organization_id := coalesce(v_active_organization_id, new.active_organization_id, v_organization_id);
  end if;

  return new;
end;
$$;

drop trigger if exists bootstrap_profiles_organization_id on public.profiles;
create trigger bootstrap_profiles_organization_id
before insert on public.profiles
for each row execute function public.bootstrap_profile_organization_id();

create or replace function public.sync_profile_active_organization_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    new.active_organization_id := new.organization_id;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_profiles_active_organization_id on public.profiles;
create trigger sync_profiles_active_organization_id
before update of organization_id on public.profiles
for each row execute function public.sync_profile_active_organization_id();
