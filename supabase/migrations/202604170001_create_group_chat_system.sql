create table if not exists public.chat_rooms (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  room_type text not null default 'group' check (room_type in ('group', 'direct')),
  is_public boolean not null default true,
  is_default boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  last_message_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.chat_room_members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  member_role text not null default 'member' check (member_role in ('owner', 'member')),
  last_read_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (room_id, user_id)
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  body text not null,
  reply_to_id uuid references public.chat_messages(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.chat_message_mentions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  mentioned_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  unique (message_id, mentioned_user_id)
);

create table if not exists public.chat_message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  storage_bucket text not null default 'chat-attachments',
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size_bytes bigint,
  attachment_kind text not null default 'file' check (attachment_kind in ('image', 'file')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_chat_rooms_slug on public.chat_rooms(slug);
create index if not exists idx_chat_rooms_last_message_at on public.chat_rooms(last_message_at desc);
create index if not exists idx_chat_room_members_room_id on public.chat_room_members(room_id);
create index if not exists idx_chat_room_members_user_id on public.chat_room_members(user_id);
create index if not exists idx_chat_messages_room_id_created_at on public.chat_messages(room_id, created_at desc);
create index if not exists idx_chat_messages_author_id on public.chat_messages(author_id);
create index if not exists idx_chat_message_mentions_message_id on public.chat_message_mentions(message_id);
create index if not exists idx_chat_message_mentions_mentioned_user_id on public.chat_message_mentions(mentioned_user_id);
create index if not exists idx_chat_message_attachments_message_id on public.chat_message_attachments(message_id);

create or replace function public.chat_user_can_access_room(
  p_room_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.chat_rooms r
    left join public.chat_room_members m
      on m.room_id = r.id
     and m.user_id = coalesce(p_user_id, auth.uid())
    where r.id = p_room_id
      and (
        r.is_public
        or r.created_by = coalesce(p_user_id, auth.uid())
        or m.user_id is not null
      )
  );
$$;

create or replace function public.set_chat_room_last_message_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_rooms
  set last_message_at = new.created_at,
      updated_at = new.created_at
  where id = new.room_id;
  return new;
end;
$$;

create or replace function public.create_chat_mention_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message record;
  v_author_name text;
  v_room_name text;
begin
  select
    m.id as message_id,
    m.room_id,
    m.author_id,
    m.body,
    r.name as room_name,
    p.full_name as author_full_name,
    p.username as author_username
  into v_message
  from public.chat_messages m
  join public.chat_rooms r on r.id = m.room_id
  left join public.profiles p on p.id = m.author_id
  where m.id = new.message_id;

  if not found then
    return new;
  end if;

  if new.mentioned_user_id is null or new.mentioned_user_id = v_message.author_id then
    return new;
  end if;

  v_author_name := coalesce(v_message.author_full_name, v_message.author_username, 'Someone');
  v_room_name := coalesce(v_message.room_name, 'Group Chat');

  insert into public.notifications (recipient_id, actor_id, type, title, message, metadata)
  values (
    new.mentioned_user_id,
    v_message.author_id,
    'mention',
    'You were mentioned',
    format('%s mentioned you in %s', v_author_name, v_room_name),
    jsonb_build_object(
      'chat_room_id', v_message.room_id,
      'chat_message_id', v_message.message_id,
      'chat_mention_id', new.id
    )
  );

  return new;
end;
$$;

drop trigger if exists set_chat_rooms_updated_at on public.chat_rooms;
create trigger set_chat_rooms_updated_at
before update on public.chat_rooms
for each row
execute function public.set_updated_at();

drop trigger if exists set_chat_room_members_updated_at on public.chat_room_members;
create trigger set_chat_room_members_updated_at
before update on public.chat_room_members
for each row
execute function public.set_updated_at();

drop trigger if exists set_chat_messages_updated_at on public.chat_messages;
create trigger set_chat_messages_updated_at
before update on public.chat_messages
for each row
execute function public.set_updated_at();

drop trigger if exists chat_rooms_last_message_at on public.chat_messages;
create trigger chat_rooms_last_message_at
after insert on public.chat_messages
for each row
execute function public.set_chat_room_last_message_at();

drop trigger if exists chat_mention_notifications on public.chat_message_mentions;
create trigger chat_mention_notifications
after insert on public.chat_message_mentions
for each row
execute function public.create_chat_mention_notification();

insert into public.chat_rooms (slug, name, description, room_type, is_public, is_default)
values (
  'general',
  'General',
  'A shared team room for quick updates, questions, and mentions.',
  'group',
  true,
  true
)
on conflict (slug) do update
set
  name = excluded.name,
  description = excluded.description,
  room_type = excluded.room_type,
  is_public = excluded.is_public,
  is_default = excluded.is_default;

alter table public.chat_rooms enable row level security;
alter table public.chat_room_members enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_message_mentions enable row level security;
alter table public.chat_message_attachments enable row level security;

drop policy if exists "chat rooms select visible" on public.chat_rooms;
drop policy if exists "chat rooms insert authenticated" on public.chat_rooms;
drop policy if exists "chat rooms update owner" on public.chat_rooms;
drop policy if exists "chat rooms delete owner" on public.chat_rooms;

create policy "chat rooms select visible"
on public.chat_rooms
for select
using (public.chat_user_can_access_room(id));

create policy "chat rooms insert authenticated"
on public.chat_rooms
for insert
with check (auth.role() = 'authenticated' and created_by = auth.uid());

create policy "chat rooms update owner"
on public.chat_rooms
for update
using (created_by = auth.uid())
with check (created_by = auth.uid());

create policy "chat rooms delete owner"
on public.chat_rooms
for delete
using (created_by = auth.uid());

drop policy if exists "chat room members select visible" on public.chat_room_members;
drop policy if exists "chat room members insert self or owner" on public.chat_room_members;
drop policy if exists "chat room members update self" on public.chat_room_members;
drop policy if exists "chat room members delete self or owner" on public.chat_room_members;

create policy "chat room members select visible"
on public.chat_room_members
for select
using (public.chat_user_can_access_room(room_id) or user_id = auth.uid());

create policy "chat room members insert self or owner"
on public.chat_room_members
for insert
with check (
  auth.role() = 'authenticated'
  and public.chat_user_can_access_room(room_id)
  and (
    user_id = auth.uid()
    or exists (
      select 1
      from public.chat_rooms r
      where r.id = room_id
        and r.created_by = auth.uid()
    )
  )
);

create policy "chat room members update self"
on public.chat_room_members
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "chat room members delete self or owner"
on public.chat_room_members
for delete
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.chat_rooms r
    where r.id = room_id
      and r.created_by = auth.uid()
  )
);

drop policy if exists "chat messages select visible" on public.chat_messages;
drop policy if exists "chat messages insert author" on public.chat_messages;
drop policy if exists "chat messages update author" on public.chat_messages;
drop policy if exists "chat messages delete author" on public.chat_messages;

create policy "chat messages select visible"
on public.chat_messages
for select
using (public.chat_user_can_access_room(room_id));

create policy "chat messages insert author"
on public.chat_messages
for insert
with check (
  auth.role() = 'authenticated'
  and author_id = auth.uid()
  and public.chat_user_can_access_room(room_id)
);

create policy "chat messages update author"
on public.chat_messages
for update
using (author_id = auth.uid())
with check (author_id = auth.uid());

create policy "chat messages delete author"
on public.chat_messages
for delete
using (author_id = auth.uid());

drop policy if exists "chat message mentions select visible" on public.chat_message_mentions;
drop policy if exists "chat message mentions insert author" on public.chat_message_mentions;

create policy "chat message mentions select visible"
on public.chat_message_mentions
for select
using (
  mentioned_user_id = auth.uid()
  or exists (
    select 1
    from public.chat_messages m
    where m.id = message_id
      and public.chat_user_can_access_room(m.room_id)
  )
);

create policy "chat message mentions insert author"
on public.chat_message_mentions
for insert
with check (
  auth.role() = 'authenticated'
  and exists (
    select 1
    from public.chat_messages m
    where m.id = message_id
      and m.author_id = auth.uid()
  )
);

drop policy if exists "chat message attachments select visible" on public.chat_message_attachments;
drop policy if exists "chat message attachments insert author" on public.chat_message_attachments;
drop policy if exists "chat message attachments delete author" on public.chat_message_attachments;

create policy "chat message attachments select visible"
on public.chat_message_attachments
for select
using (
  exists (
    select 1
    from public.chat_messages m
    where m.id = message_id
      and public.chat_user_can_access_room(m.room_id)
  )
);

create policy "chat message attachments insert author"
on public.chat_message_attachments
for insert
with check (
  auth.role() = 'authenticated'
  and exists (
    select 1
    from public.chat_messages m
    where m.id = message_id
      and m.author_id = auth.uid()
  )
);

create policy "chat message attachments delete author"
on public.chat_message_attachments
for delete
using (
  exists (
    select 1
    from public.chat_messages m
    where m.id = message_id
      and m.author_id = auth.uid()
  )
);

alter table public.chat_rooms replica identity full;
alter table public.chat_room_members replica identity full;
alter table public.chat_messages replica identity full;
alter table public.chat_message_mentions replica identity full;
alter table public.chat_message_attachments replica identity full;

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    execute 'alter publication supabase_realtime add table public.chat_rooms';
    execute 'alter publication supabase_realtime add table public.chat_room_members';
    execute 'alter publication supabase_realtime add table public.chat_messages';
    execute 'alter publication supabase_realtime add table public.chat_message_mentions';
    execute 'alter publication supabase_realtime add table public.chat_message_attachments';
  end if;
exception
  when duplicate_object then null;
end
$$;
