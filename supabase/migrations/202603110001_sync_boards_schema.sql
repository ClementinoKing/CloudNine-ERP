create table if not exists public.boards (
  id text primary key,
  name text not null,
  sort_order integer not null default 0,
  is_default boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.boards
  add column if not exists is_default boolean not null default false;

drop trigger if exists set_boards_updated_at on public.boards;
create trigger set_boards_updated_at before update on public.boards for each row execute function public.set_updated_at();

create index if not exists idx_boards_sort_order on public.boards(sort_order);
create index if not exists idx_tasks_board_column on public.tasks(board_column);

insert into public.boards (id, name, sort_order, is_default)
values
  ('planned', 'Planned', 0, true),
  ('in_progress', 'In Progress', 1, true),
  ('review', 'Review', 2, true),
  ('blocked', 'Blocked', 3, true)
on conflict (id) do update
set
  name = excluded.name,
  sort_order = excluded.sort_order,
  is_default = excluded.is_default;

with task_board_values as (
  select distinct board_column
  from public.tasks
  where board_column is not null
)
insert into public.boards (id, name, sort_order, is_default)
select
  board_column,
  initcap(replace(board_column, '_', ' ')),
  100 + row_number() over (order by board_column),
  false
from task_board_values
where board_column not in (select id from public.boards)
on conflict (id) do nothing;

update public.tasks
set board_column = case status
  when 'in_progress' then 'in_progress'
  when 'review' then 'review'
  when 'blocked' then 'blocked'
  else 'planned'
end
where board_column is null;

alter table public.tasks
  drop constraint if exists tasks_board_column_fkey;

alter table public.tasks
  add constraint tasks_board_column_fkey
  foreign key (board_column)
  references public.boards(id)
  on delete set null;
