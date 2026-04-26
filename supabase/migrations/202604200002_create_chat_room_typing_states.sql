create table if not exists public.chat_room_typing_states (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  is_typing boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (room_id, user_id)
);

create index if not exists idx_chat_room_typing_states_room_id on public.chat_room_typing_states(room_id);
create index if not exists idx_chat_room_typing_states_user_id on public.chat_room_typing_states(user_id);
create index if not exists idx_chat_room_typing_states_updated_at on public.chat_room_typing_states(updated_at desc);

drop trigger if exists set_chat_room_typing_states_updated_at on public.chat_room_typing_states;
create trigger set_chat_room_typing_states_updated_at
before update on public.chat_room_typing_states
for each row
execute function public.set_updated_at();

alter table public.chat_room_typing_states enable row level security;

drop policy if exists "chat room typing states select visible" on public.chat_room_typing_states;
drop policy if exists "chat room typing states insert self" on public.chat_room_typing_states;
drop policy if exists "chat room typing states update self" on public.chat_room_typing_states;
drop policy if exists "chat room typing states delete self" on public.chat_room_typing_states;

create policy "chat room typing states select visible"
on public.chat_room_typing_states
for select
using (
  auth.role() = 'authenticated'
  and public.chat_user_can_access_room(room_id)
);

create policy "chat room typing states insert self"
on public.chat_room_typing_states
for insert
with check (
  auth.role() = 'authenticated'
  and user_id = auth.uid()
  and public.chat_user_can_access_room(room_id)
);

create policy "chat room typing states update self"
on public.chat_room_typing_states
for update
using (
  user_id = auth.uid()
  and public.chat_user_can_access_room(room_id)
)
with check (
  user_id = auth.uid()
  and public.chat_user_can_access_room(room_id)
);

create policy "chat room typing states delete self"
on public.chat_room_typing_states
for delete
using (
  user_id = auth.uid()
  and public.chat_user_can_access_room(room_id)
);

alter table public.chat_room_typing_states replica identity full;

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    execute 'alter publication supabase_realtime add table public.chat_room_typing_states';
  end if;
exception
  when duplicate_object then null;
end
$$;
