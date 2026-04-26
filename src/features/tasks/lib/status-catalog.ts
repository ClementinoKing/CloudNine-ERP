export type StatusOption = {
  id: string
  key: string
  label: string
  sortOrder: number
  projectId: string | null
  color?: string | null
  isDefault: boolean
}

export const FALLBACK_STATUS_OPTIONS: StatusOption[] = [
  { id: 'fallback-planned', key: 'planned', label: 'Planned', sortOrder: 0, projectId: null, isDefault: true },
  { id: 'fallback-in-progress', key: 'in_progress', label: 'In Progress', sortOrder: 1, projectId: null, isDefault: true },
  { id: 'fallback-review', key: 'review', label: 'Review', sortOrder: 2, projectId: null, isDefault: true },
  { id: 'fallback-blocked', key: 'blocked', label: 'Blocked', sortOrder: 3, projectId: null, isDefault: true },
  { id: 'fallback-done', key: 'done', label: 'Done', sortOrder: 4, projectId: null, isDefault: true },
]

export function statusLabelFromKey(value?: string | null) {
  const key = (value ?? '').trim().toLowerCase()
  if (!key) return 'Planned'
  if (key === 'in_progress') return 'In Progress'
  return key
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function legacyBoardColumnForStatusKey(statusKey?: string | null) {
  if (!statusKey) return null
  return statusKey === 'planned' || statusKey === 'in_progress' || statusKey === 'review' || statusKey === 'blocked' ? statusKey : null
}

export function resolveProjectStatusOptions(statuses: StatusOption[], projectId?: string | null) {
  const source = statuses.length > 0 ? statuses : FALLBACK_STATUS_OPTIONS
  const normalizedProjectId = projectId ?? null
  const projectScoped = normalizedProjectId ? source.filter((status) => status.projectId === normalizedProjectId) : []
  const global = source.filter((status) => status.projectId === null)
  const merged = [...projectScoped, ...global].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))
  const seen = new Set<string>()
  const deduped: StatusOption[] = []
  for (const status of merged) {
    const dedupeKey = status.key.trim().toLowerCase()
    if (!dedupeKey || seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    deduped.push(status)
  }
  return deduped.length > 0 ? deduped : FALLBACK_STATUS_OPTIONS
}

export function mapStatusRowsToOptions(
  rows: Array<{
    id: string
    key: string | null
    label: string | null
    sort_order: number | null
    project_id?: string | null
    color?: string | null
    is_default?: boolean | null
  }>,
) {
  return rows
    .map((row) => ({
      id: row.id,
      key: row.key ?? 'planned',
      label: row.label ?? statusLabelFromKey(row.key),
      sortOrder: row.sort_order ?? 0,
      projectId: row.project_id ?? null,
      color: row.color ?? null,
      isDefault: row.is_default ?? false,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))
}
