import { createContext, useContext, useMemo, type ReactNode } from 'react'

import type { Organization, Workspace } from '@/types/organization'

import { ORGANIZATION, WORKSPACES } from './organization-data'

export interface OrganizationContextValue {
  currentOrganization: Organization
  workspaces: Workspace[]
}

const OrganizationContext = createContext<OrganizationContextValue | undefined>(undefined)

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const value = useMemo<OrganizationContextValue>(
    () => ({
      currentOrganization: ORGANIZATION,
      workspaces: WORKSPACES,
    }),
    [],
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
