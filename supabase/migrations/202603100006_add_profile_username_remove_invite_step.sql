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
as $$
declare
  base_username text := public.normalize_username(base_value);
  candidate text := base_username;
begin
  while exists (
    select 1
    from public.profiles
    where username = candidate
      and (profile_id is null or id <> profile_id)
  ) loop
    candidate := base_username || substr(gen_random_uuid()::text, 1, 4);
  end loop;

  return candidate;
end;
$$;

alter table public.profiles add column if not exists username text;

update public.profiles
set username = public.generate_unique_username(coalesce(username, full_name, split_part(email, '@', 1)), id)
where username is null or btrim(username) = '';

update public.profiles
set onboarding_step = 'tools'
where onboarding_step = 'invite';

alter table public.profiles
  drop constraint if exists profiles_onboarding_step_check;

alter table public.profiles
  add constraint profiles_onboarding_step_check
  check (onboarding_step in ('name', 'work', 'tools'));

create unique index if not exists profiles_username_key on public.profiles (username);

create or replace function public.set_profile_defaults()
returns trigger
language plpgsql
as $$
begin
  new.username := public.generate_unique_username(coalesce(new.username, new.full_name, split_part(new.email, '@', 1)), new.id);

  if new.onboarding_step = 'invite' then
    new.onboarding_step := 'tools';
  end if;

  return new;
end;
$$;

drop trigger if exists set_profiles_defaults on public.profiles;
create trigger set_profiles_defaults
before insert or update on public.profiles
for each row execute function public.set_profile_defaults();
