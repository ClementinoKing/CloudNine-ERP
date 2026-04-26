alter table public.profiles
  add column if not exists availability_schedule jsonb not null default '[]'::jsonb;

comment on column public.profiles.availability_schedule is
  'Weekly availability blocks as JSON array: [{"day":"monday","startTime":"08:00","endTime":"17:00"}]';
