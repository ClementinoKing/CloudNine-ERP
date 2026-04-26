alter table public.organization_invitations
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists delivery_status text not null default 'pending' check (delivery_status in ('pending', 'sent', 'failed')),
  add column if not exists delivery_error text,
  add column if not exists resend_message_id text,
  add column if not exists last_sent_at timestamptz,
  add column if not exists revoked_at timestamptz,
  add column if not exists accepted_at timestamptz;

create index if not exists idx_organization_invitations_status_created_at
  on public.organization_invitations(status, created_at desc);

create index if not exists idx_organization_invitations_email_status
  on public.organization_invitations(lower(email), status);

alter table public.organization_invitations enable row level security;

drop policy if exists "invitations select scoped" on public.organization_invitations;
drop policy if exists "invitations insert scoped" on public.organization_invitations;
drop policy if exists "invitations update scoped" on public.organization_invitations;
drop policy if exists "invitations delete scoped" on public.organization_invitations;
drop policy if exists "invitations select admin" on public.organization_invitations;
drop policy if exists "invitations select own email" on public.organization_invitations;
drop policy if exists "invitations insert admin" on public.organization_invitations;
drop policy if exists "invitations update admin" on public.organization_invitations;
drop policy if exists "invitations delete admin" on public.organization_invitations;

create policy "invitations select admin"
on public.organization_invitations
for select
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role_label, '')) = 'admin'
  )
);

create policy "invitations select own email"
on public.organization_invitations
for select
using (
  lower(email) = lower(coalesce((select p.email from public.profiles p where p.id = auth.uid()), ''))
);

create policy "invitations insert admin"
on public.organization_invitations
for insert
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role_label, '')) = 'admin'
  )
);

create policy "invitations update admin"
on public.organization_invitations
for update
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role_label, '')) = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role_label, '')) = 'admin'
  )
);

create policy "invitations delete admin"
on public.organization_invitations
for delete
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role_label, '')) = 'admin'
  )
);

create table if not exists public.notification_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  recipient_email text not null,
  type text not null check (type in ('task_assigned', 'mention')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  provider text not null default 'resend',
  provider_message_id text,
  error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists idx_notification_email_deliveries_idempotency
  on public.notification_email_deliveries(notification_id, recipient_email, type);

create index if not exists idx_notification_email_deliveries_status_created_at
  on public.notification_email_deliveries(status, created_at desc);

drop trigger if exists set_notification_email_deliveries_updated_at on public.notification_email_deliveries;
create trigger set_notification_email_deliveries_updated_at
before update on public.notification_email_deliveries
for each row execute function public.set_updated_at();

alter table public.notification_email_deliveries enable row level security;

drop policy if exists "notification email deliveries admin read" on public.notification_email_deliveries;

create policy "notification email deliveries admin read"
on public.notification_email_deliveries
for select
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role_label, '')) = 'admin'
  )
);
