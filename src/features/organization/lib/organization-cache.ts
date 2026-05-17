import { normalizeBrandColor, normalizeBrandingLogoUrl } from '@/features/organization/lib/branding'
import { DEFAULT_BRANDING_ACCENT_COLOR, DEFAULT_BRANDING_PRIMARY_COLOR, type Organization } from '@/types/organization'

const ORGANIZATION_CACHE_PREFIX = 'cloudnine.organization-cache'

type CachedOrganizationState = {
  selectedOrganizationId: string | null
  organizations: Organization[]
}

function readJsonValue<T>(key: string): T | null {
  if (typeof window === 'undefined') return null
  const rawValue = window.localStorage.getItem(key)
  if (!rawValue) return null

  try {
    return JSON.parse(rawValue) as T
  } catch {
    return null
  }
}

function writeJsonValue(key: string, value: unknown) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(key, JSON.stringify(value))
}

function getOrganizationCacheKey(userId: string) {
  return `${ORGANIZATION_CACHE_PREFIX}.${userId}`
}

function normalizeCachedOrganization(organization: Organization): Organization {
  return {
    ...organization,
    brandingLogoUrl: normalizeBrandingLogoUrl(organization.brandingLogoUrl),
    brandingPrimaryColor: normalizeBrandColor(organization.brandingPrimaryColor, DEFAULT_BRANDING_PRIMARY_COLOR),
    brandingAccentColor: normalizeBrandColor(organization.brandingAccentColor, DEFAULT_BRANDING_ACCENT_COLOR),
  }
}

export function readCachedOrganizationState(userId: string) {
  const cache = readJsonValue<CachedOrganizationState>(getOrganizationCacheKey(userId))
  if (!cache || !Array.isArray(cache.organizations)) return null

  return {
    selectedOrganizationId: typeof cache.selectedOrganizationId === 'string' ? cache.selectedOrganizationId : null,
    organizations: cache.organizations
      .filter((organization): organization is Organization => Boolean(organization && typeof organization.id === 'string'))
      .map(normalizeCachedOrganization),
  }
}

export function cacheOrganizationState(userId: string, organizations: Organization[], selectedOrganizationId: string | null) {
  const normalizedOrganizations = organizations.map(normalizeCachedOrganization)
  writeJsonValue(getOrganizationCacheKey(userId), {
    selectedOrganizationId,
    organizations: normalizedOrganizations,
  } satisfies CachedOrganizationState)
}

