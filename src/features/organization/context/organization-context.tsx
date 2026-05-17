import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { useAuth } from '@/features/auth/context/auth-context'
import {
  applyOrganizationBrandingTheme,
  cacheOrganizationBranding,
  clearOrganizationBrandingCache,
  normalizeBrandColor,
  normalizeBrandingLogoUrl,
  readCachedOrganizationBranding,
  readLastActiveOrganizationId,
  writeLastActiveOrganizationId,
} from '@/features/organization/lib/branding'
import { cacheOrganizationState, readCachedOrganizationState } from '@/features/organization/lib/organization-cache'
import { supabase } from '@/lib/supabase'
import type {
  Organization,
  OrganizationMember,
  OrganizationMemberRole,
  OrganizationSettingsValues,
  Workspace,
} from '@/types/organization'
import { DEFAULT_BRANDING_ACCENT_COLOR, DEFAULT_BRANDING_PRIMARY_COLOR } from '@/types/organization'

import { ORGANIZATION, WORKSPACES } from './organization-data'

export interface OrganizationContextValue {
  currentOrganization: Organization
  currentOrganizationId: string
  setCurrentOrganizationId: (organizationId: string) => Promise<void>
  updateOrganization: (organizationId: string, values: OrganizationSettingsValues) => Promise<Organization>
  currentMembership: OrganizationMember | null
  currentMembershipRole: OrganizationMemberRole | null
  workspaces: Workspace[]
  organizations: Organization[]
  loading: boolean
}

const OrganizationContext = createContext<OrganizationContextValue | undefined>(undefined)

type OrganizationRow = {
  id: string
  name: string
  slug: string
  plan: Organization['plan']
  legal_name: string | null
  website: string | null
  contact_email: string | null
  phone: string | null
  industry: string | null
  size: string | null
  timezone: string | null
  location: string | null
  country: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  postal_code: string | null
  default_currency: string | null
  registration_number: string | null
  tax_id: string | null
  branding_logo_url: string | null
  branding_primary_color: string | null
  branding_accent_color: string | null
  description: string | null
  created_at: string
  updated_at: string
}

type OrganizationMemberRow = {
  id: string
  organization_id: string
  user_id: string
  role: OrganizationMemberRole
  created_at: string
}

function mapOrganization(row: OrganizationRow): Organization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    plan: row.plan,
    legalName: row.legal_name ?? '',
    website: row.website ?? '',
    contactEmail: row.contact_email ?? '',
    phone: row.phone ?? '',
    industry: row.industry ?? '',
    size: row.size ?? '',
    timezone: row.timezone ?? '',
    location: row.location ?? '',
    country: row.country ?? '',
    addressLine1: row.address_line1 ?? '',
    addressLine2: row.address_line2 ?? '',
    city: row.city ?? '',
    postalCode: row.postal_code ?? '',
    defaultCurrency: row.default_currency ?? '',
    registrationNumber: row.registration_number ?? '',
    taxId: row.tax_id ?? '',
    brandingLogoUrl: normalizeBrandingLogoUrl(row.branding_logo_url),
    brandingPrimaryColor: normalizeBrandColor(row.branding_primary_color, DEFAULT_BRANDING_PRIMARY_COLOR),
    brandingAccentColor: normalizeBrandColor(row.branding_accent_color, DEFAULT_BRANDING_ACCENT_COLOR),
    description: row.description ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function cleanText(value: string) {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function normalizeOptionalUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

function mapSettingsValuesToRow(values: OrganizationSettingsValues) {
  return {
    name: values.name.trim(),
    slug: normalizeSlug(values.slug),
    legal_name: cleanText(values.legalName),
    website: normalizeOptionalUrl(values.website),
    contact_email: cleanText(values.contactEmail),
    phone: cleanText(values.phone),
    industry: cleanText(values.industry),
    size: cleanText(values.size),
    timezone: cleanText(values.timezone),
    location: cleanText(values.location),
    country: cleanText(values.country),
    address_line1: cleanText(values.addressLine1),
    address_line2: cleanText(values.addressLine2),
    city: cleanText(values.city),
    postal_code: cleanText(values.postalCode),
    default_currency: cleanText(values.defaultCurrency)?.toUpperCase() ?? null,
    registration_number: cleanText(values.registrationNumber),
    tax_id: cleanText(values.taxId),
    branding_logo_url: normalizeBrandingLogoUrl(values.brandingLogoUrl),
    branding_primary_color: normalizeBrandColor(values.brandingPrimaryColor, DEFAULT_BRANDING_PRIMARY_COLOR),
    branding_accent_color: normalizeBrandColor(values.brandingAccentColor, DEFAULT_BRANDING_ACCENT_COLOR),
    description: cleanText(values.description),
  }
}

function mapMembership(row: OrganizationMemberRow): OrganizationMember {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    role: row.role,
  }
}

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const { currentUser, isAuthenticated } = useAuth()
  const [organizations, setOrganizations] = useState<Organization[]>([ORGANIZATION])
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(null)
  const [currentMembership, setCurrentMembership] = useState<OrganizationMember | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>(WORKSPACES)
  const [loading, setLoading] = useState(false)
  const loadRequestIdRef = useRef(0)

  const loadOrganizationContext = useCallback(async () => {
    const requestId = ++loadRequestIdRef.current

    if (!isAuthenticated || !currentUser?.id) {
      setOrganizations([ORGANIZATION])
      setCurrentMembership(null)
      setWorkspaces(WORKSPACES)
      setSelectedOrganizationId(ORGANIZATION.id)
      setLoading(false)
      return
    }

    const cachedOrganizationState = readCachedOrganizationState(currentUser.id)
    if (cachedOrganizationState?.organizations.length) {
      setOrganizations(cachedOrganizationState.organizations)
      setSelectedOrganizationId(
        cachedOrganizationState.selectedOrganizationId ?? cachedOrganizationState.organizations[0]?.id ?? ORGANIZATION.id,
      )
      setCurrentMembership(null)
      setWorkspaces(WORKSPACES)
      setLoading(false)
    } else {
      setLoading(true)
    }

    const profileResult = await supabase.from('profiles').select('active_organization_id').eq('id', currentUser.id).maybeSingle()
    const persistedActiveOrganizationId =
      typeof profileResult.data?.active_organization_id === 'string' ? profileResult.data.active_organization_id : null

    const membershipsResult = await supabase
      .from('organization_members')
      .select('id, organization_id, user_id, role, created_at')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: true })

    if (requestId !== loadRequestIdRef.current) return

    if (membershipsResult.error) {
      if (!cachedOrganizationState?.organizations.length) {
        setOrganizations([ORGANIZATION])
        setSelectedOrganizationId(ORGANIZATION.id)
        setCurrentMembership(null)
        setWorkspaces(WORKSPACES)
      }
      setLoading(false)
      return
    }

    if (!membershipsResult.data?.length) {
      setOrganizations([ORGANIZATION])
      setSelectedOrganizationId(ORGANIZATION.id)
      setCurrentMembership(null)
      setWorkspaces(WORKSPACES)
      setLoading(false)
      return
    }

    const membershipRows = membershipsResult.data as OrganizationMemberRow[]
    const organizationIds = membershipRows.map((membership) => membership.organization_id)
    const organizationsResult = await supabase
      .from('organizations')
      .select(
        'id, name, slug, plan, legal_name, website, contact_email, phone, industry, size, timezone, location, country, address_line1, address_line2, city, postal_code, default_currency, registration_number, tax_id, branding_logo_url, branding_primary_color, branding_accent_color, description, created_at, updated_at',
      )
      .in('id', organizationIds)
      .order('name', { ascending: true })

    if (requestId !== loadRequestIdRef.current) return

    const organizationRows = (organizationsResult.data ?? []) as OrganizationRow[]
    const nextOrganizations = organizationRows.map(mapOrganization)
    if (organizationsResult.error || nextOrganizations.length === 0) {
      if (!cachedOrganizationState?.organizations.length) {
        setOrganizations([ORGANIZATION])
        setSelectedOrganizationId(ORGANIZATION.id)
        setCurrentMembership(null)
        setWorkspaces(WORKSPACES)
      }
      setLoading(false)
      return
    }
    const selectedOrganization =
      nextOrganizations.find((organization) => organization.id === selectedOrganizationId) ??
      nextOrganizations.find((organization) => organization.id === persistedActiveOrganizationId) ??
      nextOrganizations[0] ??
      ORGANIZATION
    const selectedMembershipRow =
      membershipRows.find((membership) => membership.organization_id === selectedOrganization.id) ?? membershipRows[0]

    // Workspaces table doesn't exist yet — use fallback data
    const nextWorkspaces = WORKSPACES

    if (requestId !== loadRequestIdRef.current) return

    setOrganizations(nextOrganizations.length > 0 ? nextOrganizations : [ORGANIZATION])
    setSelectedOrganizationId(selectedOrganization.id)
    setCurrentMembership(selectedMembershipRow ? mapMembership(selectedMembershipRow) : null)
    setWorkspaces(nextWorkspaces)
    setLoading(false)
  }, [currentUser?.id, isAuthenticated, selectedOrganizationId])

  useEffect(() => {
    const cachedOrganizationId = readLastActiveOrganizationId()
    if (cachedOrganizationId) {
      const cachedBranding = readCachedOrganizationBranding(cachedOrganizationId)
      if (cachedBranding) {
        applyOrganizationBrandingTheme(cachedBranding.primaryColor, cachedBranding.accentColor)
      }
    }

    const timer = window.setTimeout(() => {
      void loadOrganizationContext().catch(() => {
        setOrganizations([ORGANIZATION])
        setSelectedOrganizationId(ORGANIZATION.id)
        setCurrentMembership(null)
        setWorkspaces(WORKSPACES)
        setLoading(false)
      })
    }, 0)

    return () => {
      window.clearTimeout(timer)
    }
  }, [loadOrganizationContext])

  useEffect(() => {
    if (!isAuthenticated || !currentUser?.id) return

    const handleRealtimeChange = (event: Event) => {
      const detail = (event as CustomEvent<{ table?: string }>).detail
      if (detail?.table !== 'organizations') return
      void loadOrganizationContext()
    }

    window.addEventListener('cloudnine:realtime-change', handleRealtimeChange as EventListener)
    return () => {
      window.removeEventListener('cloudnine:realtime-change', handleRealtimeChange as EventListener)
    }
  }, [currentUser?.id, isAuthenticated, loadOrganizationContext])

  const currentOrganization = organizations.find((organization) => organization.id === selectedOrganizationId) ?? organizations[0] ?? ORGANIZATION

  const setCurrentOrganizationId = useCallback(async (organizationId: string) => {
    if (!currentUser?.id) return
    setSelectedOrganizationId(organizationId)
    const { error } = await supabase
      .from('profiles')
      .update({ active_organization_id: organizationId })
      .eq('id', currentUser.id)
    if (error) {
      setSelectedOrganizationId(null)
      throw error
    }
  }, [currentUser?.id])

  useEffect(() => {
    if (currentOrganization.id === ORGANIZATION.id) {
      const cachedOrganizationId = readLastActiveOrganizationId()
      if (cachedOrganizationId) {
        const cachedBranding = readCachedOrganizationBranding(cachedOrganizationId)
        if (cachedBranding) {
          applyOrganizationBrandingTheme(cachedBranding.primaryColor, cachedBranding.accentColor)
          return
        }
      }
    }

    applyOrganizationBrandingTheme(currentOrganization.brandingPrimaryColor, currentOrganization.brandingAccentColor)

    if (currentOrganization.id === ORGANIZATION.id) return

    const hasCustomColors =
      currentOrganization.brandingPrimaryColor !== DEFAULT_BRANDING_PRIMARY_COLOR ||
      currentOrganization.brandingAccentColor !== DEFAULT_BRANDING_ACCENT_COLOR

    if (hasCustomColors) {
      cacheOrganizationBranding(currentOrganization.id, currentOrganization.brandingPrimaryColor, currentOrganization.brandingAccentColor)
    } else {
      clearOrganizationBrandingCache(currentOrganization.id)
    }

    if (currentUser?.id) {
      cacheOrganizationState(currentUser.id, organizations, currentOrganization.id)
    }
    writeLastActiveOrganizationId(currentOrganization.id)
  }, [currentOrganization.brandingAccentColor, currentOrganization.brandingPrimaryColor, currentOrganization.id, currentUser?.id, organizations])

  const updateOrganization = useCallback(
    async (organizationId: string, values: OrganizationSettingsValues) => {
      const payload = mapSettingsValuesToRow(values)
      const { error } = await supabase.from('organizations').update(payload).eq('id', organizationId)

      if (error) throw error

      const nextOrganization = mapOrganization({
        ...(currentOrganization.id === organizationId ? currentOrganization : ORGANIZATION),
        ...payload,
        id: organizationId,
        name: payload.name,
        slug: payload.slug,
        legal_name: payload.legal_name,
        website: payload.website,
        contact_email: payload.contact_email,
        phone: payload.phone,
        industry: payload.industry,
        size: payload.size,
        timezone: payload.timezone,
        location: payload.location,
        country: payload.country,
        address_line1: payload.address_line1,
        address_line2: payload.address_line2,
        city: payload.city,
        postal_code: payload.postal_code,
        default_currency: payload.default_currency,
        registration_number: payload.registration_number,
        tax_id: payload.tax_id,
        branding_logo_url: payload.branding_logo_url,
        branding_primary_color: payload.branding_primary_color,
        branding_accent_color: payload.branding_accent_color,
        description: payload.description,
        plan: currentOrganization.id === organizationId ? currentOrganization.plan : ORGANIZATION.plan,
        created_at: currentOrganization.id === organizationId ? currentOrganization.createdAt ?? new Date().toISOString() : ORGANIZATION.createdAt ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as OrganizationRow)
      setOrganizations((current) => current.map((organization) => (organization.id === organizationId ? nextOrganization : organization)))
      if (organizationId === currentOrganization.id) {
        applyOrganizationBrandingTheme(nextOrganization.brandingPrimaryColor, nextOrganization.brandingAccentColor)
      }
      return nextOrganization
    },
    [currentOrganization],
  )

  const value = useMemo<OrganizationContextValue>(
    () => ({
      currentOrganization,
      currentOrganizationId: currentOrganization.id,
      setCurrentOrganizationId,
      updateOrganization,
      currentMembership,
      currentMembershipRole: currentMembership?.role ?? null,
      workspaces,
      organizations,
      loading,
    }),
    [currentMembership, currentOrganization, loading, organizations, setCurrentOrganizationId, updateOrganization, workspaces],
  )

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>
}

export function useOrganization() {
  const context = useContext(OrganizationContext)
  if (!context) {
    throw new Error('useOrganization must be used within OrganizationProvider')
  }
  return context
}
