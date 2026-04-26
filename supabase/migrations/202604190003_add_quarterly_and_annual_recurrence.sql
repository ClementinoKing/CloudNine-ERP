alter table public.task_recurrences
  drop constraint if exists task_recurrences_frequency_check;

alter table public.task_recurrences
  add constraint task_recurrences_frequency_check
  check (frequency in ('daily', 'weekly', 'monthly', 'quarterly', 'annual'));

create or replace function public.task_recurrence_next_run_at(
  p_anchor timestamptz,
  p_frequency text,
  p_interval_count integer default 1
)
returns timestamptz
language plpgsql
immutable
as $$
declare
  v_interval_count integer := greatest(coalesce(p_interval_count, 1), 1);
begin
  case p_frequency
    when 'daily' then
      return p_anchor + make_interval(days => v_interval_count);
    when 'weekly' then
      return p_anchor + make_interval(weeks => v_interval_count);
    when 'monthly' then
      return p_anchor + make_interval(months => v_interval_count);
    when 'quarterly' then
      return p_anchor + make_interval(months => v_interval_count * 3);
    when 'annual' then
      return p_anchor + make_interval(years => v_interval_count);
    else
      raise exception 'Unsupported recurrence frequency: %', p_frequency using errcode = '22023';
  end case;
end;
$$;
