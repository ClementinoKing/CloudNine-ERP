create table if not exists public.user_presence_sessions (
  session_key text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  is_online boolean not null default true,
  last_seen_at timestamptz not null default now(),
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_presence_sessions_user_id on public.user_presence_sessions (user_id);
create index if not exists idx_user_presence_sessions_last_seen_at on public.user_presence_sessions (last_seen_at desc);

create or replace function public.set_user_presence_sessions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_user_presence_sessions_updated_at on public.user_presence_sessions;
create trigger set_user_presence_sessions_updated_at
before update on public.user_presence_sessions
for each row
execute function public.set_user_presence_sessions_updated_at();

alter table public.user_presence_sessions enable row level security;

create policy "Presence sessions are readable by authenticated users"
on public.user_presence_sessions
for select
using (auth.role() = 'authenticated');

create policy "Users can insert own presence session"
on public.user_presence_sessions
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update own presence session"
on public.user_presence_sessions
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own presence session"
on public.user_presence_sessions
for delete
to authenticated
using (auth.uid() = user_id);

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    execute 'alter publication supabase_realtime add table public.user_presence_sessions';
  end if;
exception
  when duplicate_object then null;
end
$$;
