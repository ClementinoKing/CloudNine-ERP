alter table public.profiles
  add column if not exists out_of_office boolean not null default false,
  add column if not exists out_of_office_start timestamptz,
  add column if not exists out_of_office_end timestamptz;

alter table public.profiles
  drop column if exists pronouns,
  drop column if exists onboarding_completed,
  drop column if exists onboarding_step,
  drop column if exists onboarding_role,
  drop column if exists onboarding_work_function,
  drop column if exists onboarding_use_case,
  drop column if exists onboarding_tools;

create or replace function public.set_profile_defaults()
returns trigger
language plpgsql
as $$
begin
  new.username := public.generate_unique_username(coalesce(new.username, new.full_name, split_part(new.email, '@', 1)), new.id);
  return new;
end;
$$;

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  metadata jsonb;
begin
  metadata := coalesce(new.raw_user_meta_data, '{}'::jsonb);

  insert into public.profiles (
    id,
    full_name,
    username,
    email,
    avatar_url,
    out_of_office
  )
  values (
    new.id,
    nullif(metadata ->> 'full_name', ''),
    nullif(metadata ->> 'username', ''),
    new.email,
    nullif(metadata ->> 'avatar_path', ''),
    false
  )
  on conflict (id) do nothing;

  return new;
end;
$$;
