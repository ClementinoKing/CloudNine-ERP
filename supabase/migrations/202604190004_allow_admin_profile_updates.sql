alter table public.profiles enable row level security;

drop policy if exists "profiles update admin" on public.profiles;

create policy "profiles update admin"
on public.profiles
for update
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role_label, '')) = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role_label, '')) = 'admin'
  )
);
