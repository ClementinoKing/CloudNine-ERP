alter table public.organizations
  add column if not exists branding_logo_url text,
  add column if not exists branding_primary_color text,
  add column if not exists branding_accent_color text;
