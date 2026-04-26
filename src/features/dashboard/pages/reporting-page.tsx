import { AlertTriangle, CalendarClock, CheckCircle2, Clock3, RefreshCw, Search, SlidersHorizontal, TrendingUp } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

type ReportingFilters = {
  cycle: string
  department: string | 'all'
  ownerId: string | 'all'
  statusKey: string | 'all'
  projectId: string | 'all'
  search: string
}

type KpiFocus = 'all' | 'on_time' | 'cycle' | 'blocked' | 'completed'

type ReportingTaskRow = {
  id: string
  title: string
  created_at: string
  due_at: string | null
  completed_at: string | null
  project_id: string | null
  assigned_to: string | null
  status: string | null
  status_id: string | null
  task_status: { key?: string | null; label?: string | null } | null
  project: { id: string; name: string | null } | null
  assignee: { id: string; full_name: string | null; department: string | null } | null
}

type GoalRow = {
  id: string
  title: string
  cycle: string
  health: 'on_track' | 'at_risk' | 'off_track'
  owner_id: string | null
  department: string | null
  due_at: string | null
  updated_at: string
}

type GoalLinkRow = {
  goal_id: string
  project_id: string | null
}

type GoalCheckinRow = {
  id: string
  goal_id: string
  author_id: string | null
  created_at: string
  blockers: string | null
  next_actions: string | null
}

type ProfileRow = {
  id: string
  full_name: string | null
  department: string | null
}

type ProjectRow = {
  id: string
  name: string | null
}

type KpiMetrics = {
  onTimeDeliveryPct: number
  cycleTimeDays: number | null
  blockedRatePct: number
  completedCount: number
  totalTasks: number
  dueTasks: number
  blockedCount: number
}

type TrendPoint = {
  weekStart: string
  label: string
  created: number
  completed: number
  overdue: number
}

type StatusMixRow = {
  statusKey: string
  label: string
  count: number
  sharePct: number
}

type OverdueOwnerRow = {
  ownerId: string | null
  ownerName: string
  overdueCount: number
}

type AtRiskGoalRow = {
  goalId: string
  title: string
  ownerName: string
  department: string
  dueAt: string | null
}

type RecentChangeRow = {
  id: string
  type: 'Task completed' | 'Goal check-in'
  title: string
  context: string
  happenedAt: string
}

type ReportingActionPanels = {
  overdueByOwner: OverdueOwnerRow[]
  atRiskGoals: AtRiskGoalRow[]
  recentChanges: RecentChangeRow[]
}

type ReportingKpiRpcRow = {
  on_time_delivery_pct: number
  cycle_time_days: number | null
  blocked_rate_pct: number
  completed_count: number
  total_tasks: number
  due_tasks: number
  blocked_count: number
}

type ReportingTrendRpcRow = {
  week_start: string
  created_count: number
  completed_count: number
  overdue_count: number
}

type ReportingStatusMixRpcRow = {
  status_key: string
  status_label: string
  task_count: number
  share_pct: number
}

type ReportingActionsRpcRow = {
  overdue_by_owner: unknown
  at_risk_goals: unknown
  recent_changes: unknown
}

type ReportingCachePayload = {
  cachedAt: number
  tasks: ReportingTaskRow[]
  goals: GoalRow[]
  goalLinks: GoalLinkRow[]
  checkins: GoalCheckinRow[]
  profiles: ProfileRow[]
  projects: ProjectRow[]
}

const REPORTING_CACHE_KEY = 'contas.reporting.page.v1'
const REPORTING_CACHE_TTL_MS = 3 * 60 * 1000

function readReportingCache(): ReportingCachePayload | null {
  try {
    const raw = localStorage.getItem(REPORTING_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ReportingCachePayload
    if (!parsed || typeof parsed.cachedAt !== 'number') return null
    if (Date.now() - parsed.cachedAt > REPORTING_CACHE_TTL_MS) return null
    if (!Array.isArray(parsed.tasks) || !Array.isArray(parsed.goals)) return null
    if (!Array.isArray(parsed.goalLinks) || !Array.isArray(parsed.checkins)) return null
    if (!Array.isArray(parsed.profiles) || !Array.isArray(parsed.projects)) return null
    return parsed
  } catch {
    return null
  }
}

function writeReportingCache(payload: Omit<ReportingCachePayload, 'cachedAt'>) {
  localStorage.setItem(
    REPORTING_CACHE_KEY,
    JSON.stringify({
      cachedAt: Date.now(),
      ...payload,
    } satisfies ReportingCachePayload),
  )
}

function safeNumber(value: unknown, fallback = 0) {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  return value
}

function parseDate(value?: string | null) {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

function isSameUtcDay(a: Date, b: Date) {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate()
}

function formatRelativeTime(value?: string | null) {
  const parsed = parseDate(value)
  if (!parsed) return 'Just now'
  const diffMs = Date.now() - parsed.getTime()
  const diffMinutes = Math.max(Math.floor(diffMs / (1000 * 60)), 0)
  if (diffMinutes < 1) return 'Just now'
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(parsed)
}

function getCurrentQuarterCycle() {
  const now = new Date()
  const quarter = Math.floor(now.getMonth() / 3) + 1
  return `Q${quarter} ${now.getFullYear()}`
}

function getQuarterCycleFromDate(value?: string | null) {
  const parsed = parseDate(value)
  if (!parsed) return null
  const quarter = Math.floor(parsed.getUTCMonth() / 3) + 1
  return `Q${quarter} ${parsed.getUTCFullYear()}`
}

function getTaskStatusKey(task: ReportingTaskRow) {
  return task.task_status?.key ?? task.status ?? 'planned'
}

function getTaskStatusLabel(task: ReportingTaskRow) {
  return (
    task.task_status?.label ??
    getTaskStatusKey(task)
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  )
}

function isTaskComplete(task: ReportingTaskRow) {
  return Boolean(task.completed_at) || getTaskStatusKey(task) === 'done'
}

function getTaskDepartment(task: ReportingTaskRow) {
  const raw = task.assignee?.department?.trim()
  return raw && raw.length > 0 ? raw : 'No department'
}

function isTaskOnTime(task: ReportingTaskRow) {
  const completedAt = parseDate(task.completed_at)
  const dueAt = parseDate(task.due_at)
  if (!completedAt || !dueAt) return false
  return completedAt.getTime() <= dueAt.getTime() || isSameUtcDay(completedAt, dueAt)
}

function startOfUtcWeek(date: Date) {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = utc.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  utc.setUTCDate(utc.getUTCDate() + diff)
  utc.setUTCHours(0, 0, 0, 0)
  return utc
}

function statusTone(value: string) {
  if (value === 'done') return 'bg-emerald-500'
  if (value === 'blocked') return 'bg-rose-500'
  if (value === 'in_progress') return 'bg-sky-500'
  if (value === 'review') return 'bg-amber-500'
  return 'bg-muted-foreground'
}

function healthTone(value: GoalRow['health']) {
  if (value === 'on_track') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
  if (value === 'off_track') return 'border-rose-500/30 bg-rose-500/10 text-rose-300'
  return 'border-amber-500/30 bg-amber-500/10 text-amber-300'
}

function formatDateLabel(value?: string | null) {
  const parsed = parseDate(value)
  if (!parsed) return 'No date'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(parsed)
}

function parseRpcActions(data: ReportingActionsRpcRow | null): ReportingActionPanels | null {
  if (!data) return null

  const overdueByOwner: OverdueOwnerRow[] = Array.isArray(data.overdue_by_owner)
    ? data.overdue_by_owner
        .map((row) => {
          const item = row as Record<string, unknown>
          return {
            ownerId: typeof item.owner_id === 'string' ? item.owner_id : null,
            ownerName: typeof item.owner_name === 'string' ? item.owner_name : 'Unassigned',
            overdueCount: safeNumber(item.overdue_count),
          }
        })
        .filter((row) => row.overdueCount > 0)
    : []

  const atRiskGoals: AtRiskGoalRow[] = Array.isArray(data.at_risk_goals)
    ? data.at_risk_goals.map((row) => {
        const item = row as Record<string, unknown>
        return {
          goalId: typeof item.goal_id === 'string' ? item.goal_id : crypto.randomUUID(),
          title: typeof item.title === 'string' ? item.title : 'Untitled goal',
          ownerName: typeof item.owner_name === 'string' ? item.owner_name : 'Unowned',
          department: typeof item.department === 'string' ? item.department : 'No department',
          dueAt: typeof item.due_at === 'string' ? item.due_at : null,
        }
      })
    : []

  const recentChanges: RecentChangeRow[] = Array.isArray(data.recent_changes)
    ? data.recent_changes.map((row) => {
        const item = row as Record<string, unknown>
        return {
          id: typeof item.id === 'string' ? item.id : crypto.randomUUID(),
          type: item.type === 'Goal check-in' ? 'Goal check-in' : 'Task completed',
          title: typeof item.title === 'string' ? item.title : 'Untitled update',
          context: typeof item.context === 'string' ? item.context : '',
          happenedAt: typeof item.happened_at === 'string' ? item.happened_at : new Date().toISOString(),
        }
      })
    : []

  return { overdueByOwner, atRiskGoals, recentChanges }
}

function ReportingPageSkeleton() {
  return (
    <div className='space-y-3 pb-3'>
      <div className='rounded-xl border bg-card p-3'>
        <div className='flex items-center justify-between gap-3'>
          <div className='space-y-2'>
            <div className='h-2.5 w-32 rounded bg-muted/50 animate-pulse' />
            <div className='h-4 w-52 rounded bg-muted/60 animate-pulse' />
          </div>
          <div className='flex items-center gap-2'>
            <div className='h-9 w-28 rounded-md bg-muted/50 animate-pulse' />
            <div className='h-9 w-24 rounded-md bg-muted/50 animate-pulse' />
            <div className='h-9 w-24 rounded-md bg-muted/50 animate-pulse' />
          </div>
        </div>
      </div>
      <div className='rounded-xl border bg-card p-2.5'>
        <div className='flex items-center gap-2'>
          <div className='h-8 flex-1 rounded-md bg-muted/50 animate-pulse' />
          <div className='h-8 w-8 rounded-md bg-muted/50 animate-pulse' />
        </div>
      </div>
      <section className='grid gap-2 md:grid-cols-2 xl:grid-cols-4'>
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={`reporting-kpi-skeleton-${index}`} className='rounded-xl border bg-card p-4'>
            <div className='flex items-center justify-between'>
              <div className='h-2.5 w-20 rounded bg-muted/50 animate-pulse' />
              <div className='h-3.5 w-3.5 rounded bg-muted/40 animate-pulse' />
            </div>
            <div className='mt-4 h-8 w-20 rounded bg-muted/60 animate-pulse' />
            <div className='mt-2 h-3 w-28 rounded bg-muted/40 animate-pulse' />
          </div>
        ))}
      </section>
      <section className='grid gap-3 xl:grid-cols-[1.35fr_1fr]'>
        <div className='rounded-xl border bg-card p-4'>
          <div className='h-4 w-44 rounded bg-muted/60 animate-pulse' />
          <div className='mt-1.5 h-3 w-56 rounded bg-muted/40 animate-pulse' />
          <div className='mt-5 flex h-[220px] items-end justify-between gap-2 rounded-lg border border-border/70 px-4 pb-3 pt-6'>
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={`reporting-chart-col-${index}`} className='flex items-end gap-1'>
                <div className='w-2 rounded bg-muted/45 animate-pulse' style={{ height: `${48 + ((index * 17) % 80)}px` }} />
                <div className='w-2 rounded bg-muted/55 animate-pulse' style={{ height: `${36 + ((index * 13) % 100)}px` }} />
                <div className='w-2 rounded bg-muted/35 animate-pulse' style={{ height: `${28 + ((index * 11) % 92)}px` }} />
              </div>
            ))}
          </div>
        </div>
        <div className='rounded-xl border bg-card p-4'>
          <div className='h-4 w-36 rounded bg-muted/60 animate-pulse' />
          <div className='mt-1.5 h-3 w-48 rounded bg-muted/40 animate-pulse' />
          <div className='mt-4 space-y-2.5'>
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={`reporting-status-row-${index}`} className='rounded-md border p-2'>
                <div className='flex items-center justify-between'>
                  <div className='h-3 w-24 rounded bg-muted/50 animate-pulse' />
                  <div className='h-3 w-14 rounded bg-muted/40 animate-pulse' />
                </div>
                <div className='mt-2 h-1.5 w-full rounded bg-muted/35 animate-pulse' />
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className='grid gap-3 lg:grid-cols-3'>
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={`reporting-panel-skeleton-${index}`} className='rounded-xl border bg-card p-4'>
            <div className='h-4 w-36 rounded bg-muted/60 animate-pulse' />
            <div className='mt-1.5 h-3 w-48 rounded bg-muted/40 animate-pulse' />
            <div className='mt-4 space-y-2'>
              {Array.from({ length: 4 }).map((__, rowIndex) => (
                <div key={`reporting-panel-row-${index}-${rowIndex}`} className='rounded-md border p-2'>
                  <div className='h-3 w-2/3 rounded bg-muted/50 animate-pulse' />
                  <div className='mt-1.5 h-2.5 w-1/2 rounded bg-muted/35 animate-pulse' />
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}

export function ReportingPage() {
  const cached = readReportingCache()
  const [tasks, setTasks] = useState<ReportingTaskRow[]>(cached?.tasks ?? [])
  const [goals, setGoals] = useState<GoalRow[]>(cached?.goals ?? [])
  const [goalLinks, setGoalLinks] = useState<GoalLinkRow[]>(cached?.goalLinks ?? [])
  const [checkins, setCheckins] = useState<GoalCheckinRow[]>(cached?.checkins ?? [])
  const [profiles, setProfiles] = useState<ProfileRow[]>(cached?.profiles ?? [])
  const [projects, setProjects] = useState<ProjectRow[]>(cached?.projects ?? [])
  const [loading, setLoading] = useState(() => !cached)
  const [refreshKey, setRefreshKey] = useState(0)

  const [filters, setFilters] = useState<ReportingFilters>({
    cycle: getCurrentQuarterCycle(),
    department: 'all',
    ownerId: 'all',
    statusKey: 'all',
    projectId: 'all',
    search: '',
  })
  const [kpiFocus, setKpiFocus] = useState<KpiFocus>('all')
  const [filtersDrawerOpen, setFiltersDrawerOpen] = useState(false)

  const [rpcSupported, setRpcSupported] = useState(true)
  const [rpcLoading, setRpcLoading] = useState(false)
  const [rpcKpis, setRpcKpis] = useState<ReportingKpiRpcRow | null>(null)
  const [rpcTrend, setRpcTrend] = useState<ReportingTrendRpcRow[]>([])
  const [rpcStatusMix, setRpcStatusMix] = useState<ReportingStatusMixRpcRow[]>([])
  const [rpcActions, setRpcActions] = useState<ReportingActionPanels | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    void Promise.all([
      supabase
        .from('tasks')
        .select(
          'id,title,created_at,due_at,completed_at,project_id,assigned_to,status,status_id,task_status:status_id(key,label),project:project_id(id,name),assignee:assigned_to(id,full_name,department)',
        ),
      supabase.from('goals').select('id,title,cycle,health,owner_id,department,due_at,updated_at'),
      supabase.from('goal_links').select('goal_id,project_id'),
      supabase.from('goal_checkins').select('id,goal_id,author_id,created_at,blockers,next_actions').order('created_at', { ascending: false }).limit(80),
      supabase.from('profiles').select('id,full_name,department').order('full_name', { ascending: true }),
      supabase.from('projects').select('id,name').order('name', { ascending: true }),
    ]).then(([tasksResult, goalsResult, linksResult, checkinsResult, profilesResult, projectsResult]) => {
      if (cancelled) return
      const nextTasks = (tasksResult.data as ReportingTaskRow[] | null) ?? []
      const nextGoals = (goalsResult.data as GoalRow[] | null) ?? []
      const nextGoalLinks = (linksResult.data as GoalLinkRow[] | null) ?? []
      const nextCheckins = (checkinsResult.data as GoalCheckinRow[] | null) ?? []
      const nextProfiles = (profilesResult.data as ProfileRow[] | null) ?? []
      const nextProjects = (projectsResult.data as ProjectRow[] | null) ?? []

      setTasks(nextTasks)
      setGoals(nextGoals)
      setGoalLinks(nextGoalLinks)
      setCheckins(nextCheckins)
      setProfiles(nextProfiles)
      setProjects(nextProjects)
      writeReportingCache({
        tasks: nextTasks,
        goals: nextGoals,
        goalLinks: nextGoalLinks,
        checkins: nextCheckins,
        profiles: nextProfiles,
        projects: nextProjects,
      })
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [refreshKey])

  useEffect(() => {
    if (!rpcSupported) return
    let cancelled = false
    setRpcLoading(true)

    const params = {
      p_cycle: filters.cycle === 'all' ? null : filters.cycle,
      p_department: filters.department === 'all' ? null : filters.department,
      p_owner: filters.ownerId === 'all' ? null : filters.ownerId,
      p_status: filters.statusKey === 'all' ? null : filters.statusKey,
      p_project: filters.projectId === 'all' ? null : filters.projectId,
      p_search: filters.search.trim() || null,
    }

    void Promise.all([
      supabase.rpc('reporting_kpis', params),
      supabase.rpc('reporting_trend_weekly', params),
      supabase.rpc('reporting_status_mix', params),
      supabase.rpc('reporting_action_panels', params),
    ]).then(([kpiResult, trendResult, statusResult, actionResult]) => {
      if (cancelled) return

      const errors = [kpiResult.error, trendResult.error, statusResult.error, actionResult.error].filter(Boolean)
      if (errors.length > 0) {
        const missingFunction = errors.some((error) => error?.message?.toLowerCase().includes('could not find the function'))
        if (missingFunction) {
          setRpcSupported(false)
        }
        setRpcKpis(null)
        setRpcTrend([])
        setRpcStatusMix([])
        setRpcActions(null)
        setRpcLoading(false)
        return
      }

      const kpiRow = Array.isArray(kpiResult.data) ? (kpiResult.data[0] as ReportingKpiRpcRow | undefined) : undefined
      const actionRow = Array.isArray(actionResult.data) ? (actionResult.data[0] as ReportingActionsRpcRow | undefined) : undefined
      setRpcKpis(kpiRow ?? null)
      setRpcTrend(Array.isArray(trendResult.data) ? (trendResult.data as ReportingTrendRpcRow[]) : [])
      setRpcStatusMix(Array.isArray(statusResult.data) ? (statusResult.data as ReportingStatusMixRpcRow[]) : [])
      setRpcActions(parseRpcActions(actionRow ?? null))
      setRpcLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [filters, rpcSupported, refreshKey])

  const profileById = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile])), [profiles])

  const cycleOptions = useMemo(() => {
    const options = new Set<string>([getCurrentQuarterCycle()])
    for (const goal of goals) {
      if (goal.cycle?.trim()) options.add(goal.cycle.trim())
    }
    for (const task of tasks) {
      const cycle = getQuarterCycleFromDate(task.due_at)
      if (cycle) options.add(cycle)
    }
    return ['all', ...Array.from(options).sort((a, b) => b.localeCompare(a))]
  }, [goals, tasks])

  const departmentOptions = useMemo(() => {
    const values = new Set<string>()
    for (const profile of profiles) {
      const department = profile.department?.trim()
      if (department) values.add(department)
    }
    for (const goal of goals) {
      const department = goal.department?.trim()
      if (department) values.add(department)
    }
    values.add('No department')
    return ['all', ...Array.from(values).sort((a, b) => a.localeCompare(b))]
  }, [goals, profiles])

  const ownerOptions = useMemo(() => {
    const ids = new Set<string>()
    for (const task of tasks) {
      if (task.assigned_to) ids.add(task.assigned_to)
    }
    for (const goal of goals) {
      if (goal.owner_id) ids.add(goal.owner_id)
    }
    const owners = Array.from(ids)
      .map((id) => {
        const profile = profileById.get(id)
        return {
          id,
          name: profile?.full_name ?? 'Unknown user',
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
    return [{ id: 'all', name: 'All owners' }, ...owners]
  }, [goals, profileById, tasks])

  const projectOptions = useMemo(() => [{ id: 'all', name: 'All projects' }, ...projects.map((project) => ({ id: project.id, name: project.name ?? 'Untitled project' }))], [projects])

  const baseFilteredTasks = useMemo(() => {
    const search = filters.search.trim().toLowerCase()

    return tasks.filter((task) => {
      const statusKey = getTaskStatusKey(task)
      const cycle = getQuarterCycleFromDate(task.due_at)
      const department = getTaskDepartment(task)
      const ownerName = task.assignee?.full_name ?? 'Unknown user'
      const projectName = task.project?.name ?? 'No project'

      if (filters.cycle !== 'all' && cycle !== filters.cycle) return false
      if (filters.department !== 'all' && department !== filters.department) return false
      if (filters.ownerId !== 'all' && task.assigned_to !== filters.ownerId) return false
      if (filters.statusKey !== 'all' && statusKey !== filters.statusKey) return false
      if (filters.projectId !== 'all' && task.project_id !== filters.projectId) return false

      if (search.length > 0) {
        const haystack = [task.title, projectName, ownerName, statusKey].join(' ').toLowerCase()
        if (!haystack.includes(search)) return false
      }

      return true
    })
  }, [filters, tasks])

  const scopedTasks = useMemo(() => {
    if (kpiFocus === 'all') return baseFilteredTasks
    if (kpiFocus === 'blocked') return baseFilteredTasks.filter((task) => getTaskStatusKey(task) === 'blocked')
    if (kpiFocus === 'completed') return baseFilteredTasks.filter((task) => isTaskComplete(task))
    if (kpiFocus === 'on_time') return baseFilteredTasks.filter((task) => task.due_at && isTaskComplete(task) && isTaskOnTime(task))
    return baseFilteredTasks.filter((task) => isTaskComplete(task))
  }, [baseFilteredTasks, kpiFocus])

  const fallbackKpis = useMemo<KpiMetrics>(() => {
    const totalTasks = scopedTasks.length
    const completedCount = scopedTasks.filter((task) => isTaskComplete(task)).length
    const blockedCount = scopedTasks.filter((task) => getTaskStatusKey(task) === 'blocked').length
    const dueTasks = scopedTasks.filter((task) => task.due_at).length
    const onTimeCount = scopedTasks.filter((task) => task.due_at && isTaskComplete(task) && isTaskOnTime(task)).length
    const cycleSamples = scopedTasks
      .filter((task) => isTaskComplete(task) && task.completed_at)
      .map((task) => {
        const createdAt = parseDate(task.created_at)
        const completedAt = parseDate(task.completed_at)
        if (!createdAt || !completedAt) return null
        return (completedAt.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24)
      })
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0)

    return {
      onTimeDeliveryPct: dueTasks > 0 ? Math.round((onTimeCount / dueTasks) * 100) : 0,
      cycleTimeDays: cycleSamples.length > 0 ? Number((cycleSamples.reduce((sum, value) => sum + value, 0) / cycleSamples.length).toFixed(1)) : null,
      blockedRatePct: totalTasks > 0 ? Math.round((blockedCount / totalTasks) * 100) : 0,
      completedCount,
      totalTasks,
      dueTasks,
      blockedCount,
    }
  }, [scopedTasks])

  const fallbackTrend = useMemo<TrendPoint[]>(() => {
    const now = new Date()
    const thisWeek = startOfUtcWeek(now)
    const points: TrendPoint[] = []

    for (let offset = 7; offset >= 0; offset -= 1) {
      const weekStart = new Date(thisWeek)
      weekStart.setUTCDate(weekStart.getUTCDate() - offset * 7)
      const weekEnd = new Date(weekStart)
      weekEnd.setUTCDate(weekEnd.getUTCDate() + 7)
      const label = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(weekStart)

      const created = scopedTasks.filter((task) => {
        const createdAt = parseDate(task.created_at)
        return createdAt ? createdAt >= weekStart && createdAt < weekEnd : false
      }).length

      const completed = scopedTasks.filter((task) => {
        const completedAt = parseDate(task.completed_at)
        return completedAt ? completedAt >= weekStart && completedAt < weekEnd : false
      }).length

      const overdue = scopedTasks.filter((task) => {
        const dueAt = parseDate(task.due_at)
        if (!dueAt) return false
        return dueAt >= weekStart && dueAt < weekEnd && !isTaskComplete(task)
      }).length

      points.push({
        weekStart: weekStart.toISOString(),
        label,
        created,
        completed,
        overdue,
      })
    }

    return points
  }, [scopedTasks])

  const fallbackStatusMix = useMemo<StatusMixRow[]>(() => {
    const buckets = new Map<string, StatusMixRow>()
    for (const task of scopedTasks) {
      const statusKey = getTaskStatusKey(task)
      const existing = buckets.get(statusKey) ?? { statusKey, label: getTaskStatusLabel(task), count: 0, sharePct: 0 }
      existing.count += 1
      buckets.set(statusKey, existing)
    }
    const total = Math.max(scopedTasks.length, 1)
    return Array.from(buckets.values())
      .map((row) => ({ ...row, sharePct: Math.round((row.count / total) * 100) }))
      .sort((a, b) => b.count - a.count)
  }, [scopedTasks])

  const fallbackActions = useMemo<ReportingActionPanels>(() => {
    const now = Date.now()
    const overdueMap = new Map<string, OverdueOwnerRow>()
    for (const task of scopedTasks) {
      const dueAt = parseDate(task.due_at)
      if (!dueAt || dueAt.getTime() >= now || isTaskComplete(task)) continue
      const ownerId = task.assigned_to
      const ownerName = task.assignee?.full_name ?? 'Unassigned'
      const key = ownerId ?? 'unassigned'
      const row = overdueMap.get(key) ?? { ownerId, ownerName, overdueCount: 0 }
      row.overdueCount += 1
      overdueMap.set(key, row)
    }
    const overdueByOwner = Array.from(overdueMap.values()).sort((a, b) => b.overdueCount - a.overdueCount).slice(0, 8)

    const goalProjectMap = new Map<string, Set<string>>()
    for (const link of goalLinks) {
      if (!link.project_id) continue
      const existing = goalProjectMap.get(link.goal_id) ?? new Set<string>()
      existing.add(link.project_id)
      goalProjectMap.set(link.goal_id, existing)
    }

    const search = filters.search.trim().toLowerCase()
    const atRiskGoals = goals
      .filter((goal) => goal.health === 'at_risk')
      .filter((goal) => (filters.cycle === 'all' ? true : goal.cycle === filters.cycle))
      .filter((goal) => {
        const owner = goal.owner_id ? profileById.get(goal.owner_id) : null
        const department = goal.department ?? owner?.department ?? 'No department'
        if (filters.department !== 'all' && department !== filters.department) return false
        if (filters.ownerId !== 'all' && goal.owner_id !== filters.ownerId) return false
        if (filters.projectId !== 'all') {
          const linked = goalProjectMap.get(goal.id)
          if (!linked || !linked.has(filters.projectId)) return false
        }
        if (search.length > 0) {
          const ownerName = owner?.full_name ?? 'Unowned'
          const haystack = `${goal.title} ${ownerName} ${department}`.toLowerCase()
          if (!haystack.includes(search)) return false
        }
        return true
      })
      .sort((a, b) => {
        const dueA = parseDate(a.due_at)?.getTime() ?? Number.POSITIVE_INFINITY
        const dueB = parseDate(b.due_at)?.getTime() ?? Number.POSITIVE_INFINITY
        return dueA - dueB
      })
      .slice(0, 8)
      .map((goal) => {
        const owner = goal.owner_id ? profileById.get(goal.owner_id) : null
        return {
          goalId: goal.id,
          title: goal.title,
          ownerName: owner?.full_name ?? 'Unowned',
          department: goal.department ?? owner?.department ?? 'No department',
          dueAt: goal.due_at,
        }
      })

    const allowedGoalIds = new Set(atRiskGoals.map((goal) => goal.goalId))

    const recentTaskChanges: RecentChangeRow[] = scopedTasks
      .filter((task) => task.completed_at)
      .map((task) => ({
        id: `task:${task.id}`,
        type: 'Task completed' as const,
        title: task.title,
        context: `${task.project?.name ?? 'No project'} • ${task.assignee?.full_name ?? 'Unassigned'}`,
        happenedAt: task.completed_at ?? task.created_at,
      }))

    const recentGoalChanges: RecentChangeRow[] = checkins
      .filter((checkin) => (allowedGoalIds.size > 0 ? allowedGoalIds.has(checkin.goal_id) : true))
      .map((checkin) => {
        const goal = goals.find((item) => item.id === checkin.goal_id)
        const author = checkin.author_id ? profileById.get(checkin.author_id) : null
        return {
          id: `checkin:${checkin.id}`,
          type: 'Goal check-in' as const,
          title: goal?.title ?? 'Goal update',
          context: checkin.blockers || checkin.next_actions || author?.full_name || 'Progress update logged',
          happenedAt: checkin.created_at,
        }
      })

    const recentChanges = [...recentTaskChanges, ...recentGoalChanges]
      .sort((a, b) => (parseDate(b.happenedAt)?.getTime() ?? 0) - (parseDate(a.happenedAt)?.getTime() ?? 0))
      .slice(0, 10)

    return { overdueByOwner, atRiskGoals, recentChanges }
  }, [checkins, filters, goalLinks, goals, profileById, scopedTasks])

  const effectiveKpis = useMemo<KpiMetrics>(() => {
    if (!rpcKpis) return fallbackKpis
    return {
      onTimeDeliveryPct: safeNumber(rpcKpis.on_time_delivery_pct),
      cycleTimeDays: typeof rpcKpis.cycle_time_days === 'number' ? rpcKpis.cycle_time_days : null,
      blockedRatePct: safeNumber(rpcKpis.blocked_rate_pct),
      completedCount: safeNumber(rpcKpis.completed_count),
      totalTasks: safeNumber(rpcKpis.total_tasks),
      dueTasks: safeNumber(rpcKpis.due_tasks),
      blockedCount: safeNumber(rpcKpis.blocked_count),
    }
  }, [fallbackKpis, rpcKpis])

  const effectiveTrend = useMemo<TrendPoint[]>(() => {
    if (rpcTrend.length === 0) return fallbackTrend
    return rpcTrend.map((row) => ({
      weekStart: row.week_start,
      label: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(parseDate(row.week_start) ?? new Date()),
      created: safeNumber(row.created_count),
      completed: safeNumber(row.completed_count),
      overdue: safeNumber(row.overdue_count),
    }))
  }, [fallbackTrend, rpcTrend])

  const effectiveStatusMix = useMemo<StatusMixRow[]>(() => {
    if (rpcStatusMix.length === 0) return fallbackStatusMix
    return rpcStatusMix
      .map((row) => ({
        statusKey: row.status_key,
        label: row.status_label,
        count: safeNumber(row.task_count),
        sharePct: Math.round(safeNumber(row.share_pct)),
      }))
      .sort((a, b) => b.count - a.count)
  }, [fallbackStatusMix, rpcStatusMix])

  const effectiveActions = rpcActions ?? fallbackActions
  const activeDatasetName = rpcKpis && rpcTrend.length > 0 && rpcStatusMix.length > 0 && rpcActions ? 'Live aggregates' : 'Local calculations'

  const overdueDetailsByOwner = useMemo(() => {
    const now = Date.now()
    const byOwner = new Map<string, Array<{ id: string; title: string; projectName: string; dueAt: string | null; statusLabel: string }>>()
    for (const task of baseFilteredTasks) {
      const dueAt = parseDate(task.due_at)
      if (!dueAt || dueAt.getTime() >= now || isTaskComplete(task)) continue
      const key = task.assigned_to ?? 'unassigned'
      const existing = byOwner.get(key) ?? []
      existing.push({
        id: task.id,
        title: task.title,
        projectName: task.project?.name ?? 'No project',
        dueAt: task.due_at,
        statusLabel: getTaskStatusLabel(task),
      })
      byOwner.set(key, existing)
    }
    for (const [key, items] of byOwner.entries()) {
      const sorted = items
        .sort((a, b) => (parseDate(a.dueAt)?.getTime() ?? Number.POSITIVE_INFINITY) - (parseDate(b.dueAt)?.getTime() ?? Number.POSITIVE_INFINITY))
        .slice(0, 4)
      byOwner.set(key, sorted)
    }
    return byOwner
  }, [baseFilteredTasks])

  const atRiskInsightsByGoal = useMemo(() => {
    const projectLinksByGoal = new Map<string, Set<string>>()
    for (const link of goalLinks) {
      if (!link.project_id) continue
      const set = projectLinksByGoal.get(link.goal_id) ?? new Set<string>()
      set.add(link.project_id)
      projectLinksByGoal.set(link.goal_id, set)
    }

    const latestCheckinByGoal = new Map<string, GoalCheckinRow>()
    for (const checkin of checkins) {
      if (!latestCheckinByGoal.has(checkin.goal_id)) {
        latestCheckinByGoal.set(checkin.goal_id, checkin)
      }
    }

    const insights = new Map<string, { linkedProjects: number; latestSignal: string; checkinAge: string }>()
    for (const goal of goals) {
      const latestCheckin = latestCheckinByGoal.get(goal.id)
      insights.set(goal.id, {
        linkedProjects: projectLinksByGoal.get(goal.id)?.size ?? 0,
        latestSignal: latestCheckin?.blockers || latestCheckin?.next_actions || 'No recent check-in details.',
        checkinAge: latestCheckin ? formatRelativeTime(latestCheckin.created_at) : 'No recent check-in',
      })
    }

    return insights
  }, [checkins, goalLinks, goals])

  const maxTrend = useMemo(() => Math.max(1, ...effectiveTrend.map((row) => Math.max(row.created, row.completed, row.overdue))), [effectiveTrend])

  const kpiCards = [
    {
      key: 'on_time' as const,
      label: 'On-time Delivery',
      value: `${effectiveKpis.onTimeDeliveryPct}%`,
      helper: `${effectiveKpis.dueTasks} due tasks`,
      icon: CheckCircle2,
    },
    {
      key: 'cycle' as const,
      label: 'Cycle Time',
      value: effectiveKpis.cycleTimeDays !== null ? `${effectiveKpis.cycleTimeDays}d` : 'N/A',
      helper: 'Avg completion days',
      icon: Clock3,
    },
    {
      key: 'blocked' as const,
      label: 'Blocked Rate',
      value: `${effectiveKpis.blockedRatePct}%`,
      helper: `${effectiveKpis.blockedCount} blocked tasks`,
      icon: AlertTriangle,
    },
    {
      key: 'completed' as const,
      label: 'Completed',
      value: String(effectiveKpis.completedCount),
      helper: `${effectiveKpis.totalTasks} in filtered scope`,
      icon: TrendingUp,
    },
  ]

  const applyKpiFocus = (next: KpiFocus) => {
    if (kpiFocus === next) {
      setKpiFocus('all')
      setFilters((current) => ({ ...current, statusKey: 'all' }))
      return
    }
    setKpiFocus(next)
    if (next === 'blocked') {
      setFilters((current) => ({ ...current, statusKey: 'blocked' }))
      return
    }
    if (next === 'completed') {
      setFilters((current) => ({ ...current, statusKey: 'done' }))
      return
    }
    setFilters((current) => ({ ...current, statusKey: 'all' }))
  }

  if (loading && tasks.length === 0 && goals.length === 0) {
    return <ReportingPageSkeleton />
  }

  return (
    <div className='space-y-3 pb-3'>
      <Card className='border-border/80'>
        <CardContent className='flex flex-wrap items-center justify-between gap-3 p-3'>
          <div className='space-y-0.5'>
            <p className='text-[11px] uppercase tracking-[0.22em] text-muted-foreground'>Strategic reporting</p>
            <p className='text-sm font-semibold text-foreground'>Executive Decision Dashboard</p>
          </div>
          <div className='flex items-center gap-2'>
            <select
              value={filters.cycle}
              onChange={(event) => setFilters((current) => ({ ...current, cycle: event.target.value }))}
              className='h-9 rounded-md border bg-background px-3 text-sm font-medium text-foreground outline-none transition focus:border-primary'
            >
              {cycleOptions.map((cycle) => (
                <option key={cycle} value={cycle}>
                  {cycle === 'all' ? 'All cycles' : cycle}
                </option>
              ))}
            </select>
            <Button
              size='sm'
              variant='outline'
              className='h-9 gap-1.5'
              onClick={() => {
                setRpcSupported(true)
                setRefreshKey((value) => value + 1)
              }}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loading || rpcLoading ? 'animate-spin' : '')} />
              Refresh
            </Button>
            <Badge variant='outline' className='h-9 rounded-md px-3 text-xs font-medium'>
              {activeDatasetName}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card className='border-border/80'>
        <CardContent className='flex items-center gap-2 p-2.5'>
          <div className='relative min-w-[220px] flex-1'>
            <Search className='pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground' />
            <Input
              value={filters.search}
              onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
              placeholder='Search tasks, projects, owners, statuses'
              className='h-8 pl-8 text-sm'
            />
          </div>
          <Button type='button' variant='outline' size='icon' className='h-8 w-8 shrink-0' onClick={() => setFiltersDrawerOpen(true)} aria-label='Open filters'>
            <SlidersHorizontal className='h-4 w-4' />
          </Button>
        </CardContent>
      </Card>

      <section className='grid gap-2 md:grid-cols-2 xl:grid-cols-4'>
        {kpiCards.map((card) => {
          const Icon = card.icon
          const selected = kpiFocus === card.key
          return (
            <button key={card.key} type='button' onClick={() => applyKpiFocus(card.key)} className='text-left'>
              <Card
                className={cn(
                  'border-border/80 transition hover:border-border',
                  selected ? 'border-cyan-400/35 bg-cyan-400/10' : 'bg-card',
                )}
              >
                <CardHeader className='space-y-1 pb-1.5'>
                  <CardDescription className='flex items-center justify-between text-[11px] uppercase tracking-[0.2em]'>
                    {card.label}
                    <Icon className='h-3.5 w-3.5 text-muted-foreground' />
                  </CardDescription>
                  <CardTitle className='text-2xl leading-none'>{card.value}</CardTitle>
                </CardHeader>
                <CardContent className='pt-0'>
                  <p className='text-xs text-muted-foreground'>{card.helper}</p>
                </CardContent>
              </Card>
            </button>
          )
        })}
      </section>

      <section className='grid gap-3 xl:grid-cols-[1.35fr_1fr]'>
        <Card className='border-border/80'>
          <CardHeader className='pb-2'>
            <CardTitle className='text-base'>Weekly Throughput Trend</CardTitle>
            <CardDescription>Created, completed, and overdue load by week</CardDescription>
          </CardHeader>
          <CardContent className='space-y-2'>
            <div className='overflow-x-auto'>
              <svg viewBox='0 0 820 210' className='h-52 w-full min-w-[760px]' role='img' aria-label='Reporting weekly throughput chart'>
                <line x1='22' y1='178' x2='798' y2='178' stroke='hsl(var(--border))' />
                {effectiveTrend.map((point, index) => {
                  const width = 820
                  const left = 22
                  const inner = width - left * 2
                  const groupWidth = inner / effectiveTrend.length
                  const barWidth = 12
                  const gap = 3
                  const startX = left + index * groupWidth + (groupWidth - (barWidth * 3 + gap * 2)) / 2
                  const chartTop = 22
                  const chartHeight = 152

                  const createdHeight = (point.created / maxTrend) * chartHeight
                  const completedHeight = (point.completed / maxTrend) * chartHeight
                  const overdueHeight = (point.overdue / maxTrend) * chartHeight

                  return (
                    <g key={point.weekStart}>
                      <rect x={startX} y={chartTop + chartHeight - createdHeight} width={barWidth} height={createdHeight} rx={2} fill='#60A5FA' />
                      <rect x={startX + barWidth + gap} y={chartTop + chartHeight - completedHeight} width={barWidth} height={completedHeight} rx={2} fill='#34D399' />
                      <rect x={startX + (barWidth + gap) * 2} y={chartTop + chartHeight - overdueHeight} width={barWidth} height={overdueHeight} rx={2} fill='#FB7185' />
                      <text
                        x={left + index * groupWidth + groupWidth / 2}
                        y={200}
                        textAnchor='middle'
                        fontSize='9'
                        fill='hsl(var(--muted-foreground))'
                      >
                        {point.label}
                      </text>
                    </g>
                  )
                })}
              </svg>
            </div>
            <div className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
              <span className='inline-flex items-center gap-1 rounded-full border px-2 py-0.5'>
                <span className='h-2 w-2 rounded-full bg-[#60A5FA]' />
                Created
              </span>
              <span className='inline-flex items-center gap-1 rounded-full border px-2 py-0.5'>
                <span className='h-2 w-2 rounded-full bg-[#34D399]' />
                Completed
              </span>
              <span className='inline-flex items-center gap-1 rounded-full border px-2 py-0.5'>
                <span className='h-2 w-2 rounded-full bg-[#FB7185]' />
                Overdue
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className='border-border/80'>
          <CardHeader className='pb-2'>
            <CardTitle className='text-base'>Status Distribution</CardTitle>
            <CardDescription>Current status share in the selected scope</CardDescription>
          </CardHeader>
          <CardContent className='space-y-2'>
            {effectiveStatusMix.length === 0 ? <p className='text-sm text-muted-foreground'>No status data yet.</p> : null}
            {effectiveStatusMix.map((row) => (
              <article key={row.statusKey} className='rounded-md border p-2'>
                <div className='flex items-center justify-between text-sm'>
                  <p className='font-medium text-foreground'>{row.label}</p>
                  <p className='text-muted-foreground'>
                    {row.count} • {row.sharePct}%
                  </p>
                </div>
                <div className='mt-1.5 h-1.5 rounded-full bg-muted'>
                  <div className={cn('h-full rounded-full', statusTone(row.statusKey))} style={{ width: `${Math.min(row.sharePct, 100)}%` }} />
                </div>
              </article>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className='grid gap-3 lg:grid-cols-3'>
        <Card className='border-border/80'>
          <CardHeader className='pb-2'>
            <CardTitle className='text-base'>Overdue by Owner</CardTitle>
            <CardDescription>Who needs execution support this week</CardDescription>
          </CardHeader>
          <CardContent className='space-y-2'>
            {effectiveActions.overdueByOwner.length === 0 ? <p className='text-sm text-muted-foreground'>No overdue workload in this scope.</p> : null}
            {effectiveActions.overdueByOwner.map((row) => (
              <article key={`${row.ownerId ?? 'unassigned'}-${row.ownerName}`} className='group relative rounded-md border p-2 text-sm'>
                <div className='flex items-center justify-between'>
                  <p className='font-medium text-foreground'>{row.ownerName}</p>
                  <Badge variant='outline' className='border-rose-500/30 bg-rose-500/10 text-rose-300'>
                    {row.overdueCount} overdue
                  </Badge>
                </div>
                <div className='pointer-events-none absolute left-0 top-full z-30 mt-2 hidden w-[min(18rem,calc(100vw-2rem))] rounded-lg border bg-card p-3 shadow-lg group-hover:block group-focus-within:block'>
                  <p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>Overdue detail</p>
                  <p className='mt-1 text-sm font-semibold text-foreground'>{row.ownerName}</p>
                  <div className='mt-2 space-y-1.5 text-xs'>
                    {(overdueDetailsByOwner.get(row.ownerId ?? 'unassigned') ?? []).map((task) => (
                      <div key={task.id} className='rounded-md border px-2 py-1.5'>
                        <p className='font-medium text-foreground'>{task.title}</p>
                        <p className='mt-0.5 text-muted-foreground'>
                          {task.projectName} • {task.statusLabel}
                        </p>
                        <p className='mt-0.5 text-muted-foreground'>Due {formatDateLabel(task.dueAt)}</p>
                      </div>
                    ))}
                    {(overdueDetailsByOwner.get(row.ownerId ?? 'unassigned') ?? []).length === 0 ? (
                      <p className='text-muted-foreground'>No task-level details in the current local scope.</p>
                    ) : null}
                  </div>
                </div>
              </article>
            ))}
          </CardContent>
        </Card>

        <Card className='border-border/80'>
          <CardHeader className='pb-2'>
            <CardTitle className='text-base'>At-risk Goals</CardTitle>
            <CardDescription>Strategic goals needing immediate intervention</CardDescription>
          </CardHeader>
          <CardContent className='space-y-2'>
            {effectiveActions.atRiskGoals.length === 0 ? <p className='text-sm text-muted-foreground'>No at-risk goals in this scope.</p> : null}
            {effectiveActions.atRiskGoals.map((goal) => (
              <article key={goal.goalId} className='group relative rounded-md border p-2.5'>
                <div className='flex items-start justify-between gap-2'>
                  <p className='text-sm font-semibold text-foreground'>{goal.title}</p>
                  <Badge variant='outline' className={healthTone('at_risk')}>
                    At risk
                  </Badge>
                </div>
                <p className='mt-1 text-xs text-muted-foreground'>
                  {goal.ownerName} • {goal.department}
                </p>
                <p className='mt-1 text-xs text-muted-foreground'>Due {formatDateLabel(goal.dueAt)}</p>
                <div className='pointer-events-none absolute left-0 top-full z-30 mt-2 hidden w-[min(18rem,calc(100vw-2rem))] rounded-lg border bg-card p-3 shadow-lg group-hover:block group-focus-within:block'>
                  <p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>At-risk detail</p>
                  <p className='mt-1 text-sm font-semibold text-foreground'>{goal.title}</p>
                  <div className='mt-2 space-y-1 text-xs text-muted-foreground'>
                    <p>Owner: {goal.ownerName}</p>
                    <p>Department: {goal.department}</p>
                    <p>Due: {formatDateLabel(goal.dueAt)}</p>
                    <p>Linked projects: {atRiskInsightsByGoal.get(goal.goalId)?.linkedProjects ?? 0}</p>
                    <p>Latest check-in: {atRiskInsightsByGoal.get(goal.goalId)?.checkinAge ?? 'No recent check-in'}</p>
                    <p className='line-clamp-2'>{atRiskInsightsByGoal.get(goal.goalId)?.latestSignal ?? 'No recent check-in details.'}</p>
                  </div>
                </div>
              </article>
            ))}
          </CardContent>
        </Card>

        <Card className='border-border/80'>
          <CardHeader className='pb-2'>
            <CardTitle className='text-base'>Recent Delivery Changes</CardTitle>
            <CardDescription>Latest execution and check-in signals</CardDescription>
          </CardHeader>
          <CardContent className='space-y-2'>
            {effectiveActions.recentChanges.length === 0 ? <p className='text-sm text-muted-foreground'>No recent updates yet.</p> : null}
            {effectiveActions.recentChanges.slice(0, 4).map((item) => (
              <article key={item.id} className='rounded-md border p-2.5'>
                <div className='flex items-center justify-between gap-2'>
                  <p className='text-sm font-medium text-foreground'>{item.title}</p>
                  <Badge variant='outline' className='text-[10px]'>
                    {item.type}
                  </Badge>
                </div>
                <p className='mt-1 line-clamp-2 text-xs text-muted-foreground'>{item.context}</p>
                <p className='mt-1 text-[11px] text-muted-foreground'>{formatRelativeTime(item.happenedAt)}</p>
              </article>
            ))}
          </CardContent>
        </Card>
      </section>

      {loading ? (
        <Card className='border-border/80'>
          <CardContent className='flex items-center gap-2 p-3 text-sm text-muted-foreground'>
            <CalendarClock className='h-4 w-4' />
            Loading reporting data...
          </CardContent>
        </Card>
      ) : null}

      <Dialog open={filtersDrawerOpen} onOpenChange={setFiltersDrawerOpen}>
        <DialogContent
          className='left-auto right-0 top-0 h-full !w-[360px] !max-w-[360px] translate-x-0 translate-y-0 rounded-none border-y-0 border-r-0 border-l border-border/80 p-4 shadow-2xl max-[420px]:!w-full max-[420px]:!max-w-full'
          disableAnimations
        >
          <DialogHeader>
            <DialogTitle className='text-base'>Filters</DialogTitle>
            <DialogDescription>Refine reporting scope and status lens.</DialogDescription>
          </DialogHeader>

          <div className='mt-3 space-y-3'>
            <div className='space-y-1'>
              <p className='text-[11px] uppercase tracking-[0.18em] text-muted-foreground'>Cycle</p>
              <select
                value={filters.cycle}
                onChange={(event) => setFilters((current) => ({ ...current, cycle: event.target.value }))}
                className='h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary'
              >
                {cycleOptions.map((cycle) => (
                  <option key={cycle} value={cycle}>
                    {cycle === 'all' ? 'All cycles' : cycle}
                  </option>
                ))}
              </select>
            </div>

            <div className='space-y-1'>
              <p className='text-[11px] uppercase tracking-[0.18em] text-muted-foreground'>Owner</p>
              <select
                value={filters.ownerId}
                onChange={(event) => setFilters((current) => ({ ...current, ownerId: event.target.value }))}
                className='h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary'
              >
                {ownerOptions.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name}
                  </option>
                ))}
              </select>
            </div>

            <div className='space-y-1'>
              <p className='text-[11px] uppercase tracking-[0.18em] text-muted-foreground'>Department</p>
              <select
                value={filters.department}
                onChange={(event) => setFilters((current) => ({ ...current, department: event.target.value }))}
                className='h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary'
              >
                {departmentOptions.map((department) => (
                  <option key={department} value={department}>
                    {department === 'all' ? 'All departments' : department}
                  </option>
                ))}
              </select>
            </div>

            <div className='space-y-1'>
              <p className='text-[11px] uppercase tracking-[0.18em] text-muted-foreground'>Project</p>
              <select
                value={filters.projectId}
                onChange={(event) => setFilters((current) => ({ ...current, projectId: event.target.value }))}
                className='h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary'
              >
                {projectOptions.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>

            <div className='space-y-1'>
              <p className='text-[11px] uppercase tracking-[0.18em] text-muted-foreground'>Status</p>
              <div className='flex flex-wrap gap-1.5'>
                {['all', 'planned', 'in_progress', 'review', 'blocked', 'done'].map((status) => (
                  <button
                    key={status}
                    type='button'
                    onClick={() => setFilters((current) => ({ ...current, statusKey: status as ReportingFilters['statusKey'] }))}
                    className={cn(
                      'whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium transition',
                      filters.statusKey === status
                        ? 'border-cyan-400/35 bg-cyan-400/12 text-cyan-100'
                        : 'border-border bg-background text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {status === 'all' ? 'All statuses' : status.replace('_', ' ')}
                  </button>
                ))}
              </div>
            </div>

            <div className='flex items-center gap-2 pt-1'>
              <Button
                type='button'
                variant='outline'
                className='h-8 px-3 text-xs'
                onClick={() => {
                  setKpiFocus('all')
                  setFilters({
                    cycle: getCurrentQuarterCycle(),
                    department: 'all',
                    ownerId: 'all',
                    statusKey: 'all',
                    projectId: 'all',
                    search: '',
                  })
                }}
              >
                Reset filters
              </Button>
              <Button type='button' className='h-8 px-3 text-xs' onClick={() => setFiltersDrawerOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
