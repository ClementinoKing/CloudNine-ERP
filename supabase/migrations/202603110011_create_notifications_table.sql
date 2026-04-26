create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  task_id uuid references public.tasks(id) on delete cascade,
  type text not null check (type in ('task', 'mention', 'system')),
  title text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_notifications_recipient_created_at
  on public.notifications(recipient_id, created_at desc);

create index if not exists idx_notifications_task_id
  on public.notifications(task_id);

alter table public.notifications enable row level security;

drop policy if exists "notifications select own" on public.notifications;
drop policy if exists "notifications insert authenticated" on public.notifications;
drop policy if exists "notifications update own" on public.notifications;
drop policy if exists "notifications delete own" on public.notifications;

create policy "notifications select own"
on public.notifications
for select
using (recipient_id = auth.uid());

create policy "notifications insert authenticated"
on public.notifications
for insert
with check (
  auth.role() = 'authenticated'
  and actor_id = auth.uid()
);

create policy "notifications update own"
on public.notifications
for update
using (recipient_id = auth.uid())
with check (recipient_id = auth.uid());

create policy "notifications delete own"
on public.notifications
for delete
using (recipient_id = auth.uid());
