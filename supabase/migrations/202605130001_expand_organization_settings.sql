alter table public.organizations
  add column if not exists contact_email text,
  add column if not exists phone text,
  add column if not exists country text,
  add column if not exists address_line1 text,
  add column if not exists address_line2 text,
  add column if not exists city text,
  add column if not exists postal_code text,
  add column if not exists default_currency text,
  add column if not exists registration_number text,
  add column if not exists tax_id text;
