create or replace function public.rename_drive_folder(
  p_folder_id uuid,
  p_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_active_organization_id uuid := public.current_active_organization_id();
  v_folder record;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if v_name = '' then
    raise exception 'Folder name is required';
  end if;

  if v_active_organization_id is null then
    raise exception 'Select an organization before renaming a folder';
  end if;

  select id, organization_id, owner_id, visibility
       , parent_id
       , name
  into v_folder
  from public.drive_folders
  where id = p_folder_id
    and deleted_at is null;

  if not found then
    raise exception 'Folder not found';
  end if;

  if v_folder.organization_id <> v_active_organization_id then
    raise exception 'Folder does not belong to the active organization';
  end if;

  if v_folder.parent_id is null and v_folder.visibility = 'shared' then
    raise exception 'The shared root folder cannot be renamed';
  end if;

  if v_folder.owner_id <> v_user_id then
    raise exception 'Forbidden';
  end if;

  update public.drive_folders
  set name = v_name
  where id = p_folder_id
    and deleted_at is null;
end;
$$;

notify pgrst, 'reload schema';
