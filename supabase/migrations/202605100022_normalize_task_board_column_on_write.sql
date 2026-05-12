create or replace function public.normalize_task_status_id_on_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status_key text := null;
begin
  if new.status_id is not null then
    select s.key
    into v_status_key
    from public.status s
    where s.id = new.status_id
      and s.organization_id = new.organization_id
      and (s.project_id is null or s.project_id = new.project_id)
    limit 1;

    if not found then
      new.status_id := null;
      v_status_key := null;
    end if;
  end if;

  if v_status_key is null then
    v_status_key := nullif(lower(btrim(coalesce(new.status, ''))), '');
  end if;

  if new.board_column is not null
     and not exists (
       select 1
       from public.boards b
       where b.id = new.board_column
     ) then
    new.board_column := case v_status_key
      when 'planned' then 'planned'
      when 'in_progress' then 'in_progress'
      when 'review' then 'review'
      when 'blocked' then 'blocked'
      else null
    end;
  end if;

  return new;
end;
$$;

notify pgrst, 'reload schema';
