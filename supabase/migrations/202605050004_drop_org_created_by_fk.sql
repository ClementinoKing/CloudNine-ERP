-- Drop the foreign key constraint on organizations.created_by
-- that references profiles(id). This constraint creates a chicken-and-egg
-- problem during onboarding: the user needs to create an org before they
-- have a profile, but the FK requires the profile to exist first.
--
-- The created_by field is still useful for tracking who created the org,
-- but we don't need referential integrity enforcement here.

alter table public.organizations
drop constraint if exists organizations_created_by_fkey;

-- Add a comment explaining why there's no FK
comment on column public.organizations.created_by is
  'User ID of the organization creator. Not enforced as FK to allow org creation during onboarding before profile exists.';
