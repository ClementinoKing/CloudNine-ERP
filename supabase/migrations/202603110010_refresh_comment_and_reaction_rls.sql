alter table public.task_comments enable row level security;
alter table public.task_comment_reactions enable row level security;

drop policy if exists "task comments select scoped" on public.task_comments;
drop policy if exists "task comments insert scoped" on public.task_comments;
drop policy if exists "task comments update scoped" on public.task_comments;
drop policy if exists "task comments delete scoped" on public.task_comments;
drop policy if exists "task comments select authenticated" on public.task_comments;
drop policy if exists "task comments insert authenticated" on public.task_comments;
drop policy if exists "task comments update authenticated" on public.task_comments;
drop policy if exists "task comments delete authenticated" on public.task_comments;

create policy "task comments select authenticated"
on public.task_comments
for select
using (auth.role() = 'authenticated');

create policy "task comments insert authenticated"
on public.task_comments
for insert
with check (auth.role() = 'authenticated' and author_id = auth.uid());

create policy "task comments update authenticated"
on public.task_comments
for update
using (author_id = auth.uid())
with check (author_id = auth.uid());

create policy "task comments delete authenticated"
on public.task_comments
for delete
using (author_id = auth.uid());

drop policy if exists "task comment reactions select" on public.task_comment_reactions;
drop policy if exists "task comment reactions insert" on public.task_comment_reactions;
drop policy if exists "task comment reactions delete" on public.task_comment_reactions;
drop policy if exists "task comment reactions select authenticated" on public.task_comment_reactions;
drop policy if exists "task comment reactions insert authenticated" on public.task_comment_reactions;
drop policy if exists "task comment reactions delete authenticated" on public.task_comment_reactions;

create policy "task comment reactions select authenticated"
on public.task_comment_reactions
for select
using (auth.role() = 'authenticated');

create policy "task comment reactions insert authenticated"
on public.task_comment_reactions
for insert
with check (auth.role() = 'authenticated' and user_id = auth.uid());

create policy "task comment reactions delete authenticated"
on public.task_comment_reactions
for delete
using (user_id = auth.uid());
