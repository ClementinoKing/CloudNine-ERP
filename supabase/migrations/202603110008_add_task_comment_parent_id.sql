alter table public.task_comments
add column if not exists parent_comment_id uuid references public.task_comments(id) on delete cascade;

create index if not exists idx_task_comments_parent_comment_id on public.task_comments(parent_comment_id);
