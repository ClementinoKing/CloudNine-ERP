import type { Organization, Workspace } from '@/types/organization'

export const ORGANIZATION: Organization = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Spryar Tech',
  slug: 'spryar-tech',
  plan: 'Enterprise',
  legalName: 'Spryar Tech Ltd.',
  website: 'https://spryar.tech',
  industry: 'Software & Services',
  size: '51-200 employees',
  timezone: 'Africa/Blantyre (CAT)',
  location: 'Lilongwe, Malawi',
  description: 'Spryar Tech helps organizations run projects, goals, reporting, and delivery operations from one system.',
}

export const WORKSPACES: Workspace[] = [
  { id: 'ws-product-strategy', name: 'Product Strategy' },
  { id: 'ws-ops-delivery', name: 'Ops Delivery' },
]
