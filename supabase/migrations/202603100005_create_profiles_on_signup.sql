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
    onboarding_completed,
    onboarding_step,
    onboarding_role,
    onboarding_work_function,
    onboarding_use_case,
    onboarding_tools
  )
  values (
    new.id,
    nullif(metadata ->> 'full_name', ''),
    nullif(metadata ->> 'username', ''),
    new.email,
    nullif(metadata ->> 'avatar_path', ''),
    coalesce((metadata -> 'onboarding' ->> 'completed')::boolean, false),
    case
      when coalesce(nullif(metadata -> 'onboarding' ->> 'currentStep', ''), 'name') = 'invite' then 'tools'
      else coalesce(nullif(metadata -> 'onboarding' ->> 'currentStep', ''), 'name')
    end,
    nullif(metadata -> 'onboarding' ->> 'role', ''),
    nullif(metadata -> 'onboarding' ->> 'workFunction', ''),
    nullif(metadata -> 'onboarding' ->> 'useCase', ''),
    coalesce(
      array(
        select jsonb_array_elements_text(coalesce(metadata -> 'onboarding' -> 'tools', '[]'::jsonb))
      ),
      '{}'::text[]
    )
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function public.handle_new_user_profile();

insert into public.profiles (
  id,
  full_name,
  username,
  email,
  avatar_url,
  onboarding_completed,
  onboarding_step,
  onboarding_role,
  onboarding_work_function,
  onboarding_use_case,
  onboarding_tools
)
select
  users.id,
  nullif(users.raw_user_meta_data ->> 'full_name', ''),
  nullif(users.raw_user_meta_data ->> 'username', ''),
  users.email,
  nullif(users.raw_user_meta_data ->> 'avatar_path', ''),
  coalesce((users.raw_user_meta_data -> 'onboarding' ->> 'completed')::boolean, false),
  case
    when coalesce(nullif(users.raw_user_meta_data -> 'onboarding' ->> 'currentStep', ''), 'name') = 'invite' then 'tools'
    else coalesce(nullif(users.raw_user_meta_data -> 'onboarding' ->> 'currentStep', ''), 'name')
  end,
  nullif(users.raw_user_meta_data -> 'onboarding' ->> 'role', ''),
  nullif(users.raw_user_meta_data -> 'onboarding' ->> 'workFunction', ''),
  nullif(users.raw_user_meta_data -> 'onboarding' ->> 'useCase', ''),
  coalesce(
    array(
      select jsonb_array_elements_text(coalesce(users.raw_user_meta_data -> 'onboarding' -> 'tools', '[]'::jsonb))
    ),
    '{}'::text[]
  )
from auth.users users
left join public.profiles profiles on profiles.id = users.id
where profiles.id is null;
