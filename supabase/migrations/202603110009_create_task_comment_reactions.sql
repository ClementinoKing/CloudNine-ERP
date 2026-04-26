create table if not exists public.task_comment_reactions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.task_comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null default 'like' check (reaction in ('like')),
  created_at timestamptz not null default timezone('utc', now()),
  unique (comment_id, user_id, reaction)
);

create index if not exists idx_task_comment_reactions_comment_id on public.task_comment_reactions(comment_id);
create index if not exists idx_task_comment_reactions_user_id on public.task_comment_reactions(user_id);

alter table public.task_comment_reactions enable row level security;

drop policy if exists "task comment reactions select" on public.task_comment_reactions;
drop policy if exists "task comment reactions insert" on public.task_comment_reactions;
drop policy if exists "task comment reactions delete" on public.task_comment_reactions;

create policy "task comment reactions select"
on public.task_comment_reactions
for select
using (
  exists (
    select 1
    from public.task_comments c
    join public.tasks t on t.id = c.task_id
    where c.id = task_comment_reactions.comment_id
      and (
        t.created_by = auth.uid()
        or t.assigned_to = auth.uid()
        or exists (
          select 1
          from public.task_assignees ta
          where ta.task_id = t.id
            and ta.assignee_id = auth.uid()
        )
      )
  )
);

create policy "task comment reactions insert"
on public.task_comment_reactions
for insert
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.task_comments c
    join public.tasks t on t.id = c.task_id
    where c.id = task_comment_reactions.comment_id
      and (
        t.created_by = auth.uid()
        or t.assigned_to = auth.uid()
        or exists (
          select 1
          from public.task_assignees ta
          where ta.task_id = t.id
            and ta.assignee_id = auth.uid()
        )
      )
  )
);

create policy "task comment reactions delete"
on public.task_comment_reactions
for delete
using (user_id = auth.uid());
