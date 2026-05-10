create or replace function public.check_username_availability(
  p_username text,
  p_profile_id uuid default auth.uid()
)
returns table (
  username text,
  available boolean,
  suggested_username text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text := public.normalize_username(p_username);
  v_candidate text := v_username;
  v_suffix integer := 0;
begin
  if p_profile_id is null then
    raise exception 'You must be signed in to check username availability'
      using errcode = '28000';
  end if;

  while exists (
    select 1
    from public.profiles p
    where lower(p.username) = lower(v_candidate)
      and p.id <> p_profile_id
  ) loop
    v_suffix := v_suffix + 1;
    v_candidate := v_username || v_suffix::text;
  end loop;

  return query
  select
    v_username::text as username,
    (v_candidate = v_username)::boolean as available,
    v_candidate::text as suggested_username;
end;
$$;

grant execute on function public.check_username_availability(text, uuid) to authenticated;

notify pgrst, 'reload schema';
