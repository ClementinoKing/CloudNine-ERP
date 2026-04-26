create table if not exists public.drive_folders (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.drive_folders(id) on delete cascade,
  owner_id uuid references public.profiles(id) on delete cascade,
  visibility text not null check (visibility in ('shared', 'private')),
  name text not null,
  sort_order integer not null default 0,
  deleted_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint drive_folders_root_visibility_check check (
    (parent_id is null and visibility = 'shared' and owner_id is null and name = 'Shared')
    or (parent_id is null and visibility = 'private' and owner_id is not null)
    or parent_id is not null
  )
);

create table if not exists public.drive_documents (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid not null references public.drive_folders(id) on delete cascade,
  owner_id uuid references public.profiles(id) on delete cascade,
  visibility text not null check (visibility in ('shared', 'private')),
  storage_bucket text not null default 'contas',
  storage_path text not null unique,
  file_name text not null,
  mime_type text,
  file_size_bytes bigint not null default 0,
  sort_order integer not null default 0,
  deleted_at timestamptz,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_drive_folders_parent_id on public.drive_folders(parent_id);
create index if not exists idx_drive_folders_owner_id on public.drive_folders(owner_id);
create index if not exists idx_drive_folders_visibility on public.drive_folders(visibility);
create index if not exists idx_drive_folders_deleted_at on public.drive_folders(deleted_at);
create index if not exists idx_drive_folders_parent_sort on public.drive_folders(parent_id, sort_order, name);
create unique index if not exists idx_drive_folders_shared_root_unique
  on public.drive_folders(name)
  where parent_id is null and visibility = 'shared' and deleted_at is null;
create unique index if not exists idx_drive_folders_private_root_unique
  on public.drive_folders(owner_id, name)
  where parent_id is null and visibility = 'private' and deleted_at is null;
create unique index if not exists idx_drive_folders_unique_siblings
  on public.drive_folders(parent_id, name)
  where parent_id is not null and deleted_at is null;

create index if not exists idx_drive_documents_folder_id on public.drive_documents(folder_id);
create index if not exists idx_drive_documents_owner_id on public.drive_documents(owner_id);
create index if not exists idx_drive_documents_visibility on public.drive_documents(visibility);
create index if not exists idx_drive_documents_deleted_at on public.drive_documents(deleted_at);
create index if not exists idx_drive_documents_folder_sort on public.drive_documents(folder_id, sort_order, file_name);

alter table public.drive_folders enable row level security;
alter table public.drive_documents enable row level security;

create policy "authenticated users can view drive folders"
on public.drive_folders
for select
using (
  auth.role() = 'authenticated'
  and (visibility = 'shared' or owner_id = auth.uid())
);

create policy "authenticated users can view drive documents"
on public.drive_documents
for select
using (
  auth.role() = 'authenticated'
  and (visibility = 'shared' or owner_id = auth.uid())
);

drop trigger if exists set_drive_folders_updated_at on public.drive_folders;
create trigger set_drive_folders_updated_at
before update on public.drive_folders
for each row
execute function public.set_updated_at();

drop trigger if exists set_drive_documents_updated_at on public.drive_documents;
create trigger set_drive_documents_updated_at
before update on public.drive_documents
for each row
execute function public.set_updated_at();

create or replace function public.drive_folder_subtree_ids(p_folder_id uuid)
returns table(id uuid)
language sql
stable
security definer
set search_path = public
as $$
  with recursive subtree as (
    select f.id
    from public.drive_folders f
    where f.id = p_folder_id
    union all
    select child.id
    from public.drive_folders child
    join subtree parent on parent.id = child.parent_id
  )
  select id from subtree;
$$;

create or replace function public.drive_folder_is_descendant(p_ancestor_id uuid, p_candidate_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.drive_folder_subtree_ids(p_ancestor_id)
    where id = p_candidate_id
  );
$$;

create or replace function public.create_drive_folder(p_name text, p_parent_id uuid default null)
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
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if v_name = '' then
    raise exception 'Folder name is required';
  end if;

  if p_parent_id is null then
    if lower(v_name) = 'shared' then
      raise exception 'Shared is reserved';
    end if;
    v_visibility := 'private';
    v_owner_id := v_user_id;
  else
    select id, visibility, owner_id
    into v_parent
    from public.drive_folders
    where id = p_parent_id
      and deleted_at is null;

    if not found then
      raise exception 'Parent folder not found';
    end if;

    if v_parent.visibility = 'private' and v_parent.owner_id <> v_user_id then
      raise exception 'Forbidden';
    end if;

    v_visibility := v_parent.visibility;
    v_owner_id := v_parent.owner_id;
  end if;

  select coalesce(max(sort_order), -1) + 1
    into v_sort_order
  from public.drive_folders
  where parent_id is not distinct from p_parent_id
    and deleted_at is null;

  insert into public.drive_folders (
    parent_id,
    owner_id,
    visibility,
    name,
    sort_order,
    created_by
  )
  values (
    p_parent_id,
    v_owner_id,
    v_visibility,
    v_name,
    v_sort_order,
    v_user_id
  );
end;
$$;

create or replace function public.create_drive_document(
  p_folder_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_file_size_bytes bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_folder record;
  v_sort_order integer;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_folder_id is null then
    raise exception 'Folder is required';
  end if;

  if btrim(coalesce(p_file_name, '')) = '' then
    raise exception 'File name is required';
  end if;

  select id, visibility, owner_id
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

  select coalesce(max(sort_order), -1) + 1
    into v_sort_order
  from public.drive_documents
  where folder_id = p_folder_id
    and deleted_at is null;

  insert into public.drive_documents (
    folder_id,
    owner_id,
    visibility,
    storage_bucket,
    storage_path,
    file_name,
    mime_type,
    file_size_bytes,
    sort_order,
    uploaded_by
  )
  values (
    p_folder_id,
    v_folder.owner_id,
    v_folder.visibility,
    coalesce(p_storage_bucket, 'contas'),
    p_storage_path,
    p_file_name,
    p_mime_type,
    coalesce(p_file_size_bytes, 0),
    v_sort_order,
    v_user_id
  );
end;
$$;

create or replace function public.move_drive_folder(
  p_folder_id uuid,
  p_target_folder_id uuid default null,
  p_before_folder_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_folder record;
  v_target record;
  v_before record;
  v_new_parent_id uuid;
  v_new_visibility text;
  v_new_owner_id uuid;
  v_new_sort_order integer;
  v_subtree_ids uuid[];
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
    raise exception 'Shared root cannot be moved';
  end if;

  if p_before_folder_id is not null then
    select id, parent_id, owner_id, visibility, sort_order
    into v_before
    from public.drive_folders
    where id = p_before_folder_id
      and deleted_at is null;

    if not found then
      raise exception 'Before folder not found';
    end if;

    if v_before.visibility = 'private' and v_before.owner_id <> v_user_id then
      raise exception 'Forbidden';
    end if;

    if public.drive_folder_is_descendant(p_folder_id, p_before_folder_id) then
      raise exception 'Cannot move a folder inside its own subtree';
    end if;

    if v_before.parent_id is null and v_before.visibility = 'shared' then
      raise exception 'Shared root cannot be used as a reorder target';
    end if;

    v_new_parent_id := v_before.parent_id;
    v_new_visibility := v_before.visibility;
    v_new_owner_id := v_before.owner_id;
    v_new_sort_order := v_before.sort_order;
  elsif p_target_folder_id is not null then
    select id, owner_id, visibility
    into v_target
    from public.drive_folders
    where id = p_target_folder_id
      and deleted_at is null;

    if not found then
      raise exception 'Target folder not found';
    end if;

    if v_target.visibility = 'private' and v_target.owner_id <> v_user_id then
      raise exception 'Forbidden';
    end if;

    if public.drive_folder_is_descendant(p_folder_id, p_target_folder_id) then
      raise exception 'Cannot move a folder inside its own subtree';
    end if;

    v_new_parent_id := v_target.id;
    v_new_visibility := v_target.visibility;
    v_new_owner_id := v_target.owner_id;
  else
    if v_folder.visibility = 'shared' then
      raise exception 'Shared folders must stay inside Shared';
    end if;

    v_new_parent_id := null;
    v_new_visibility := 'private';
    v_new_owner_id := v_user_id;
  end if;

  select array_agg(id)
    into v_subtree_ids
  from public.drive_folder_subtree_ids(p_folder_id);

  if p_before_folder_id is not null then
    update public.drive_folders
    set sort_order = sort_order + 1
    where parent_id is not distinct from v_new_parent_id
      and deleted_at is null
      and id <> p_folder_id
      and sort_order >= v_new_sort_order;
  end if;

  update public.drive_folders
  set
    parent_id = v_new_parent_id,
    owner_id = v_new_owner_id,
    visibility = v_new_visibility,
    sort_order = coalesce(v_new_sort_order, (
      select coalesce(max(sort_order), -1) + 1
      from public.drive_folders
      where parent_id is not distinct from v_new_parent_id
        and deleted_at is null
        and id <> p_folder_id
    ))
  where id = p_folder_id;

  update public.drive_folders
  set
    owner_id = v_new_owner_id,
    visibility = v_new_visibility
  where id = any(v_subtree_ids)
    and id <> p_folder_id;

  update public.drive_documents
  set
    owner_id = v_new_owner_id,
    visibility = v_new_visibility
  where folder_id = any(v_subtree_ids);
end;
$$;

create or replace function public.move_drive_document(
  p_document_id uuid,
  p_target_folder_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_document record;
  v_folder record;
  v_sort_order integer;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select id, owner_id, visibility
  into v_document
  from public.drive_documents
  where id = p_document_id
    and deleted_at is null;

  if not found then
    raise exception 'Document not found';
  end if;

  if v_document.visibility = 'private' and v_document.owner_id <> v_user_id then
    raise exception 'Forbidden';
  end if;

  select id, owner_id, visibility, parent_id, name
  into v_folder
  from public.drive_folders
  where id = p_target_folder_id
    and deleted_at is null;

  if not found then
    raise exception 'Target folder not found';
  end if;

  if v_folder.visibility = 'private' and v_folder.owner_id <> v_user_id then
    raise exception 'Forbidden';
  end if;

  if v_document.visibility = 'shared' and v_folder.visibility = 'private' then
    raise exception 'Shared documents must stay inside Shared';
  end if;

  select coalesce(max(sort_order), -1) + 1
    into v_sort_order
  from public.drive_documents
  where folder_id = p_target_folder_id
    and deleted_at is null;

  update public.drive_documents
  set
    folder_id = p_target_folder_id,
    owner_id = v_folder.owner_id,
    visibility = v_folder.visibility,
    sort_order = v_sort_order
  where id = p_document_id;
end;
$$;

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

  select id, owner_id, visibility
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

create or replace function public.restore_drive_folder(p_folder_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_folder record;
  v_root_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select id, owner_id, visibility, parent_id, name
  into v_folder
  from public.drive_folders
  where id = p_folder_id;

  if not found then
    raise exception 'Folder not found';
  end if;

  if v_folder.visibility = 'private' and v_folder.owner_id <> v_user_id then
    raise exception 'Forbidden';
  end if;

  if v_folder.parent_id is null and v_folder.visibility = 'shared' and v_folder.name = 'Shared' then
    raise exception 'Shared root cannot be modified';
  end if;

  v_root_id := p_folder_id;
  if v_folder.parent_id is null and v_folder.visibility = 'shared' then
    v_root_id := p_folder_id;
  end if;

  update public.drive_folders
  set deleted_at = null
  where id = p_folder_id;

  update public.drive_folders
  set deleted_at = null
  where id = any(array(select id from public.drive_folder_subtree_ids(v_root_id)))
    and id <> p_folder_id;

  update public.drive_documents
  set deleted_at = null
  where folder_id = any(array(select id from public.drive_folder_subtree_ids(v_root_id)));
end;
$$;

create or replace function public.delete_drive_folder_permanently(p_folder_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_folder record;
  v_ids uuid[];
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select id, owner_id, visibility, parent_id, name
  into v_folder
  from public.drive_folders
  where id = p_folder_id;

  if not found then
    raise exception 'Folder not found';
  end if;

  if v_folder.visibility = 'private' and v_folder.owner_id <> v_user_id then
    raise exception 'Forbidden';
  end if;

  if v_folder.parent_id is null and v_folder.visibility = 'shared' and v_folder.name = 'Shared' then
    raise exception 'Shared root cannot be modified';
  end if;

  select array_agg(id)
    into v_ids
  from public.drive_folder_subtree_ids(p_folder_id);

  delete from public.drive_documents
  where folder_id = any(v_ids);

  delete from public.drive_folders
  where id = any(v_ids);
end;
$$;

create or replace function public.trash_drive_document(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_document record;
  v_now timestamptz := timezone('utc', now());
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select id, owner_id, visibility
  into v_document
  from public.drive_documents
  where id = p_document_id
    and deleted_at is null;

  if not found then
    raise exception 'Document not found';
  end if;

  if v_document.visibility = 'private' and v_document.owner_id <> v_user_id then
    raise exception 'Forbidden';
  end if;

  update public.drive_documents
  set deleted_at = v_now
  where id = p_document_id;
end;
$$;

create or replace function public.restore_drive_document(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_document record;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select id, owner_id, visibility
  into v_document
  from public.drive_documents
  where id = p_document_id;

  if not found then
    raise exception 'Document not found';
  end if;

  if v_document.visibility = 'private' and v_document.owner_id <> v_user_id then
    raise exception 'Forbidden';
  end if;

  update public.drive_documents
  set deleted_at = null
  where id = p_document_id;
end;
$$;

create or replace function public.delete_drive_document_permanently(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_document record;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select id, owner_id, visibility
  into v_document
  from public.drive_documents
  where id = p_document_id;

  if not found then
    raise exception 'Document not found';
  end if;

  if v_document.visibility = 'private' and v_document.owner_id <> v_user_id then
    raise exception 'Forbidden';
  end if;

  delete from public.drive_documents
  where id = p_document_id;
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
    and (visibility = 'shared' or owner_id = v_user_id);
end;
$$;

insert into public.drive_folders (id, parent_id, owner_id, visibility, name, sort_order, created_at, updated_at)
values (
  '33333333-3333-3333-3333-333333333331',
  null,
  null,
  'shared',
  'Shared',
  0,
  timezone('utc', now()),
  timezone('utc', now())
)
on conflict (id) do update
set
  name = excluded.name,
  visibility = excluded.visibility,
  owner_id = excluded.owner_id,
  parent_id = excluded.parent_id,
  sort_order = excluded.sort_order,
  updated_at = timezone('utc', now());
