create or replace function public.normalize_task_status_id_on_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status_id is null then
    return new;
  end if;

  if exists (
    select 1
    from public.status s
    where s.id = new.status_id
      and s.organization_id = new.organization_id
      and (s.project_id is null or s.project_id = new.project_id)
  ) then
    return new;
  end if;

  new.status_id := null;
  return new;
end;
$$;

drop trigger if exists normalize_task_status_id_on_write on public.tasks;
create trigger normalize_task_status_id_on_write
before insert or update on public.tasks
for each row
execute function public.normalize_task_status_id_on_write();
