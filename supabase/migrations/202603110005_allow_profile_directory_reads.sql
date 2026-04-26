alter table public.profiles enable row level security;

drop policy if exists "profiles select self" on public.profiles;

create policy "profiles select authenticated"
on public.profiles
for select
using (auth.role() = 'authenticated');
