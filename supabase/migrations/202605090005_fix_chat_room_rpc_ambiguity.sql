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

  select cr.id
  into v_room_id
  from public.chat_rooms cr
  where cr.organization_id = p_organization_id
    and cr.slug = 'general'
  limit 1;

  if v_room_id is null then
    begin
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
      returning chat_rooms.id into v_room_id;
    exception
      when unique_violation then
        select cr.id
        into v_room_id
        from public.chat_rooms cr
        where cr.organization_id = p_organization_id
          and cr.slug = 'general'
        limit 1;
    end;
  else
    update public.chat_rooms cr
    set
      name = 'General',
      description = 'A shared team room for quick updates, questions, and mentions.',
      room_type = 'group',
      is_public = true,
      is_default = true
    where cr.id = v_room_id;
  end if;

  if v_room_id is null then
    raise exception 'Unable to create organization group chat room'
      using errcode = 'P0001';
  end if;

  insert into public.chat_room_members (room_id, user_id, member_role, last_read_at)
  values (v_room_id, v_user_id, 'member', timezone('utc', now()))
  on conflict (room_id, user_id) do nothing;

  return query
  select cr.id, cr.slug, cr.name, cr.description, cr.last_message_at
  from public.chat_rooms cr
  where cr.id = v_room_id;
end;
$$;

grant execute on function public.ensure_organization_group_chat_room(uuid) to authenticated;
