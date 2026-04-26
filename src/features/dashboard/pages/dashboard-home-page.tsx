import { CalendarClock, ChartColumnBig, FolderKanban, Rocket, UsersRound } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useOrganization } from '@/features/organization/context/organization-context'
import { normalizeProjectColor } from '@/features/projects/lib/project-colors'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

type StatusLabel = 'In Progress' | 'Review' | 'Planned' | 'Blocked'
type TrendRange = '7d' | '30d' | '90d'
type TrendPoint = { date: Date; label: string; created: number; review: number; overdue: number }
type DashboardTask = {
  id: string
  title: string
  status: StatusLabel
  projectId: string
  projectName: string
  owners: string[]
  dueAt: string | null
  createdAt: string
}
type DashboardProject = { id: string; name: string; color: string }
type DashboardCachePayload = {
  tasks: DashboardTask[]
  projects: DashboardProject[]
  cachedAt: string
}

const DASHBOARD_HOME_CACHE_KEY_PREFIX = 'contas.dashboard.home.cache.v1'

const TREND_RANGE_OPTIONS: Array<{ key: TrendRange; label: string; days: number }> = [
  { key: '7d', label: '7D', days: 7 },
  { key: '30d', label: '30D', days: 30 },
  { key: '90d', label: '90D', days: 90 },
]

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function subtractDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() - days)
  return next
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function formatTrendLabel(date: Date, range: TrendRange) {
  if (range === '90d') {
    return new Intl.DateTimeFormat('en-US', { month: 'short' }).format(date)
  }
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date)
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function mapTaskStatus(value?: string | null): StatusLabel {
  switch (value) {
    case 'in_progress':
      return 'In Progress'
    case 'review':
      return 'Review'
    case 'blocked':
      return 'Blocked'
    default:
      return 'Planned'
  }
}

function buildTrendSeries(days: number, range: TrendRange, tasks: DashboardTask[]): TrendPoint[] {
  const today = startOfLocalDay(new Date())
  const daysBeforeToday = Math.floor(days / 2)
  const rangeStart = subtractDays(today, daysBeforeToday)

  return Array.from({ length: days }, (_, index) => {
    const date = addDays(rangeStart, index)
    const created = tasks.filter((task) => isSameDay(new Date(task.createdAt), date)).length
    const review = tasks.filter((task) => task.status === 'Review' && task.dueAt && isSameDay(new Date(task.dueAt), date)).length
    const overdue = tasks.filter((task) => {
      if (!task.dueAt || task.status === 'Review') return false
      const dueDate = new Date(task.dueAt)
      return isSameDay(dueDate, date) && dueDate < today
    }).length

    return {
      date,
      label: formatTrendLabel(date, range),
      created,
      review,
      overdue,
    }
  })
}

function daysUntil(date: Date) {
  const today = new Date()
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  return Math.round((target - start) / (1000 * 60 * 60 * 24))
}

function formatDueLabel(value: string | null) {
  if (!value) return 'No due date'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'No due date'
  const today = startOfLocalDay(new Date())
  if (isSameDay(startOfLocalDay(parsed), today)) return 'Today'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(parsed)
}

function readDashboardCache(cacheKey: string): DashboardCachePayload | null {
  try {
    const raw = localStorage.getItem(cacheKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DashboardCachePayload
    if (!Array.isArray(parsed.tasks) || !Array.isArray(parsed.projects)) return null
    return parsed
  } catch {
    return null
  }
}

function DashboardHomeSkeleton() {
  return (
    <div className='space-y-5'>
      <section className='grid gap-4 md:grid-cols-2 xl:grid-cols-4' aria-label='Loading key metrics'>
        {Array.from({ length: 4 }, (_, index) => (
          <Card key={index} className='rounded-xl'>
            <CardHeader className='pb-2'>
              <div className='h-3 w-24 animate-pulse rounded bg-muted/60' />
              <div className='mt-2 h-8 w-16 animate-pulse rounded bg-muted/60' />
            </CardHeader>
            <CardContent className='flex items-center justify-between pt-0'>
              <div className='h-3 w-40 animate-pulse rounded bg-muted/60' />
              <div className='h-4 w-4 animate-pulse rounded bg-muted/60' />
            </CardContent>
          </Card>
        ))}
      </section>

      <section className='grid gap-5 xl:grid-cols-[1.35fr_1fr]'>
        <Card className='rounded-xl'>
          <CardHeader className='pb-3'>
            <div className='h-5 w-32 animate-pulse rounded bg-muted/60' />
            <div className='mt-2 h-4 w-72 animate-pulse rounded bg-muted/60' />
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='grid gap-2 sm:grid-cols-3'>
              {Array.from({ length: 3 }, (_, index) => (
                <div key={index} className='rounded-md border px-3 py-2'>
                  <div className='h-3 w-14 animate-pulse rounded bg-muted/60' />
                  <div className='mt-2 h-6 w-10 animate-pulse rounded bg-muted/60' />
                </div>
              ))}
            </div>
            <div className='grid h-56 grid-cols-12 items-end gap-2 rounded-lg border bg-muted/10 p-3'>
              {Array.from({ length: 12 }, (_, index) => (
                <div key={index} className='flex h-full items-end gap-1'>
                  <div className='w-2 animate-pulse rounded-sm bg-muted/60' style={{ height: `${30 + ((index * 7) % 50)}%` }} />
                  <div className='w-2 animate-pulse rounded-sm bg-muted/50' style={{ height: `${20 + ((index * 5) % 45)}%` }} />
                  <div className='w-2 animate-pulse rounded-sm bg-muted/40' style={{ height: `${15 + ((index * 9) % 40)}%` }} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className='rounded-xl'>
          <CardHeader className='pb-3'>
            <div className='h-5 w-36 animate-pulse rounded bg-muted/60' />
            <div className='mt-2 h-4 w-48 animate-pulse rounded bg-muted/60' />
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='mx-auto h-52 w-52 animate-pulse rounded-full border bg-muted/30' />
            <div className='space-y-2'>
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className='h-9 animate-pulse rounded-md border bg-muted/40' />
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className='grid gap-5 xl:grid-cols-[1.35fr_1fr]'>
        <Card className='rounded-xl'>
          <CardHeader className='pb-3'>
            <div className='h-5 w-44 animate-pulse rounded bg-muted/60' />
            <div className='mt-2 h-4 w-64 animate-pulse rounded bg-muted/60' />
          </CardHeader>
          <CardContent className='space-y-2'>
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className='h-14 animate-pulse rounded-md border bg-muted/30' />
            ))}
          </CardContent>
        </Card>

        <Card className='rounded-xl'>
          <CardHeader className='pb-3'>
            <div className='h-5 w-28 animate-pulse rounded bg-muted/60' />
            <div className='mt-2 h-4 w-56 animate-pulse rounded bg-muted/60' />
          </CardHeader>
          <CardContent className='space-y-2'>
            <div className='h-10 animate-pulse rounded-md border bg-muted/40' />
            <div className='h-10 animate-pulse rounded-md border bg-muted/40' />
          </CardContent>
        </Card>
      </section>
    </div>
  )
}

export function DashboardHomePage() {
  const { currentOrganization } = useOrganization()
  const [trendRange, setTrendRange] = useState<TrendRange>('30d')
  const cacheKey = `${DASHBOARD_HOME_CACHE_KEY_PREFIX}:${currentOrganization.id}`
  const [tasks, setTasks] = useState<DashboardTask[]>(() => {
    const cached = readDashboardCache(cacheKey)
    return cached?.tasks ?? []
  })
  const [projects, setProjects] = useState<DashboardProject[]>(() => {
    const cached = readDashboardCache(cacheKey)
    return cached?.projects ?? []
  })
  const [loading, setLoading] = useState(() => tasks.length === 0 && projects.length === 0)

  useEffect(() => {
    let cancelled = false

    const loadDashboard = async () => {
      const [projectsResult, profilesResult, tasksResult, taskAssigneesResult] = await Promise.all([
        supabase.from('projects').select('id, name, color').order('name', { ascending: true }),
        supabase.from('profiles').select('id, full_name, email'),
        supabase.from('tasks').select('id, title, status, project_id, assigned_to, due_at, created_at').order('created_at', { ascending: false }),
        supabase.from('task_assignees').select('task_id, assignee_id'),
      ])
      if (cancelled) return

      const nextProjects = (projectsResult.data ?? []).map((project) => ({
        id: project.id,
        name: project.name ?? 'Untitled project',
        color: normalizeProjectColor(project.color),
      }))
      const profileMap = new Map(
        (profilesResult.data ?? []).map((profile) => [profile.id, profile.full_name ?? profile.email ?? 'Unassigned']),
      )
      const projectMap = new Map(nextProjects.map((project) => [project.id, project.name]))
      const assigneeIdsByTaskId = new Map<string, string[]>()
      for (const row of taskAssigneesResult.data ?? []) {
        const current = assigneeIdsByTaskId.get(row.task_id) ?? []
        current.push(row.assignee_id)
        assigneeIdsByTaskId.set(row.task_id, current)
      }

      const nextTasks: DashboardTask[] = (tasksResult.data ?? []).map((task) => ({
        id: task.id,
        title: task.title,
        status: mapTaskStatus(task.status),
        projectId: task.project_id ?? '',
        projectName: projectMap.get(task.project_id ?? '') ?? 'Unassigned project',
        owners: (assigneeIdsByTaskId.get(task.id) ?? (task.assigned_to ? [task.assigned_to] : []))
          .map((assigneeId) => profileMap.get(assigneeId))
          .filter((owner): owner is string => Boolean(owner)),
        dueAt: task.due_at ?? null,
        createdAt: task.created_at ?? new Date().toISOString(),
      }))

      setProjects(nextProjects)
      setTasks(nextTasks)
      localStorage.setItem(
        cacheKey,
        JSON.stringify({
          projects: nextProjects,
          tasks: nextTasks,
          cachedAt: new Date().toISOString(),
        } satisfies DashboardCachePayload),
      )
      setLoading(false)
    }

    void loadDashboard()

    const onRealtimeChange = (event: Event) => {
      const detail = (event as CustomEvent<{ table?: string }>).detail
      if (!detail?.table || !['tasks', 'task_assignees', 'projects', 'profiles'].includes(detail.table)) return
      void loadDashboard()
    }
    window.addEventListener('contas:realtime-change', onRealtimeChange as EventListener)

    return () => {
      cancelled = true
      window.removeEventListener('contas:realtime-change', onRealtimeChange as EventListener)
    }
  }, [cacheKey])

  const totalTasks = tasks.length
  const totalProjects = projects.length
  const totalOwners = useMemo(
    () =>
      new Set(
        tasks
          .flatMap((task) => task.owners)
          .filter((owner) => owner !== 'Unassigned'),
      ).size,
    [tasks],
  )

  const tasksDueThisWeek = useMemo(
    () =>
      tasks.filter((task) => {
        if (!task.dueAt) return false
        const due = new Date(task.dueAt)
        if (Number.isNaN(due.getTime())) return false
        const delta = daysUntil(due)
        return delta >= 0 && delta <= 7
      }).length,
    [tasks],
  )

  const projectDistribution = useMemo(
    () =>
      projects.map((project) => {
        const count = tasks.filter((task) => task.projectId === project.id).length
        return {
          ...project,
          count,
          percent: totalTasks === 0 ? 0 : Math.round((count / totalTasks) * 100),
        }
      }),
    [projects, tasks, totalTasks],
  )

  const donutGradient = useMemo(() => {
    if (totalTasks === 0) return 'conic-gradient(hsl(var(--muted-foreground)/0.2) 0 100%)'

    let cursor = 0
    const slices: string[] = []

    projectDistribution.forEach((item) => {
      if (item.count === 0) return
      const size = (item.count / totalTasks) * 100
      const next = cursor + size
      slices.push(`${item.color} ${cursor}% ${next}%`)
      cursor = next
    })

    return slices.length === 0 ? 'conic-gradient(hsl(var(--muted-foreground)/0.2) 0 100%)' : `conic-gradient(${slices.join(', ')})`
  }, [projectDistribution, totalTasks])

  const taskFeed = useMemo(
    () =>
      [...tasks]
        .sort((a, b) => {
          const aDate = a.dueAt ? new Date(a.dueAt) : null
          const bDate = b.dueAt ? new Date(b.dueAt) : null
          if (!aDate && !bDate) return 0
          if (!aDate) return 1
          if (!bDate) return -1
          return aDate.getTime() - bDate.getTime()
        })
        .slice(0, 6),
    [tasks],
  )

  const trendDays = TREND_RANGE_OPTIONS.find((option) => option.key === trendRange)?.days ?? 30
  const trendSeries = useMemo(() => buildTrendSeries(trendDays, trendRange, tasks), [trendDays, trendRange, tasks])
  const createdTotal = trendSeries.reduce((sum, point) => sum + point.created, 0)
  const reviewTotal = trendSeries.reduce((sum, point) => sum + point.review, 0)
  const overdueTotal = trendSeries.reduce((sum, point) => sum + point.overdue, 0)
  const trendMax = Math.max(...trendSeries.map((point) => Math.max(point.created, point.review, point.overdue)), 1)
  const trendLabelStep = trendRange === '90d' ? 7 : 1
  const trendPeak = trendSeries.reduce<{ label: string; total: number }>(
    (peak, point) => {
      const total = point.created + point.review + point.overdue
      if (total > peak.total) return { label: point.label, total }
      return peak
    },
    { label: trendSeries[0]?.label ?? '-', total: 0 },
  )
  const perPointWidth = trendRange === '30d' ? 42 : trendRange === '7d' ? 52 : 26
  const trendChartMinWidth = Math.max(680, trendSeries.length * perPointWidth)
  const trendChartHeight = 224
  const trendChartPaddingX = 20
  const trendChartPaddingTop = 16
  const trendChartPaddingBottom = 32
  const trendChartUsableHeight = trendChartHeight - trendChartPaddingTop - trendChartPaddingBottom

  if (loading) {
    return <DashboardHomeSkeleton />
  }

  return (
    <div className='space-y-5'>
      <section className='grid gap-4 md:grid-cols-2 xl:grid-cols-4' aria-label='Key metrics'>
        <Card className='rounded-xl'>
          <CardHeader className='pb-2'>
            <CardDescription className='text-xs uppercase tracking-wide'>Total tasks</CardDescription>
            <CardTitle className='text-2xl'>{totalTasks}</CardTitle>
          </CardHeader>
          <CardContent className='flex items-center justify-between pt-0'>
            <p className='text-xs text-muted-foreground'>Across all active work</p>
            <ChartColumnBig className='h-4 w-4 text-muted-foreground' />
          </CardContent>
        </Card>

        <Card className='rounded-xl'>
          <CardHeader className='pb-2'>
            <CardDescription className='text-xs uppercase tracking-wide'>Projects</CardDescription>
            <CardTitle className='text-2xl'>{totalProjects}</CardTitle>
          </CardHeader>
          <CardContent className='flex items-center justify-between pt-0'>
            <p className='text-xs text-muted-foreground'>Portfolio currently running</p>
            <FolderKanban className='h-4 w-4 text-muted-foreground' />
          </CardContent>
        </Card>

        <Card className='rounded-xl'>
          <CardHeader className='pb-2'>
            <CardDescription className='text-xs uppercase tracking-wide'>Owners</CardDescription>
            <CardTitle className='text-2xl'>{totalOwners}</CardTitle>
          </CardHeader>
          <CardContent className='flex items-center justify-between pt-0'>
            <p className='text-xs text-muted-foreground'>People contributing this cycle</p>
            <UsersRound className='h-4 w-4 text-muted-foreground' />
          </CardContent>
        </Card>

        <Card className='rounded-xl'>
          <CardHeader className='pb-2'>
            <CardDescription className='text-xs uppercase tracking-wide'>Due in 7 days</CardDescription>
            <CardTitle className='text-2xl'>{tasksDueThisWeek}</CardTitle>
          </CardHeader>
          <CardContent className='flex items-center justify-between pt-0'>
            <p className='text-xs text-muted-foreground'>Near-term delivery pressure</p>
            <CalendarClock className='h-4 w-4 text-muted-foreground' />
          </CardContent>
        </Card>
      </section>

      <section className='grid gap-5 xl:grid-cols-[1.35fr_1fr] xl:items-start'>
        <Card className='flex flex-col overflow-hidden rounded-xl border-border/70 bg-card/95'>
          <CardHeader className='pb-4'>
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <div>
                <CardTitle className='text-xl'>Task Trend</CardTitle>
                <CardDescription className='mt-1'>
                  Created, review-stage, and overdue flow across the selected window
                </CardDescription>
              </div>
              <div className='inline-flex rounded-lg border bg-muted/20 p-1'>
                {TREND_RANGE_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type='button'
                    onClick={() => setTrendRange(option.key)}
                    className={cn(
                      'rounded-md px-3 py-1.5 text-xs font-semibold tracking-wide transition-all',
                      trendRange === option.key
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className='flex flex-col space-y-5'>
            <div className='grid gap-2.5 sm:grid-cols-3'>
              <div className='rounded-lg border border-blue-400/20 bg-blue-400/5 px-3 py-2.5'>
                <p className='text-[11px] uppercase tracking-wide text-muted-foreground'>Created</p>
                <p className='mt-1 text-xl font-semibold text-foreground'>{createdTotal}</p>
              </div>
              <div className='rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-3 py-2.5'>
                <p className='text-[11px] uppercase tracking-wide text-muted-foreground'>Review</p>
                <p className='mt-1 text-xl font-semibold text-foreground'>{reviewTotal}</p>
              </div>
              <div className='rounded-lg border border-rose-400/20 bg-rose-400/5 px-3 py-2.5'>
                <p className='text-[11px] uppercase tracking-wide text-muted-foreground'>Overdue</p>
                <p className='mt-1 text-xl font-semibold text-foreground'>{overdueTotal}</p>
              </div>
            </div>

            <div className='rounded-xl border bg-gradient-to-b from-muted/20 to-transparent p-3'>
              <div className='mb-3 flex items-center justify-between'>
                <p className='text-xs text-muted-foreground'>Peak activity: {trendPeak.label}</p>
                <Badge variant='outline' className='rounded-full text-[11px] font-medium'>
                  {trendPeak.total} tasks
                </Badge>
              </div>
              <div className='overflow-x-auto'>
                <svg
                  className='h-56 w-full min-w-[680px]'
                  style={{ minWidth: `${trendChartMinWidth}px` }}
                  viewBox={`0 0 ${trendChartMinWidth} ${trendChartHeight}`}
                  role='img'
                  aria-label='Grouped bar chart for created, review, and overdue tasks'
                >
                  {Array.from({ length: 4 }, (_, index) => {
                    const y = trendChartPaddingTop + (trendChartUsableHeight / 3) * index
                    return (
                      <line
                        key={`grid-${index}`}
                        x1={trendChartPaddingX}
                        y1={y}
                        x2={trendChartMinWidth - trendChartPaddingX}
                        y2={y}
                        stroke='hsl(var(--border))'
                        strokeOpacity='0.4'
                      />
                    )
                  })}

                  {trendSeries.map((point, index) => {
                    const count = trendSeries.length
                    const plotWidth = trendChartMinWidth - trendChartPaddingX * 2
                    const groupWidth = plotWidth / count
                    const barWidth = Math.max(2, Math.min(4, groupWidth / 5))
                    const gap = 1.5
                    const groupStartX = trendChartPaddingX + index * groupWidth + (groupWidth - (barWidth * 3 + gap * 2)) / 2

                    const createdHeight = (point.created / trendMax) * trendChartUsableHeight
                    const reviewHeight = (point.review / trendMax) * trendChartUsableHeight
                    const overdueHeight = (point.overdue / trendMax) * trendChartUsableHeight

                    return (
                      <g key={`${point.label}-${index}`}>
                        <rect
                          x={groupStartX}
                          y={trendChartPaddingTop + (trendChartUsableHeight - createdHeight)}
                          width={barWidth}
                          height={createdHeight}
                          rx={1.5}
                          fill='#60A5FA'
                        />
                        <rect
                          x={groupStartX + barWidth + gap}
                          y={trendChartPaddingTop + (trendChartUsableHeight - reviewHeight)}
                          width={barWidth}
                          height={reviewHeight}
                          rx={1.5}
                          fill='#34D399'
                        />
                        <rect
                          x={groupStartX + (barWidth + gap) * 2}
                          y={trendChartPaddingTop + (trendChartUsableHeight - overdueHeight)}
                          width={barWidth}
                          height={overdueHeight}
                          rx={1.5}
                          fill='#FB7185'
                        />
                        {(index % trendLabelStep === 0 || index === trendSeries.length - 1) && (
                          <text
                            x={trendChartPaddingX + index * groupWidth + groupWidth / 2}
                            y={trendChartHeight - 8}
                            textAnchor='middle'
                            fontSize='9'
                            fill='hsl(var(--muted-foreground))'
                          >
                            {trendRange === '30d'
                              ? new Intl.DateTimeFormat('en-US', { day: 'numeric' }).format(point.date)
                              : point.label}
                          </text>
                        )}
                      </g>
                    )
                  })}
                </svg>
              </div>
            </div>

            <div className='mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground'>
              <span className='inline-flex items-center gap-2 rounded-full border bg-muted/20 px-2 py-1'>
                <span className='h-2.5 w-2.5 rounded-full bg-[#60A5FA]' />
                Created
              </span>
              <span className='inline-flex items-center gap-2 rounded-full border bg-muted/20 px-2 py-1'>
                <span className='h-2.5 w-2.5 rounded-full bg-[#34D399]' />
                Review
              </span>
              <span className='inline-flex items-center gap-2 rounded-full border bg-muted/20 px-2 py-1'>
                <span className='h-2.5 w-2.5 rounded-full bg-[#FB7185]' />
                Overdue
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className='flex flex-col rounded-xl'>
          <CardHeader className='pb-3'>
            <CardTitle>Project Load Mix</CardTitle>
            <CardDescription>Task share across {currentOrganization.name}</CardDescription>
          </CardHeader>
          <CardContent className='flex flex-col gap-4'>
            <div className='flex items-center justify-center'>
              <div className='relative h-52 w-52 rounded-full' style={{ backgroundImage: donutGradient }} aria-label='Project task distribution'>
                <div className='absolute inset-[26%] grid place-items-center rounded-full border bg-card'>
                  <div className='text-center'>
                    <p className='text-2xl font-semibold'>{totalTasks}</p>
                    <p className='text-xs text-muted-foreground'>total tasks</p>
                  </div>
                </div>
              </div>
            </div>

            <div className='max-h-[13rem] space-y-2 overflow-y-auto pr-1'>
              {projectDistribution.length === 0 ? (
                <div className='rounded-md border px-3 py-4 text-sm text-muted-foreground'>No projects in the database yet.</div>
              ) : (
                projectDistribution.map((project) => (
                  <div key={project.id} className='flex items-center justify-between rounded-md border px-3 py-2 text-sm'>
                    <span className='inline-flex items-center gap-2'>
                      <span className='h-2.5 w-2.5 rounded-full' style={{ backgroundColor: project.color }} />
                      <span className='text-muted-foreground'>{project.name}</span>
                    </span>
                    <span className='font-medium text-foreground'>
                      {project.count} <span className='text-muted-foreground'>({project.percent}%)</span>
                    </span>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className='grid gap-5 xl:grid-cols-[1.35fr_1fr]'>
        <Card className='flex h-full flex-col rounded-xl xl:h-[25rem]'>
          <CardHeader className='pb-3'>
            <CardTitle>Upcoming Work Feed</CardTitle>
            <CardDescription>Ordered by due date for the next execution window</CardDescription>
          </CardHeader>
          <CardContent className='flex flex-1 min-h-0 flex-col'>
            {taskFeed.length === 0 ? (
              <div className='rounded-md border bg-muted/10 px-3 py-5 text-sm text-muted-foreground'>No tasks in the database yet.</div>
            ) : (
              <div className='min-h-0 max-h-[15.5rem] space-y-2 overflow-y-auto pr-1'>
                {taskFeed.map((task) => (
                  <article key={task.id} className='flex items-center justify-between rounded-md border bg-muted/10 px-3 py-2.5'>
                    <div className='min-w-0'>
                      <p className='truncate text-sm font-medium text-foreground'>{task.title}</p>
                      <p className='text-xs text-muted-foreground'>
                        {task.projectName} • {task.owners.length > 0 ? task.owners.join(', ') : 'Unassigned'}
                      </p>
                    </div>
                    <div className='ml-3 flex items-center gap-2'>
                      <Badge variant='outline'>{task.status}</Badge>
                      <span className='text-xs text-muted-foreground'>Due {formatDueLabel(task.dueAt)}</span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className='flex h-full flex-col rounded-xl xl:h-[25rem]'>
          <CardHeader className='pb-3'>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>High-frequency actions for team leads</CardDescription>
          </CardHeader>
          <CardContent className='space-y-2'>
            <Button variant='outline' className='w-full justify-start gap-2'>
              <Rocket className='h-4 w-4' aria-hidden='true' />
              New Project
            </Button>
            <Button variant='outline' className='w-full justify-start gap-2'>
              <CalendarClock className='h-4 w-4' aria-hidden='true' />
              Plan Sprint
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
