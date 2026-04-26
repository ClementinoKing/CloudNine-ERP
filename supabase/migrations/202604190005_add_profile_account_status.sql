alter table public.profiles
  add column if not exists account_status text not null default 'active' check (account_status in ('active', 'deactivated', 'deleted')),
  add column if not exists deactivated_at timestamptz,
  add column if not exists deleted_at timestamptz;

comment on column public.profiles.account_status is
  'Tracks whether an account is active, deactivated, or deleted.';

comment on column public.profiles.deactivated_at is
  'Records when the account was last deactivated.';

comment on column public.profiles.deleted_at is
  'Records when the account was marked as deleted.';
