import type { Organization, OrganizationSettingsValues } from '@/types/organization'

export function buildOrganizationSettingsValues(organization: Organization): OrganizationSettingsValues {
  return {
    name: organization.name,
    slug: organization.slug,
    legalName: organization.legalName,
    website: organization.website,
    contactEmail: organization.contactEmail,
    phone: organization.phone,
    industry: organization.industry,
    size: organization.size,
    timezone: organization.timezone,
    location: organization.location,
    country: organization.country,
    addressLine1: organization.addressLine1,
    addressLine2: organization.addressLine2,
    city: organization.city,
    postalCode: organization.postalCode,
    defaultCurrency: organization.defaultCurrency,
    registrationNumber: organization.registrationNumber,
    taxId: organization.taxId,
    brandingLogoUrl: organization.brandingLogoUrl,
    brandingPrimaryColor: organization.brandingPrimaryColor,
    brandingAccentColor: organization.brandingAccentColor,
    description: organization.description,
  }
}
