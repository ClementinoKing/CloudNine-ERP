create or replace function public.create_drive_folder(
  p_name text,
  p_parent_id uuid default null,
  p_organization_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_parent record;
  v_visibility text;
  v_owner_id uuid;
  v_sort_order integer;
  v_name text := btrim(coalesce(p_name, ''));
  v_organization_id uuid := p_organization_id;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if v_name = '' then
    raise exception 'Folder name is required';
  end if;

  if v_organization_id is null then
    v_organization_id := public.current_active_organization_id();
  end if;

  if p_parent_id is null then
    if lower(v_name) = 'shared' then
      raise exception 'Shared is reserved';
    end if;
    v_visibility := 'private';
    v_owner_id := v_user_id;
  else
    select id, organization_id, visibility, owner_id
    into v_parent
    from public.drive_folders
    where id = p_parent_id
      and deleted_at is null;

    if not found then
      raise exception 'Parent folder not found';
    end if;

    if v_organization_id is null then
      v_organization_id := v_parent.organization_id;
    end if;

    if v_parent.organization_id <> v_organization_id then
      raise exception 'Parent folder does not belong to the active organization';
    end if;

    if v_parent.visibility = 'private' and v_parent.owner_id <> v_user_id then
      raise exception 'Forbidden';
    end if;

    v_visibility := v_parent.visibility;
    v_owner_id := v_parent.owner_id;
  end if;

  if v_organization_id is null then
    raise exception 'Select an organization before creating a folder';
  end if;

  select coalesce(max(sort_order), -1) + 1
    into v_sort_order
  from public.drive_folders
  where organization_id = v_organization_id
    and parent_id is not distinct from p_parent_id
    and deleted_at is null;

  insert into public.drive_folders (
    organization_id,
    parent_id,
    owner_id,
    visibility,
    name,
    sort_order,
    created_by
  )
  values (
    v_organization_id,
    p_parent_id,
    v_owner_id,
    v_visibility,
    v_name,
    v_sort_order,
    v_user_id
  );
end;
$$;

notify pgrst, 'reload schema';
