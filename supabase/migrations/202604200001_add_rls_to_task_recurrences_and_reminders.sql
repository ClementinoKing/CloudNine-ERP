alter table public.task_recurrences enable row level security;
alter table public.task_reminders enable row level security;

drop policy if exists "authenticated users can view task recurrences" on public.task_recurrences;
drop policy if exists "task reminders select own" on public.task_reminders;

create policy "authenticated users can view task recurrences"
on public.task_recurrences
for select
using (auth.role() = 'authenticated');

create policy "task reminders select own"
on public.task_reminders
for select
using (
  auth.role() = 'authenticated'
  and user_id = auth.uid()
);
