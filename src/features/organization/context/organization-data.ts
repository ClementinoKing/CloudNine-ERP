import { DEFAULT_BRANDING_ACCENT_COLOR, DEFAULT_BRANDING_PRIMARY_COLOR } from '@/types/organization'
import type { Organization, Workspace } from '@/types/organization'

export const ORGANIZATION: Organization = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'CloudNine ERP',
  slug: 'cloudnine-erp',
  plan: 'Enterprise',
  legalName: 'CloudNine ERP Ltd.',
  website: 'https://cloudninetech.co.za',
  contactEmail: '',
  phone: '',
  industry: 'Software & Services',
  size: '51-200 employees',
  timezone: 'Africa/Blantyre (CAT)',
  location: 'Lilongwe, Malawi',
  country: 'Malawi',
  addressLine1: '',
  addressLine2: '',
  city: '',
  postalCode: '',
  defaultCurrency: 'MWK',
  registrationNumber: '',
  taxId: '',
  brandingLogoUrl: '',
  brandingPrimaryColor: DEFAULT_BRANDING_PRIMARY_COLOR,
  brandingAccentColor: DEFAULT_BRANDING_ACCENT_COLOR,
  description: 'CloudNine ERP helps organizations run projects, goals, reporting, and delivery operations from one system.',
}

export const WORKSPACES: Workspace[] = [
  { id: 'ws-product-strategy', name: 'Product Strategy' },
  { id: 'ws-ops-delivery', name: 'Ops Delivery' },
]
