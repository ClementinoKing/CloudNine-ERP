-- Move projects fully onto organization ownership.
-- Projects should no longer rely on workspace membership or workspace foreign keys.

alter table public.projects
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

update public.projects p
set organization_id = coalesce(
  p.organization_id,
  (select w.organization_id from public.workspaces w where w.id = p.workspace_id),
  (select creator.organization_id from public.profiles creator where creator.id = p.created_by),
  (select owner.organization_id from public.profiles owner where owner.id = p.owner_id),
  (select id from public.organizations order by created_at asc limit 1)
)
where p.organization_id is null;

alter table public.projects
  alter column organization_id set not null;

create index if not exists idx_projects_organization_id on public.projects(organization_id);

alter table public.projects
  drop column if exists workspace_id;

create or replace function public.resolve_row_organization_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_default_organization_id constant uuid := '11111111-1111-1111-1111-111111111111';
  v_user_organization_id uuid;
begin
  if new.organization_id is not null then
    return new;
  end if;

  v_user_organization_id := public.current_user_default_organization_id();

  case tg_table_name
    when 'profiles' then
      new.organization_id := coalesce(v_user_organization_id, v_default_organization_id);
    when 'projects' then
      if new.created_by is not null then
        select p.organization_id into new.organization_id
        from public.profiles p
        where p.id = new.created_by;
      end if;
      if new.organization_id is null and new.owner_id is not null then
        select p.organization_id into new.organization_id
        from public.profiles p
        where p.id = new.owner_id;
      end if;
      new.organization_id := coalesce(new.organization_id, v_user_organization_id);
    when 'tasks' then
      select p.organization_id into new.organization_id
      from public.projects p
      where p.id = new.project_id;
      if new.organization_id is null then
        select w.organization_id into new.organization_id
        from public.workspaces w
        where w.id = new.workspace_id;
      end if;
      new.organization_id := coalesce(new.organization_id, v_user_organization_id, v_default_organization_id);
    when 'status' then
      select p.organization_id into new.organization_id
      from public.projects p
      where p.id = new.project_id;
      new.organization_id := coalesce(new.organization_id, v_user_organization_id, v_default_organization_id);
    when 'notifications' then
      select t.organization_id into new.organization_id
      from public.tasks t
      where t.id = new.task_id;
      if new.organization_id is null then
        select p.organization_id into new.organization_id
        from public.profiles p
        where p.id = new.recipient_id;
      end if;
      if new.organization_id is null then
        select p.organization_id into new.organization_id
        from public.profiles p
        where p.id = new.actor_id;
      end if;
      new.organization_id := coalesce(new.organization_id, v_user_organization_id, v_default_organization_id);
    when 'notification_email_deliveries' then
      select n.organization_id into new.organization_id
      from public.notifications n
      where n.id = new.notification_id;
      new.organization_id := coalesce(new.organization_id, v_user_organization_id, v_default_organization_id);
    when 'user_presence_sessions' then
      select p.organization_id into new.organization_id
      from public.profiles p
      where p.id = new.user_id;
      new.organization_id := coalesce(new.organization_id, v_user_organization_id, v_default_organization_id);
    when 'task_recurrences' then
      select t.organization_id into new.organization_id
      from public.tasks t
      where t.id = new.source_task_id;
      new.organization_id := coalesce(new.organization_id, v_user_organization_id, v_default_organization_id);
    when 'task_reminders' then
      select t.organization_id into new.organization_id
      from public.tasks t
      where t.id = new.task_id;
      new.organization_id := coalesce(new.organization_id, v_user_organization_id, v_default_organization_id);
    when 'drive_folders' then
      select f.organization_id into new.organization_id
      from public.drive_folders f
      where f.id = new.parent_id;
      new.organization_id := coalesce(new.organization_id, v_user_organization_id, v_default_organization_id);
    else
      new.organization_id := coalesce(new.organization_id, v_user_organization_id, v_default_organization_id);
  end case;

  if new.organization_id is null then
    raise exception 'organization_id is required for table %', tg_table_name
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop policy if exists "projects select scoped" on public.projects;
drop policy if exists "projects insert self" on public.projects;
drop policy if exists "projects update scoped" on public.projects;
drop policy if exists "projects delete scoped" on public.projects;
drop policy if exists "projects select authenticated" on public.projects;
drop policy if exists "projects active organization access" on public.projects;
drop policy if exists "projects organization access" on public.projects;
create policy "projects active organization access"
on public.projects
for all
to authenticated
using (public.is_active_organization_member(organization_id))
with check (public.is_active_organization_member(organization_id));

notify pgrst, 'reload schema';
