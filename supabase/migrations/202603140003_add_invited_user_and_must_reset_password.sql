alter table public.profiles
  add column if not exists must_reset_password boolean not null default false;

alter table public.organization_invitations
  add column if not exists invited_user_id uuid references public.profiles(id) on delete set null;

create index if not exists idx_organization_invitations_invited_user_id
  on public.organization_invitations(invited_user_id);
