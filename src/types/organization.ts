export const DEFAULT_BRANDING_PRIMARY_COLOR = '#3B82F6'
export const DEFAULT_BRANDING_ACCENT_COLOR = '#0EA5E9'

export interface Organization {
  id: string
  name: string
  slug: string
  plan: 'Starter' | 'Pro' | 'Enterprise'
  legalName: string
  website: string
  contactEmail: string
  phone: string
  industry: string
  size: string
  timezone: string
  location: string
  country: string
  addressLine1: string
  addressLine2: string
  city: string
  postalCode: string
  defaultCurrency: string
  registrationNumber: string
  taxId: string
  brandingLogoUrl: string
  brandingPrimaryColor: string
  brandingAccentColor: string
  description: string
  createdAt?: string
  updatedAt?: string
}

export interface Workspace {
  id: string
  name: string
}

export type OrganizationMemberRole = 'owner' | 'admin' | 'member' | 'viewer'

export interface OrganizationMember {
  id: string
  organizationId: string
  userId: string
  role: OrganizationMemberRole
}

export interface OrganizationSettingsValues {
  name: string
  slug: string
  legalName: string
  website: string
  contactEmail: string
  phone: string
  industry: string
  size: string
  timezone: string
  location: string
  country: string
  addressLine1: string
  addressLine2: string
  city: string
  postalCode: string
  defaultCurrency: string
  registrationNumber: string
  taxId: string
  brandingLogoUrl: string
  brandingPrimaryColor: string
  brandingAccentColor: string
  description: string
}
