drop function if exists public.create_task_with_recurrence(
  text,
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  uuid[],
  uuid[],
  timestamptz,
  timestamptz,
  text,
  date,
  integer
);

drop function if exists public.create_task_core(
  text,
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  uuid[],
  uuid[],
  uuid,
  timestamptz,
  timestamptz,
  uuid,
  timestamptz
);
