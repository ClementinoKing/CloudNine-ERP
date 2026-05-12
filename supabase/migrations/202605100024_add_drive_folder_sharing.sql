create table if not exists public.drive_folder_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  folder_id uuid not null references public.drive_folders(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (organization_id, folder_id, member_id)
);

create index if not exists idx_drive_folder_members_folder_id on public.drive_folder_members(folder_id);
create index if not exists idx_drive_folder_members_member_id on public.drive_folder_members(member_id);
create index if not exists idx_drive_folder_members_organization_id on public.drive_folder_members(organization_id);

alter table public.drive_folder_members enable row level security;

drop trigger if exists set_drive_folder_members_updated_at on public.drive_folder_members;
create trigger set_drive_folder_members_updated_at
before update on public.drive_folder_members
for each row
execute function public.set_updated_at();

create or replace function public.drive_folder_can_access(
  p_folder_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with recursive ancestry as (
    select
      f.id,
      f.parent_id,
      f.organization_id,
      f.owner_id,
      f.visibility,
      f.name
    from public.drive_folders f
    where f.id = p_folder_id

    union all

    select
      parent.id,
      parent.parent_id,
      parent.organization_id,
      parent.owner_id,
      parent.visibility,
      parent.name
    from public.drive_folders parent
    join ancestry child on child.parent_id = parent.id
  )
  select exists (
    select 1
    from ancestry folder
    where public.is_organization_member(folder.organization_id, coalesce(p_user_id, auth.uid()))
      and (
        (folder.parent_id is null and folder.visibility = 'shared' and folder.name = 'Shared')
        or folder.owner_id = coalesce(p_user_id, auth.uid())
        or exists (
          select 1
          from public.drive_folder_members members
          where members.organization_id = folder.organization_id
            and members.folder_id = folder.id
            and members.member_id = coalesce(p_user_id, auth.uid())
        )
      )
  );
$$;

drop policy if exists "drive folder members select" on public.drive_folder_members;
create policy "drive folder members select"
on public.drive_folder_members
for select
to authenticated
using (public.drive_folder_can_access(folder_id));

drop policy if exists "drive folders active organization access" on public.drive_folders;
drop policy if exists "drive folders active organization select" on public.drive_folders;
drop policy if exists "drive folders active organization insert" on public.drive_folders;
drop policy if exists "drive folders active organization update" on public.drive_folders;
drop policy if exists "drive folders active organization delete" on public.drive_folders;
drop policy if exists "drive folders organization access" on public.drive_folders;
create policy "drive folders active organization select"
on public.drive_folders
for select
to authenticated
using (public.drive_folder_can_access(id));
create policy "drive folders active organization insert"
on public.drive_folders
for insert
to authenticated
with check (
  public.is_active_organization_member(organization_id)
  and (visibility = 'shared' or owner_id = auth.uid())
);
create policy "drive folders active organization update"
on public.drive_folders
for update
to authenticated
using (
  public.is_active_organization_member(organization_id)
  and (visibility = 'shared' or owner_id = auth.uid())
)
with check (
  public.is_active_organization_member(organization_id)
  and (visibility = 'shared' or owner_id = auth.uid())
);
create policy "drive folders active organization delete"
on public.drive_folders
for delete
to authenticated
using (
  public.is_active_organization_member(organization_id)
  and (visibility = 'shared' or owner_id = auth.uid())
);

drop policy if exists "drive documents active organization access" on public.drive_documents;
drop policy if exists "drive documents active organization select" on public.drive_documents;
drop policy if exists "drive documents active organization insert" on public.drive_documents;
drop policy if exists "drive documents active organization update" on public.drive_documents;
drop policy if exists "drive documents active organization delete" on public.drive_documents;
drop policy if exists "drive documents organization access" on public.drive_documents;
create policy "drive documents active organization select"
on public.drive_documents
for select
to authenticated
using (
  exists (
    select 1
    from public.drive_folders f
    where f.id = folder_id
      and public.drive_folder_can_access(f.id)
  )
);
create policy "drive documents active organization insert"
on public.drive_documents
for insert
to authenticated
with check (
  exists (
    select 1
    from public.drive_folders f
    where f.id = folder_id
      and public.is_active_organization_member(f.organization_id)
      and (visibility = 'shared' or owner_id = auth.uid())
  )
);
create policy "drive documents active organization update"
on public.drive_documents
for update
to authenticated
using (
  exists (
    select 1
    from public.drive_folders f
    where f.id = folder_id
      and public.is_active_organization_member(f.organization_id)
      and (visibility = 'shared' or owner_id = auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.drive_folders f
    where f.id = folder_id
      and public.is_active_organization_member(f.organization_id)
      and (visibility = 'shared' or owner_id = auth.uid())
  )
);
create policy "drive documents active organization delete"
on public.drive_documents
for delete
to authenticated
using (
  exists (
    select 1
    from public.drive_folders f
    where f.id = folder_id
      and public.is_active_organization_member(f.organization_id)
      and (visibility = 'shared' or owner_id = auth.uid())
  )
);

create or replace function public.replace_drive_folder_members(
  p_folder_id uuid,
  p_member_ids uuid[] default '{}'::uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_active_organization_id uuid := public.current_active_organization_id();
  v_folder record;
  v_member_ids uuid[] := coalesce(p_member_ids, '{}'::uuid[]);
  v_invalid_member_count integer;
begin
  if v_actor_id is null then
    raise exception 'Not authenticated';
  end if;

  if v_active_organization_id is null then
    raise exception 'Select an organization before sharing a folder';
  end if;

  select id, organization_id, owner_id, parent_id, visibility, name
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

  if v_folder.parent_id is null and v_folder.visibility = 'shared' and v_folder.name = 'Shared' then
    raise exception 'The shared root folder cannot be shared';
  end if;

  if v_folder.owner_id <> v_actor_id then
    raise exception 'Only the folder owner can share access';
  end if;

  select count(*)
  into v_invalid_member_count
  from unnest(v_member_ids) as member_id
  where member_id is not null
    and member_id <> v_actor_id
    and not public.is_organization_member(v_active_organization_id, member_id);

  if v_invalid_member_count > 0 then
    raise exception 'Folder members must belong to the active organization';
  end if;

  select coalesce(array_agg(distinct member_id), '{}'::uuid[])
  into v_member_ids
  from unnest(v_member_ids) as member_id
  where member_id is not null
    and member_id <> v_actor_id;

  delete from public.drive_folder_members
  where organization_id = v_active_organization_id
    and folder_id = p_folder_id
    and member_id <> all(v_member_ids);

  if coalesce(array_length(v_member_ids, 1), 0) > 0 then
    insert into public.drive_folder_members (
      organization_id,
      folder_id,
      member_id,
      granted_by
    )
    select
      v_active_organization_id,
      p_folder_id,
      member_id,
      v_actor_id
    from unnest(v_member_ids) as member_id
    on conflict (organization_id, folder_id, member_id) do update
    set granted_by = excluded.granted_by,
        updated_at = timezone('utc', now());
  end if;
end;
$$;

revoke all on function public.replace_drive_folder_members(uuid, uuid[]) from public;
grant execute on function public.replace_drive_folder_members(uuid, uuid[]) to authenticated;

comment on function public.replace_drive_folder_members(uuid, uuid[]) is
  'Replaces the explicit member access list for a folder in the active organization.';

notify pgrst, 'reload schema';
