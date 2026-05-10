create or replace function public.can_access_organization(
  p_organization_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_organization_id is not null
    and coalesce(p_user_id, auth.uid()) is not null
    and (
      exists (
        select 1
        from public.organization_members om
        where om.organization_id = p_organization_id
          and om.user_id = coalesce(p_user_id, auth.uid())
      )
      or exists (
        select 1
        from public.profiles p
        where p.id = coalesce(p_user_id, auth.uid())
          and (
            p.organization_id = p_organization_id
            or p.active_organization_id = p_organization_id
          )
      )
    );
$$;

create or replace function public.ensure_organization_group_chat_room(
  p_organization_id uuid
)
returns table (
  id uuid,
  slug text,
  name text,
  description text,
  last_message_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_room_id uuid;
begin
  if v_user_id is null then
    raise exception 'You must be signed in to open the group chat'
      using errcode = '28000';
  end if;

  if not public.can_access_organization(p_organization_id, v_user_id) then
    raise exception 'You do not have access to this organization chat'
      using errcode = '42501';
  end if;

  insert into public.chat_rooms (
    organization_id,
    slug,
    name,
    description,
    room_type,
    is_public,
    is_default,
    created_by
  )
  values (
    p_organization_id,
    'general',
    'General',
    'A shared team room for quick updates, questions, and mentions.',
    'group',
    true,
    true,
    v_user_id
  )
  on conflict (organization_id, slug) do update
  set
    name = excluded.name,
    description = excluded.description,
    room_type = excluded.room_type,
    is_public = excluded.is_public,
    is_default = excluded.is_default
  returning chat_rooms.id into v_room_id;

  insert into public.chat_room_members (room_id, user_id, member_role, last_read_at)
  values (v_room_id, v_user_id, 'member', timezone('utc', now()))
  on conflict (room_id, user_id) do nothing;

  return query
  select r.id, r.slug, r.name, r.description, r.last_message_at
  from public.chat_rooms r
  where r.id = v_room_id;
end;
$$;

grant execute on function public.ensure_organization_group_chat_room(uuid) to authenticated;

drop policy if exists "chat rooms organization access" on public.chat_rooms;

create policy "chat rooms select organization"
on public.chat_rooms
for select
to authenticated
using (public.can_access_organization(organization_id));

create policy "chat rooms insert organization default"
on public.chat_rooms
for insert
to authenticated
with check (
  created_by = auth.uid()
  and public.can_access_organization(organization_id)
);

create policy "chat rooms update organization creator or admin"
on public.chat_rooms
for update
to authenticated
using (
  created_by = auth.uid()
  or public.is_organization_admin(organization_id)
)
with check (
  public.can_access_organization(organization_id)
  and (
    created_by = auth.uid()
    or public.is_organization_admin(organization_id)
  )
);

create policy "chat rooms delete organization admin"
on public.chat_rooms
for delete
to authenticated
using (public.is_organization_admin(organization_id));
