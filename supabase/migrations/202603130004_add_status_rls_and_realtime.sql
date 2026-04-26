alter table public.status enable row level security;
alter table public.status replica identity full;

drop policy if exists "status select scoped" on public.status;
drop policy if exists "status insert scoped" on public.status;
drop policy if exists "status update scoped" on public.status;
drop policy if exists "status delete scoped" on public.status;

create policy "status select scoped"
on public.status
for select
using (
  auth.role() = 'authenticated'
  and (
    project_id is null
    or exists (
      select 1
      from public.projects p
      where p.id = status.project_id
        and (
          p.created_by = auth.uid()
          or p.owner_id = auth.uid()
          or exists (
            select 1
            from public.tasks t
            left join public.task_assignees ta on ta.task_id = t.id
            where t.project_id = p.id
              and (t.assigned_to = auth.uid() or ta.assignee_id = auth.uid())
          )
        )
    )
  )
);

create policy "status insert scoped"
on public.status
for insert
with check (
  auth.role() = 'authenticated'
  and project_id is not null
  and exists (
    select 1
    from public.projects p
    where p.id = status.project_id
      and (p.created_by = auth.uid() or p.owner_id = auth.uid())
  )
);

create policy "status update scoped"
on public.status
for update
using (
  auth.role() = 'authenticated'
  and project_id is not null
  and exists (
    select 1
    from public.projects p
    where p.id = status.project_id
      and (p.created_by = auth.uid() or p.owner_id = auth.uid())
  )
)
with check (
  auth.role() = 'authenticated'
  and project_id is not null
  and exists (
    select 1
    from public.projects p
    where p.id = status.project_id
      and (p.created_by = auth.uid() or p.owner_id = auth.uid())
  )
);

create policy "status delete scoped"
on public.status
for delete
using (
  auth.role() = 'authenticated'
  and project_id is not null
  and exists (
    select 1
    from public.projects p
    where p.id = status.project_id
      and (p.created_by = auth.uid() or p.owner_id = auth.uid())
  )
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'status'
  ) then
    alter publication supabase_realtime add table public.status;
  end if;
end;
$$;
