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
  v_industry text := nullif(btrim(coalesce(p_industry, '')), '');
  v_plan text := coalesce(nullif(btrim(p_plan), ''), 'Enterprise');
  v_organization_id uuid := gen_random_uuid();
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

  if v_industry is null then
    raise exception 'Industry is required'
      using errcode = '22023';
  end if;

  if v_plan not in ('Starter', 'Pro', 'Enterprise') then
    v_plan := 'Enterprise';
  end if;

  select u.email into v_email
  from auth.users u
  where u.id = v_user_id;

  v_slug := public.generate_unique_organization_slug(v_name, v_organization_id);

  -- Create the organization before the profile, then link created_by after the
  -- profile exists. This avoids the profiles.organization_id NOT NULL bootstrap
  -- failure while preserving the created_by foreign key.
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
  on conflict (id) do update
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

  update public.organizations
  set created_by = v_user_id
  where organizations.id = v_organization_id;

  return query
  select o.id, o.name, o.slug, o.industry
  from public.organizations o
  where o.id = v_organization_id;
end;
$$;

grant execute on function public.create_onboarding_organization(text, text, text) to authenticated;
