export interface Organization {
  id: string
  name: string
  slug: string
  plan: 'Starter' | 'Pro' | 'Enterprise'
  legalName: string
  website: string
  industry: string
  size: string
  timezone: string
  location: string
  description: string
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
