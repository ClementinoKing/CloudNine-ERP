alter table public.notifications enable row level security;

drop policy if exists "notifications select own" on public.notifications;

create policy "notifications select recipient_or_actor"
on public.notifications
for select
using (
  recipient_id = auth.uid()
  or actor_id = auth.uid()
);
