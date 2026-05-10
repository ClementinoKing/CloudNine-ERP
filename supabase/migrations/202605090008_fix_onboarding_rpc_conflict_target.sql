create or replace function public.create_onboarding_organization(
  p_name text,
  p_industry text,
  p_plan text default 'Enterprise'
)
returns table (
  id uuid,
  name text,
  slug text,
  industry text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_industry text := coalesce(nullif(btrim(coalesce(p_industry, '')), ''), 'Other');
  v_plan text := coalesce(nullif(btrim(p_plan), ''), 'Enterprise');
  v_organization_id uuid;
  v_slug text;
begin
  if v_user_id is null then
    raise exception 'You must be signed in to create an organization'
      using errcode = '28000';
  end if;

  if v_name is null or length(v_name) < 2 then
    raise exception 'Organization name must be at least 2 characters'
      using errcode = '22023';
  end if;

  if v_plan not in ('Starter', 'Pro', 'Enterprise') then
    v_plan := 'Enterprise';
  end if;

  select au.email
  into v_email
  from auth.users au
  where au.id = v_user_id;

  select p.organization_id
  into v_organization_id
  from public.profiles p
  where p.id = v_user_id
    and p.organization_id is not null
    and p.organization_id <> '11111111-1111-1111-1111-111111111111'::uuid
    and exists (
      select 1
      from public.organization_members om
      where om.user_id = v_user_id
        and om.organization_id = p.organization_id
        and om.role = 'owner'
    )
  limit 1;

  if v_organization_id is null then
    select om.organization_id
    into v_organization_id
    from public.organization_members om
    join public.organizations existing_org on existing_org.id = om.organization_id
    where om.user_id = v_user_id
      and om.role = 'owner'
      and om.organization_id <> '11111111-1111-1111-1111-111111111111'::uuid
      and (existing_org.created_by is null or existing_org.created_by = v_user_id)
    order by om.created_at asc
    limit 1;
  end if;

  if v_organization_id is not null and exists (
    select 1 from public.organizations existing_org where existing_org.id = v_organization_id
  ) then
    v_slug := public.generate_unique_organization_slug(v_name, v_organization_id);

    update public.organizations org
    set
      name = v_name,
      slug = v_slug,
      plan = v_plan,
      legal_name = v_name,
      industry = v_industry,
      created_by = coalesce(org.created_by, v_user_id)
    where org.id = v_organization_id;
  else
    v_organization_id := gen_random_uuid();
    v_slug := public.generate_unique_organization_slug(v_name, v_organization_id);

    insert into public.organizations (
      id,
      name,
      slug,
      plan,
      legal_name,
      industry,
      timezone,
      created_by
    )
    values (
      v_organization_id,
      v_name,
      v_slug,
      v_plan,
      v_name,
      v_industry,
      'Africa/Blantyre (CAT)',
      null
    );
  end if;

  insert into public.profiles (
    id,
    organization_id,
    active_organization_id,
    email,
    role_label,
    must_reset_password
  )
  values (
    v_user_id,
    v_organization_id,
    v_organization_id,
    v_email,
    'owner',
    false
  )
  on conflict on constraint profiles_pkey do update
  set
    organization_id = excluded.organization_id,
    active_organization_id = excluded.active_organization_id,
    email = coalesce(excluded.email, public.profiles.email),
    role_label = 'owner',
    must_reset_password = false;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_organization_id, v_user_id, 'owner')
  on conflict (organization_id, user_id) do update
  set role = 'owner';

  update public.organizations org
  set created_by = coalesce(org.created_by, v_user_id)
  where org.id = v_organization_id;

  return query
  select
    v_organization_id::uuid as id,
    v_name::text as name,
    v_slug::text as slug,
    v_industry::text as industry;
end;
$$;

grant execute on function public.create_onboarding_organization(text, text, text) to authenticated;

notify pgrst, 'reload schema';
