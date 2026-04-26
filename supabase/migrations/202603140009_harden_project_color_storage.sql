update public.projects
set color = '#3B82F6'
where color is null or btrim(color) = '';

alter table public.projects
  alter column color set default '#3B82F6';
