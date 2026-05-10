create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  metadata jsonb;
  v_organization_id uuid;
  v_organization_name text;
  v_role text;
begin
  metadata := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_organization_name := nullif(btrim(coalesce(metadata ->> 'organization_name', '')), '');
  v_role := lower(coalesce(nullif(metadata ->> 'role_label', ''), case when v_organization_name is not null then 'owner' else 'member' end));

  if v_role not in ('owner', 'admin', 'member', 'viewer') then
    v_role := 'member';
  end if;

  if nullif(metadata ->> 'organization_id', '') is not null then
    begin
      v_organization_id := (metadata ->> 'organization_id')::uuid;
    exception
      when invalid_text_representation then
        v_organization_id := null;
    end;
  end if;

  if v_organization_id is not null and not exists (select 1 from public.organizations where id = v_organization_id) then
    v_organization_id := null;
  end if;

  if v_organization_id is null then
    select p.organization_id
    into v_organization_id
    from public.profiles p
    where p.id = new.id
      and p.organization_id is not null
      and p.organization_id <> '11111111-1111-1111-1111-111111111111'::uuid;
  end if;

  if v_organization_id is null then
    select om.organization_id
    into v_organization_id
    from public.organization_members om
    where om.user_id = new.id
      and om.organization_id <> '11111111-1111-1111-1111-111111111111'::uuid
    order by om.created_at asc
    limit 1;
  end if;

  if v_organization_id is null then
    v_organization_id := gen_random_uuid();
    insert into public.organizations (id, name, slug, plan, legal_name, timezone, created_by)
    values (
      v_organization_id,
      coalesce(v_organization_name, split_part(coalesce(new.email, 'organization@example.com'), '@', 1)),
      public.generate_unique_organization_slug(coalesce(v_organization_name, split_part(coalesce(new.email, 'organization@example.com'), '@', 1)), v_organization_id),
      'Starter',
      coalesce(v_organization_name, split_part(coalesce(new.email, 'organization@example.com'), '@', 1)),
      'Africa/Blantyre (CAT)',
      null
    );
    v_role := 'owner';
  end if;

  insert into public.profiles (
    id,
    organization_id,
    active_organization_id,
    full_name,
    username,
    email,
    avatar_url,
    role_label,
    job_title,
    department,
    must_reset_password
  )
  values (
    new.id,
    v_organization_id,
    v_organization_id,
    nullif(metadata ->> 'full_name', ''),
    nullif(metadata ->> 'username', ''),
    new.email,
    coalesce(nullif(metadata ->> 'avatar_path', ''), nullif(metadata ->> 'avatar_url', '')),
    v_role,
    nullif(metadata ->> 'job_title', ''),
    nullif(metadata ->> 'department', ''),
    coalesce((metadata ->> 'must_reset_password')::boolean, false)
  )
  on conflict (id) do update
  set
    organization_id = coalesce(excluded.organization_id, public.profiles.organization_id),
    active_organization_id = coalesce(excluded.active_organization_id, public.profiles.active_organization_id, public.profiles.organization_id),
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    username = coalesce(excluded.username, public.profiles.username),
    email = coalesce(excluded.email, public.profiles.email),
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
    role_label = coalesce(excluded.role_label, public.profiles.role_label),
    job_title = coalesce(excluded.job_title, public.profiles.job_title),
    department = coalesce(excluded.department, public.profiles.department),
    must_reset_password = excluded.must_reset_password;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_organization_id, new.id, v_role)
  on conflict (organization_id, user_id) do update
  set role = excluded.role;

  update public.organizations
  set created_by = coalesce(created_by, new.id)
  where id = v_organization_id
    and v_role = 'owner';

  return new;
end;
$$;

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
