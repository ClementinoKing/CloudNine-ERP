create or replace function public.organization_slug_base(value text)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(
      trim(both '-' from regexp_replace(lower(coalesce(value, '')), '[^a-z0-9]+', '-', 'g')),
      ''
    ),
    'organization'
  );
$$;

create or replace function public.generate_unique_organization_slug(base_value text, organization_id uuid default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  base_slug text := public.organization_slug_base(base_value);
  candidate text := base_slug;
begin
  while exists (
    select 1
    from public.organizations
    where slug = candidate
      and (organization_id is null or id <> organization_id)
  ) loop
    candidate := base_slug || '-' || substr(gen_random_uuid()::text, 1, 6);
  end loop;

  return candidate;
end;
$$;

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

  if v_organization_id is not null and not exists (
    select 1 from public.organizations where id = v_organization_id
  ) then
    v_organization_id := null;
  end if;

  if v_organization_id is null and v_organization_name is not null then
    v_organization_id := gen_random_uuid();

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
      v_organization_name,
      public.generate_unique_organization_slug(v_organization_name, v_organization_id),
      'Starter',
      v_organization_name,
      'Africa/Blantyre (CAT)',
      null
    );

    v_role := 'owner';
  end if;

  v_organization_id := coalesce(v_organization_id, '11111111-1111-1111-1111-111111111111'::uuid);

  insert into public.profiles (
    id,
    organization_id,
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
    organization_id = excluded.organization_id,
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
