-- Fix RLS policies to allow new users to create their first organization
-- during onboarding (before they have any memberships).

-- 1. Organizations: allow any authenticated user to insert when they are the creator.
--    The existing policy already has this check but may be blocked by the
--    resolve_row_organization_id trigger trying to look up a membership that
--    doesn't exist yet. We replace it with a simpler, explicit policy.
drop policy if exists "organizations insert authenticated" on public.organizations;

create policy "organizations insert authenticated"
on public.organizations
for insert
to authenticated
with check (created_by = auth.uid() or created_by is null);

-- 2. Organization members: the existing policy requires the inserting user to
--    already be an admin of the org — impossible for a brand-new org.
--    Allow a user to insert themselves as owner when they are the org creator,
--    OR when they are already an admin (existing behaviour for invites).
drop policy if exists "organization members insert admin" on public.organization_members;

create policy "organization members insert admin"
on public.organization_members
for insert
to authenticated
with check (
  -- User is inserting themselves as owner of an org they just created
  (
    user_id = auth.uid()
    and role = 'owner'
    and exists (
      select 1 from public.organizations o
      where o.id = organization_id
        and o.created_by = auth.uid()
    )
  )
  -- OR user is already an admin/owner of the org (existing invite flow)
  or public.is_organization_admin(organization_id)
);

-- 3. Disable the resolve_row_organization_id trigger on organizations itself —
--    organizations don't have an organization_id column, so the trigger should
--    never have been applied to this table. Drop it if it exists.
drop trigger if exists resolve_organizations_organization_id on public.organizations;
