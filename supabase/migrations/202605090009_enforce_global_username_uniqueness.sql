create or replace function public.normalize_username(value text)
returns text
language sql
immutable
as $$
  select coalesce(nullif(regexp_replace(lower(coalesce(value, '')), '[^a-z0-9]+', '', 'g'), ''), 'user');
$$;

create or replace function public.generate_unique_username(base_value text, profile_id uuid default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  base_username text := public.normalize_username(base_value);
  candidate text := base_username;
  suffix integer := 0;
begin
  while exists (
    select 1
    from public.profiles p
    where lower(p.username) = lower(candidate)
      and (profile_id is null or p.id <> profile_id)
  ) loop
    suffix := suffix + 1;
    candidate := base_username || suffix::text;
  end loop;

  return candidate;
end;
$$;

create or replace function public.set_profile_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.username := public.generate_unique_username(
    coalesce(new.username, new.full_name, split_part(new.email, '@', 1)),
    new.id
  );

  if new.onboarding_step = 'invite' then
    new.onboarding_step := 'tools';
  end if;

  return new;
end;
$$;

with normalized_profiles as (
  select
    p.id,
    public.normalize_username(coalesce(p.username, p.full_name, split_part(p.email, '@', 1), p.id::text)) as base_username,
    row_number() over (
      partition by public.normalize_username(coalesce(p.username, p.full_name, split_part(p.email, '@', 1), p.id::text))
      order by p.created_at asc nulls last, p.id asc
    ) as username_rank
  from public.profiles p
),
deduplicated_profiles as (
  select
    id,
    case
      when username_rank = 1 then base_username
      else base_username || username_rank::text
    end as next_username
  from normalized_profiles
)
update public.profiles p
set username = d.next_username
from deduplicated_profiles d
where p.id = d.id
  and p.username is distinct from d.next_username;

drop index if exists public.profiles_username_key;

create unique index if not exists profiles_username_global_unique
  on public.profiles (lower(username))
  where username is not null;

notify pgrst, 'reload schema';
