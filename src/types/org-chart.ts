export interface OrgChartProfile {
  id: string
  full_name: string | null
  email: string | null
  avatar_url: string | null
  job_title: string | null
  department: string | null
  manager_id: string | null
  org_chart_sort_order: number
  job_id: string | null
}

export interface OrgChartNode extends OrgChartProfile {
  children: OrgChartNode[]
  isExpanded: boolean
  descendantCount: number
}

export interface VacantRole {
  id: string
  name: string
  description: string | null
  department_id: string
  department_name: string
}

export interface UpdateHierarchyParams {
  profile_id: string
  new_manager_id: string | null
  new_sort_order: number
}

export interface UpdateHierarchyResponse {
  success: boolean
  error?: string
  profile_id?: string
  manager_id?: string | null
  sort_order?: number
}
