import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { useAuth } from '@/features/auth/context/auth-context'
import { supabase } from '@/lib/supabase'
import type { Organization, OrganizationMember, OrganizationMemberRole, Workspace } from '@/types/organization'

import { ORGANIZATION, WORKSPACES } from './organization-data'

export interface OrganizationContextValue {
  currentOrganization: Organization
  currentOrganizationId: string
  setCurrentOrganizationId: (organizationId: string) => Promise<void>
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
  industry: string | null
  size: string | null
  timezone: string | null
  location: string | null
  description: string | null
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
    industry: row.industry ?? '',
    size: row.size ?? '',
    timezone: row.timezone ?? '',
    location: row.location ?? '',
    description: row.description ?? '',
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

  useEffect(() => {
    if (!isAuthenticated || !currentUser?.id) {
      void Promise.resolve().then(() => {
        setOrganizations([ORGANIZATION])
        setCurrentMembership(null)
        setWorkspaces(WORKSPACES)
        setLoading(false)
      })
      return
    }

    let cancelled = false
    void Promise.resolve().then(() => {
      if (!cancelled) setLoading(true)
    })

    async function loadOrganizationContext() {
      const profileResult = await supabase.from('profiles').select('active_organization_id').eq('id', currentUser!.id).maybeSingle()
      const persistedActiveOrganizationId =
        typeof profileResult.data?.active_organization_id === 'string' ? profileResult.data.active_organization_id : null

      const membershipsResult = await supabase
        .from('organization_members')
        .select('id, organization_id, user_id, role, created_at')
        .eq('user_id', currentUser!.id)
        .order('created_at', { ascending: true })

      if (cancelled) return

      if (membershipsResult.error || !membershipsResult.data?.length) {
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
        .select('id, name, slug, plan, legal_name, website, industry, size, timezone, location, description')
        .in('id', organizationIds)
        .order('name', { ascending: true })

      if (cancelled) return

      const organizationRows = (organizationsResult.data ?? []) as OrganizationRow[]
      const nextOrganizations = organizationRows.map(mapOrganization)
      const selectedOrganization =
        nextOrganizations.find((organization) => organization.id === selectedOrganizationId) ??
        nextOrganizations.find((organization) => organization.id === persistedActiveOrganizationId) ??
        nextOrganizations[0] ??
        ORGANIZATION
      const selectedMembershipRow =
        membershipRows.find((membership) => membership.organization_id === selectedOrganization.id) ?? membershipRows[0]

      // Workspaces table doesn't exist yet — use fallback data
      const nextWorkspaces = WORKSPACES

      if (cancelled) return

      setOrganizations(nextOrganizations.length > 0 ? nextOrganizations : [ORGANIZATION])
      setSelectedOrganizationId(selectedOrganization.id)
      setCurrentMembership(selectedMembershipRow ? mapMembership(selectedMembershipRow) : null)
      setWorkspaces(nextWorkspaces)
      setLoading(false)
    }

    void loadOrganizationContext().catch(() => {
      if (cancelled) return
      setOrganizations([ORGANIZATION])
      setSelectedOrganizationId(ORGANIZATION.id)
      setCurrentMembership(null)
      setWorkspaces(WORKSPACES)
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [currentUser, isAuthenticated, selectedOrganizationId])

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

  const value = useMemo<OrganizationContextValue>(
    () => ({
      currentOrganization,
      currentOrganizationId: currentOrganization.id,
      setCurrentOrganizationId,
      currentMembership,
      currentMembershipRole: currentMembership?.role ?? null,
      workspaces,
      organizations,
      loading,
    }),
    [currentMembership, currentOrganization, loading, organizations, setCurrentOrganizationId, workspaces],
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
