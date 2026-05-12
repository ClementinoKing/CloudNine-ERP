create or replace function public.ensure_organization_shared_drive_root(
  p_organization_id uuid,
  p_created_by uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_organization_id is null then
    return;
  end if;

  insert into public.drive_folders (
    organization_id,
    parent_id,
    owner_id,
    visibility,
    name,
    sort_order,
    created_by,
    created_at,
    updated_at
  )
  select
    p_organization_id,
    null,
    null,
    'shared',
    'Shared',
    0,
    p_created_by,
    timezone('utc', now()),
    timezone('utc', now())
  where not exists (
    select 1
    from public.drive_folders f
    where f.organization_id = p_organization_id
      and f.parent_id is null
      and f.visibility = 'shared'
      and f.name = 'Shared'
      and f.deleted_at is null
  );
end;
$$;

create or replace function public.handle_new_organization_shared_drive_root()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_organization_shared_drive_root(new.id, new.created_by);
  return new;
end;
$$;

drop trigger if exists ensure_organization_shared_drive_root on public.organizations;
create trigger ensure_organization_shared_drive_root
after insert on public.organizations
for each row
execute function public.handle_new_organization_shared_drive_root();

insert into public.drive_folders (
  organization_id,
  parent_id,
  owner_id,
  visibility,
  name,
  sort_order,
  created_by,
  created_at,
  updated_at
)
select
  org.id,
  null,
  null,
  'shared',
  'Shared',
  0,
  org.created_by,
  timezone('utc', now()),
  timezone('utc', now())
from public.organizations org
where not exists (
  select 1
  from public.drive_folders f
  where f.organization_id = org.id
    and f.parent_id is null
    and f.visibility = 'shared'
    and f.name = 'Shared'
    and f.deleted_at is null
);

notify pgrst, 'reload schema';
