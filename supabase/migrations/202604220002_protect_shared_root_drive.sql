-- Follow-up migration for shared-root drive protection.
-- The base drive schema migration was already pushed, so shared-root
-- safeguards live here as a separate change set.

create or replace function public.trash_drive_folder(p_folder_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_folder record;
  v_now timestamptz := timezone('utc', now());
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select id, parent_id, owner_id, visibility, name
  into v_folder
  from public.drive_folders
  where id = p_folder_id
    and deleted_at is null;

  if not found then
    raise exception 'Folder not found';
  end if;

  if v_folder.visibility = 'private' and v_folder.owner_id <> v_user_id then
    raise exception 'Forbidden';
  end if;

  if v_folder.parent_id is null and v_folder.visibility = 'shared' and v_folder.name = 'Shared' then
    raise exception 'Shared root cannot be modified';
  end if;

  update public.drive_folders
  set deleted_at = v_now
  where id = any(array(select id from public.drive_folder_subtree_ids(p_folder_id)))
    and deleted_at is null;

  update public.drive_documents
  set deleted_at = v_now
  where folder_id = any(array(select id from public.drive_folder_subtree_ids(p_folder_id)))
    and deleted_at is null;
end;
$$;

create or replace function public.clear_drive_trash()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  delete from public.drive_documents
  where deleted_at is not null
    and (visibility = 'shared' or owner_id = v_user_id);

  delete from public.drive_folders
  where deleted_at is not null
    and (visibility = 'shared' or owner_id = v_user_id)
    and not (parent_id is null and visibility = 'shared' and name = 'Shared');
end;
$$;
