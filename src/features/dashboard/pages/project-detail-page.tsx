import { formatDistanceToNowStrict } from 'date-fns'
import {
  CalendarDays,
  Check,
  CirclePlus,
  Columns3,
  FileText,
  Filter,
  LayoutList,
  Search,
  Sparkles,
  UserCircle2,
  Lock,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { DatePicker } from '@/components/ui/date-picker'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { GlobalSaveStatus } from '@/components/ui/global-save-status'
import { Input } from '@/components/ui/input'
import { DEFAULT_PROJECT_COLOR, PROJECT_COLOR_OPTIONS, normalizeProjectColor, projectDotStyle } from '@/features/projects/lib/project-colors'
import { useAuth } from '@/features/auth/context/auth-context'
import { CreateTaskDialog, type CreatedTaskPayload } from '@/features/tasks/components/create-task-dialog'
import { openTaskDetailsModal } from '@/features/tasks/lib/open-task-details-modal'
import { mapStatusRowsToOptions, resolveProjectStatusOptions, statusLabelFromKey, type StatusOption } from '@/features/tasks/lib/status-catalog'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

type ProjectDetail = {
  id: string
  name: string
  key: string | null
  color: string | null
  status: string | null
  description: string | null
  created_by: string | null
  owner_id: string | null
  start_date: string | null
  end_date: string | null
}

type ProfileRecord = {
  id: string
  full_name: string | null
  avatar_url: string | null
}

type LinkedTask = {
  id: string
  parent_task_id: string | null
  title: string
  description: string | null
  status: string | null
  status_id: string | null
  status_key?: string | null
  status_label?: string | null
  due_at: string | null
  start_at: string | null
  created_at: string | null
  completed_at: string | null
  priority: string | null
  assignees: ProfileRecord[]
}

type ProjectTab = 'tasks' | 'board' | 'timeline' | 'files' | 'activity'
type GroupBy = 'status' | 'assignee' | 'due_date' | 'priority'
type BackgroundSyncState = 'idle' | 'syncing' | 'saved' | 'error'

type ProjectDetailCachePayload = {
  cachedAt: number
  project: ProjectDetail | null
  linkedTasks: LinkedTask[]
  projectOwner: ProfileRecord | null
}

const PROJECT_DETAIL_CACHE_TTL_MS = 3 * 60 * 1000
const COMPLETED_STATUS_KEYS = ['done', 'completed', 'closed']

function formatShortDate(value: string | null) {
  if (!value) return 'No due date'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'No due date'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date)
}

function isTaskCompleted(task: Pick<LinkedTask, 'completed_at' | 'status_key' | 'status'>) {
  return Boolean(task.completed_at) || COMPLETED_STATUS_KEYS.includes((task.status_key ?? task.status ?? '').toLowerCase())
}

function initialsForName(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'U'
  )
}

function ProjectDetailSkeleton() {
  return (
    <div className='space-y-4'>
      <Card className='overflow-hidden'>
        <CardContent className='space-y-4 p-5'>
          <div className='h-6 w-56 rounded bg-muted/60 animate-pulse' />
          <div className='h-3.5 w-80 max-w-[75vw] rounded bg-muted/50 animate-pulse' />
          <div className='grid gap-3 md:grid-cols-[1.4fr_1fr]'>
            <div className='h-20 rounded-lg bg-muted/40 animate-pulse' />
            <div className='h-20 rounded-lg bg-muted/40 animate-pulse' />
          </div>
        </CardContent>
      </Card>
      <Card className='overflow-hidden'>
        <CardContent className='space-y-4 p-4'>
          <div className='flex flex-wrap gap-2'>
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={`project-tab-skeleton-${index}`} className='h-8 w-20 rounded-md bg-muted/50 animate-pulse' />
            ))}
          </div>
          <div className='grid gap-2 md:grid-cols-[1.2fr_repeat(4,minmax(0,1fr))]'>
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={`project-filter-skeleton-${index}`} className='h-10 rounded-md bg-muted/40 animate-pulse' />
            ))}
          </div>
          <div className='grid gap-2 md:grid-cols-2 xl:grid-cols-3'>
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={`project-task-skeleton-${index}`} className='h-24 rounded-lg border bg-muted/20 animate-pulse' />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export function ProjectDetailPage() {
  const { currentUser } = useAuth()
  const { projectId } = useParams()
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [linkedTasks, setLinkedTasks] = useState<LinkedTask[]>([])
  const [projectOwner, setProjectOwner] = useState<ProfileRecord | null>(null)
  const [profileDirectory, setProfileDirectory] = useState<ProfileRecord[]>([])
  const [loading, setLoading] = useState(Boolean(projectId))
  const [backgroundSyncState, setBackgroundSyncState] = useState<BackgroundSyncState>('idle')
  const [activeTab, setActiveTab] = useState<ProjectTab>('tasks')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [statusDefinitions, setStatusDefinitions] = useState<StatusOption[]>([])
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [sortBy, setSortBy] = useState<'due' | 'created' | 'title'>('due')
  const [groupBy, setGroupBy] = useState<GroupBy>('status')
  const [taskDialogOpen, setTaskDialogOpen] = useState(false)
  const [taskDialogType, setTaskDialogType] = useState<'task' | 'subtask'>('task')
  const [editProjectOpen, setEditProjectOpen] = useState(false)
  const [editProjectSubmitting, setEditProjectSubmitting] = useState(false)
  const [editProjectError, setEditProjectError] = useState<string | null>(null)
  const [editProjectName, setEditProjectName] = useState('')
  const [editProjectOwnerId, setEditProjectOwnerId] = useState('')
  const [editProjectColor, setEditProjectColor] = useState(DEFAULT_PROJECT_COLOR)
  const [editProjectStartDate, setEditProjectStartDate] = useState<Date | undefined>()
  const [editProjectEndDate, setEditProjectEndDate] = useState<Date | undefined>()
  const [editProjectDescription, setEditProjectDescription] = useState('')
  const [updatingTaskIds, setUpdatingTaskIds] = useState<Set<string>>(new Set())
  const backgroundSyncResetTimerRef = useRef<number | null>(null)
  const realtimeRefreshTimerRef = useRef<number | null>(null)
  const inFlightRequestIdRef = useRef(0)

  const updateBackgroundSyncState = useCallback((state: BackgroundSyncState) => {
    setBackgroundSyncState(state)
    if (backgroundSyncResetTimerRef.current !== null) {
      window.clearTimeout(backgroundSyncResetTimerRef.current)
      backgroundSyncResetTimerRef.current = null
    }
    if (state === 'saved') {
      backgroundSyncResetTimerRef.current = window.setTimeout(() => setBackgroundSyncState('idle'), 1400)
    }
  }, [])

  const cacheKey = useMemo(() => (projectId ? `contas:project-detail:${projectId}` : ''), [projectId])

  const loadProject = useCallback(async (options?: { silent?: boolean }) => {
    if (!projectId) return

    const silent = options?.silent ?? false
    const requestId = ++inFlightRequestIdRef.current
    if (!silent) {
      setLoading(true)
    } else {
      updateBackgroundSyncState('syncing')
    }

    const [projectResult, tasksResult, taskAssigneesResult, profilesResult, statusesResult] = await Promise.all([
      supabase.from('projects').select('id, name, key, color, status, description, created_by, owner_id, start_date, end_date').eq('id', projectId).limit(1),
      supabase
        .from('tasks')
        .select('id, parent_task_id, title, description, status, status_id, due_at, start_at, created_at, completed_at, priority, assigned_to, task_status:status_id(id,key,label)')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false }),
      supabase.from('task_assignees').select('task_id, assignee_id'),
      supabase.from('profiles').select('id, full_name, avatar_url'),
      supabase.from('status').select('id,key,label,sort_order,project_id,is_default').or(`project_id.is.null,project_id.eq.${projectId}`).order('sort_order', { ascending: true }),
    ])

    if (requestId !== inFlightRequestIdRef.current) return

    const projectRecord = (projectResult.data?.[0] as ProjectDetail | undefined) ?? null
    if (projectResult.error || !projectRecord) {
      setProject(null)
      setLinkedTasks([])
      setProjectOwner(null)
      if (!silent) setLoading(false)
      updateBackgroundSyncState('error')
      return
    }

    const profiles = profilesResult.data ?? []
    setProfileDirectory(profiles)
    const profileById = new Map(profiles.map((profile) => [profile.id, profile]))
    const assigneeIdsByTask = new Map<string, Set<string>>()

    for (const row of taskAssigneesResult.data ?? []) {
      const current = assigneeIdsByTask.get(row.task_id) ?? new Set<string>()
      current.add(row.assignee_id)
      assigneeIdsByTask.set(row.task_id, current)
    }

    const mappedTasks: LinkedTask[] = (tasksResult.data ?? []).map((task) => {
      const relationAssignees = Array.from(assigneeIdsByTask.get(task.id) ?? [])
      const fallbackAssignees = task.assigned_to ? [task.assigned_to] : []
      const assigneeIds = relationAssignees.length > 0 ? relationAssignees : fallbackAssignees
      const taskStatus = (task.task_status as { key?: string; label?: string } | null) ?? null
      return {
        id: task.id,
        parent_task_id: task.parent_task_id ?? null,
        title: task.title,
        description: task.description ?? null,
        status: task.status,
        status_id: task.status_id ?? null,
        status_key: taskStatus?.key ?? task.status ?? null,
        status_label: taskStatus?.label ?? statusLabelFromKey(task.status),
        due_at: task.due_at,
        start_at: task.start_at,
        created_at: task.created_at,
        completed_at: task.completed_at,
        priority: task.priority,
        assignees: assigneeIds
          .map((assigneeId) => profileById.get(assigneeId))
          .filter((item): item is ProfileRecord => Boolean(item)),
      }
    })

    setProject(projectRecord)
    setLinkedTasks(mappedTasks)
    setStatusDefinitions(resolveProjectStatusOptions(mapStatusRowsToOptions(statusesResult.data ?? []), projectId))
    const owner = projectRecord.owner_id ? (profileById.get(projectRecord.owner_id) ?? null) : null
    setProjectOwner(owner)
    if (!silent) setLoading(false)
    updateBackgroundSyncState(silent ? 'saved' : 'idle')
    if (cacheKey) {
      const payload: ProjectDetailCachePayload = {
        cachedAt: Date.now(),
        project: projectRecord,
        linkedTasks: mappedTasks,
        projectOwner: owner,
      }
      localStorage.setItem(cacheKey, JSON.stringify(payload))
    }
  }, [cacheKey, projectId, updateBackgroundSyncState])

  useEffect(() => {
    if (!projectId) return
    let hydratedFromCache = false
    if (cacheKey) {
      const raw = localStorage.getItem(cacheKey)
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as ProjectDetailCachePayload
          const isFresh = Date.now() - parsed.cachedAt < PROJECT_DETAIL_CACHE_TTL_MS
          if (isFresh && parsed.project) {
            hydratedFromCache = true
            setProject(parsed.project)
            setLinkedTasks(parsed.linkedTasks ?? [])
            setProjectOwner(parsed.projectOwner ?? null)
            setLoading(false)
          }
        } catch {
          localStorage.removeItem(cacheKey)
        }
      }
    }
    void loadProject({ silent: hydratedFromCache })
  }, [cacheKey, projectId, loadProject])

  useEffect(() => {
    const onRealtimeChange = (event: Event) => {
      const detail = (event as CustomEvent<{ table?: string }>).detail
      if (!detail?.table) return
      if (!['projects', 'tasks', 'task_assignees', 'profiles', 'status'].includes(detail.table)) return
      if (realtimeRefreshTimerRef.current !== null) {
        window.clearTimeout(realtimeRefreshTimerRef.current)
      }
      realtimeRefreshTimerRef.current = window.setTimeout(() => {
        void loadProject({ silent: true })
      }, 250)
    }
    window.addEventListener('contas:realtime-change', onRealtimeChange as EventListener)
    return () => {
      window.removeEventListener('contas:realtime-change', onRealtimeChange as EventListener)
      if (realtimeRefreshTimerRef.current !== null) {
        window.clearTimeout(realtimeRefreshTimerRef.current)
      }
      if (backgroundSyncResetTimerRef.current !== null) {
        window.clearTimeout(backgroundSyncResetTimerRef.current)
      }
    }
  }, [loadProject])

  const assigneeOptions = useMemo(() => {
    const map = new Map<string, ProfileRecord>()
    for (const task of linkedTasks) {
      for (const assignee of task.assignees) map.set(assignee.id, assignee)
    }
    return Array.from(map.values()).sort((a, b) => (a.full_name ?? '').localeCompare(b.full_name ?? ''))
  }, [linkedTasks])

  const statusOptions = useMemo(() => {
    return statusDefinitions.map((definition) => ({ key: definition.key, label: definition.label }))
  }, [statusDefinitions])

  const completedStatusOption = useMemo(
    () => statusDefinitions.find((status) => COMPLETED_STATUS_KEYS.includes(status.key.toLowerCase())) ?? null,
    [statusDefinitions],
  )
  const reopenStatusOption = useMemo(
    () =>
      statusDefinitions.find((status) => {
        const key = status.key.toLowerCase()
        return key === 'in_progress' || key === 'planned' || key === 'review'
      }) ??
      statusDefinitions.find((status) => !COMPLETED_STATUS_KEYS.includes(status.key.toLowerCase())) ??
      null,
    [statusDefinitions],
  )

  const summary = useMemo(() => {
    const total = linkedTasks.length
    const completed = linkedTasks.filter((task) => isTaskCompleted(task)).length
    const inProgress = linkedTasks.filter((task) => ['in_progress', 'review'].includes((task.status_key ?? task.status ?? '').toLowerCase())).length
    const planned = linkedTasks.filter((task) => (task.status_key ?? task.status ?? 'planned') === 'planned').length
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0
    return { total, completed, inProgress, planned, percent }
  }, [linkedTasks])

  const toggleTaskCompletion = useCallback(
    async (task: LinkedTask) => {
      if (updatingTaskIds.has(task.id)) return
      const currentlyCompleted = isTaskCompleted(task)
      const nextCompletedAt = currentlyCompleted ? null : new Date().toISOString()
      const nextStatus = currentlyCompleted ? reopenStatusOption?.key ?? 'planned' : completedStatusOption?.key ?? task.status ?? 'done'
      const nextStatusId = currentlyCompleted ? reopenStatusOption?.id ?? null : completedStatusOption?.id ?? task.status_id
      const nextStatusKey = currentlyCompleted ? reopenStatusOption?.key ?? 'planned' : completedStatusOption?.key ?? task.status_key ?? 'done'
      const nextStatusLabel = currentlyCompleted
        ? reopenStatusOption?.label ?? statusLabelFromKey(nextStatus)
        : completedStatusOption?.label ?? statusLabelFromKey(completedStatusOption?.key ?? nextStatus)

      setUpdatingTaskIds((current) => {
        const next = new Set(current)
        next.add(task.id)
        return next
      })
      setLinkedTasks((current) =>
        current.map((item) =>
          item.id === task.id
            ? { ...item, completed_at: nextCompletedAt, status: nextStatus, status_id: nextStatusId, status_key: nextStatusKey, status_label: nextStatusLabel }
            : item,
        ),
      )
      updateBackgroundSyncState('syncing')

      const { error } = await supabase
        .from('tasks')
        .update({
          completed_at: nextCompletedAt,
          status: nextStatus,
          status_id: nextStatusId,
          board_column: nextStatus === 'planned' || nextStatus === 'in_progress' || nextStatus === 'review' || nextStatus === 'blocked' ? nextStatus : null,
        })
        .eq('id', task.id)

      setUpdatingTaskIds((current) => {
        const next = new Set(current)
        next.delete(task.id)
        return next
      })

      if (error) {
        setLinkedTasks((current) => current.map((item) => (item.id === task.id ? task : item)))
        updateBackgroundSyncState('error')
        return
      }

      updateBackgroundSyncState('saved')
      void loadProject({ silent: true })
    },
    [completedStatusOption, loadProject, reopenStatusOption, updateBackgroundSyncState, updatingTaskIds],
  )

  const filteredTasks = useMemo(() => {
    const filtered = linkedTasks.filter((task) => {
      const effectiveStatus = task.status_key ?? task.status ?? 'planned'
      if (statusFilter !== 'all' && effectiveStatus !== statusFilter) return false
      if (assigneeFilter !== 'all' && !task.assignees.some((assignee) => assignee.id === assigneeFilter)) return false
      if (search.trim()) {
        const haystack = `${task.title} ${task.id} ${task.assignees.map((a) => a.full_name ?? '').join(' ')}`.toLowerCase()
        if (!haystack.includes(search.trim().toLowerCase())) return false
      }
      return true
    })

    if (sortBy === 'title') {
      return [...filtered].sort((a, b) => a.title.localeCompare(b.title))
    }

    if (sortBy === 'created') {
      return [...filtered].sort((a, b) => (new Date(b.created_at ?? 0).getTime() || 0) - (new Date(a.created_at ?? 0).getTime() || 0))
    }

    return [...filtered].sort((a, b) => {
      const aTime = a.due_at ? new Date(a.due_at).getTime() : Number.POSITIVE_INFINITY
      const bTime = b.due_at ? new Date(b.due_at).getTime() : Number.POSITIVE_INFINITY
      return aTime - bTime
    })
  }, [assigneeFilter, linkedTasks, search, sortBy, statusFilter])

  const groupedTasks = useMemo(() => {
    const groups = new Map<string, LinkedTask[]>()
    for (const task of filteredTasks) {
      let key = 'Other'
      if (groupBy === 'status') key = task.status_label ?? statusLabelFromKey(task.status_key ?? task.status)
      if (groupBy === 'assignee') key = task.assignees[0]?.full_name ?? 'Unassigned'
      if (groupBy === 'due_date') key = task.due_at ? formatShortDate(task.due_at) : 'No due date'
      if (groupBy === 'priority') key = task.priority ? task.priority[0].toUpperCase() + task.priority.slice(1) : 'No priority'
      const current = groups.get(key) ?? []
      current.push(task)
      groups.set(key, current)
    }
    return Array.from(groups.entries())
  }, [filteredTasks, groupBy])

  const timelineTasks = useMemo(
    () =>
      [...linkedTasks]
        .filter((task) => task.due_at || task.start_at)
        .sort((a, b) => {
          const aTime = new Date(a.start_at ?? a.due_at ?? 0).getTime() || 0
          const bTime = new Date(b.start_at ?? b.due_at ?? 0).getTime() || 0
          return aTime - bTime
        }),
    [linkedTasks],
  )

  const activityItems = useMemo(
    () =>
      [...linkedTasks]
        .filter((task) => task.created_at)
        .slice(0, 15)
        .map((task) => ({
          id: task.id,
          label: `Task "${task.title}" was created`,
          when: task.created_at ? formatDistanceToNowStrict(new Date(task.created_at), { addSuffix: true }) : 'Recently',
        })),
    [linkedTasks],
  )

  const openEditProjectDialog = () => {
    if (!project) return
    if (!currentUser?.id || project.created_by !== currentUser.id) return
    setEditProjectName(project.name)
    setEditProjectOwnerId(project.owner_id ?? '')
    setEditProjectColor(normalizeProjectColor(project.color))
    setEditProjectStartDate(project.start_date ? new Date(project.start_date) : undefined)
    setEditProjectEndDate(project.end_date ? new Date(project.end_date) : undefined)
    setEditProjectDescription(project.description ?? '')
    setEditProjectError(null)
    setEditProjectOpen(true)
  }

  const handleSaveProjectEdits = async () => {
    if (!project) return
    const trimmedName = editProjectName.trim()
    const trimmedDescription = editProjectDescription.trim()
    if (!trimmedName) {
      setEditProjectError('Project name is required.')
      return
    }
    if (editProjectStartDate && editProjectEndDate && editProjectStartDate.getTime() > editProjectEndDate.getTime()) {
      setEditProjectError('Start date must be before or equal to target end date.')
      return
    }

    setEditProjectSubmitting(true)
    setEditProjectError(null)
    const payload = {
      name: trimmedName,
      owner_id: editProjectOwnerId || null,
      color: normalizeProjectColor(editProjectColor),
      start_date: editProjectStartDate ? editProjectStartDate.toISOString().slice(0, 10) : null,
      end_date: editProjectEndDate ? editProjectEndDate.toISOString().slice(0, 10) : null,
      description: trimmedDescription || null,
    }

    const { data, error } = await supabase
      .from('projects')
      .update(payload)
      .eq('id', project.id)
      .select('id, name, key, color, status, description, created_by, owner_id, start_date, end_date')
      .limit(1)
    const updatedProject = (data?.[0] as ProjectDetail | undefined) ?? null

    if (error || !updatedProject) {
      setEditProjectSubmitting(false)
      setEditProjectError(error?.message ?? 'Could not update project details.')
      return
    }

    setProject(updatedProject)
    const owner = payload.owner_id ? profileDirectory.find((profile) => profile.id === payload.owner_id) ?? null : null
    setProjectOwner(owner)
    setEditProjectSubmitting(false)
    setEditProjectOpen(false)
    updateBackgroundSyncState('saved')
    window.dispatchEvent(new CustomEvent('contas:realtime-change', { detail: { table: 'projects', eventType: 'manual' } }))
  }

  const handleTaskCreated = useCallback(
    (created: CreatedTaskPayload) => {
      if (!projectId || created.projectId !== projectId) return
      setLinkedTasks((current) => {
        if (current.some((task) => task.id === created.id)) return current
        const optimisticTask: LinkedTask = {
          id: created.id,
          parent_task_id: created.parentTaskId ?? null,
          title: created.title,
          description: created.description ?? null,
          status: created.status ?? created.statusKey ?? 'planned',
          status_id: created.statusId ?? null,
          status_key: created.statusKey ?? created.status ?? 'planned',
          status_label: statusDefinitions.find((definition) => definition.id === created.statusId)?.label ?? statusLabelFromKey(created.statusKey ?? created.status ?? 'planned'),
          due_at: created.dueAt,
          start_at: created.startAt ?? null,
          created_at: created.createdAt,
          completed_at: null,
          priority: created.priority,
          assignees: created.assigneeIds.map((assigneeId, index) => ({
            id: assigneeId,
            full_name: created.assigneeNames[index] ?? null,
            avatar_url: null,
          })),
        }
        return [optimisticTask, ...current]
      })
      updateBackgroundSyncState('syncing')
      void loadProject({ silent: true })
    },
    [loadProject, projectId, statusDefinitions, updateBackgroundSyncState],
  )

  const canEditProject = Boolean(currentUser?.id && project?.created_by === currentUser.id)

  if (!projectId) return <Navigate to='/dashboard/projects' replace />

  if (loading) {
    return <ProjectDetailSkeleton />
  }

  if (!project) return <Navigate to='/dashboard/projects' replace />

  return (
    <div className='space-y-4'>
      <Card className='overflow-hidden'>
        <CardContent className='space-y-4 p-5'>
          <div className='flex flex-wrap items-start justify-between gap-3'>
            <div className='space-y-1.5'>
              <div className='flex items-center gap-2'>
                <span className='h-2.5 w-2.5 rounded-full' style={projectDotStyle(project.color)} />
                <h1 className='text-xl font-semibold tracking-tight text-foreground'>{project.name}</h1>
                <Badge variant='outline'>{project.key ?? 'PRJ'}</Badge>
              </div>
              <p className='text-sm text-muted-foreground'>{project.description?.trim() || 'No description provided yet.'}</p>
              <p className='text-xs text-muted-foreground'>
                Owner: <span className='font-medium text-foreground'>{projectOwner?.full_name ?? 'Unassigned'}</span>
              </p>
            </div>
            <div className='flex items-center gap-2'>
              <Button size='sm' variant='outline' onClick={openEditProjectDialog} disabled={!canEditProject}>
                {!canEditProject ? <Lock className='h-4 w-4' /> : null}
                {canEditProject ? 'Edit Project' : 'Locked'}
              </Button>
              <Button
                size='sm'
                onClick={() => {
                  setTaskDialogType('task')
                  setTaskDialogOpen(true)
                }}
              >
                <CirclePlus className='h-4 w-4' />
                New Task
              </Button>
              <Button
                size='sm'
                variant='outline'
                onClick={() => {
                  setTaskDialogType('subtask')
                  setTaskDialogOpen(true)
                }}
              >
                <CirclePlus className='h-4 w-4' />
                Subtask
              </Button>
              <GlobalSaveStatus state={backgroundSyncState} />
            </div>
          </div>

          <div className='grid gap-3 md:grid-cols-[1.4fr_1fr]'>
            <div className='rounded-lg border bg-muted/10 p-3'>
              <div className='flex items-center justify-between text-xs text-muted-foreground'>
                <span>Progress</span>
                <span className='font-medium text-foreground'>{summary.percent}%</span>
              </div>
              <div className='mt-2 h-2.5 rounded-full bg-muted/60'>
                <div className='h-full rounded-full bg-primary transition-[width] duration-300' style={{ width: `${summary.percent}%` }} />
              </div>
              <p className='mt-2 text-xs text-muted-foreground'>
                Completed: {summary.completed} / {summary.total} tasks
              </p>
            </div>
            <div className='flex flex-wrap items-center gap-2'>
              <Badge variant='outline'>{statusLabelFromKey(project.status)}</Badge>
              <Badge variant='outline'>{summary.total} Tasks</Badge>
              <Badge variant='outline'>{summary.inProgress} In Progress</Badge>
              <Badge variant='outline'>{summary.planned} Planned</Badge>
              <Badge variant='outline'>Start {project.start_date ? formatShortDate(project.start_date) : 'TBD'}</Badge>
              <Badge variant='outline'>Due {project.end_date ? formatShortDate(project.end_date) : 'TBD'}</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className='overflow-hidden'>
        <CardContent className='space-y-4 p-4'>
          <div className='flex flex-wrap items-center gap-2'>
            {([
              { key: 'tasks', label: 'Tasks', icon: LayoutList },
              { key: 'board', label: 'Board', icon: Columns3 },
              { key: 'timeline', label: 'Timeline', icon: CalendarDays },
              { key: 'files', label: 'Files', icon: FileText },
              { key: 'activity', label: 'Activity', icon: Sparkles },
            ] as const).map((tab) => (
              <button
                key={tab.key}
                type='button'
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors',
                  activeTab === tab.key ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent',
                )}
              >
                <tab.icon className='h-4 w-4' />
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'tasks' ? (
            <>
              <div className='grid gap-2 md:grid-cols-[1.2fr_repeat(4,minmax(0,1fr))]'>
                <div className='relative'>
                  <Search className='pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
                  <Input value={search} onChange={(event) => setSearch(event.target.value)} className='pl-9' placeholder='Search tasks...' />
                </div>
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className='h-10 rounded-md border border-input bg-background px-3 text-sm'
                >
                  <option value='all'>Status: All</option>
                  {statusOptions.map((status) => (
                    <option key={status.key} value={status.key}>
                      {status.label}
                    </option>
                  ))}
                </select>
                <select
                  value={assigneeFilter}
                  onChange={(event) => setAssigneeFilter(event.target.value)}
                  className='h-10 rounded-md border border-input bg-background px-3 text-sm'
                >
                  <option value='all'>Assignee: All</option>
                  {assigneeOptions.map((assignee) => (
                    <option key={assignee.id} value={assignee.id}>
                      {assignee.full_name ?? 'Unknown'}
                    </option>
                  ))}
                </select>
                <select value={sortBy} onChange={(event) => setSortBy(event.target.value as 'due' | 'created' | 'title')} className='h-10 rounded-md border border-input bg-background px-3 text-sm'>
                  <option value='due'>Sort: Due date</option>
                  <option value='created'>Sort: Created</option>
                  <option value='title'>Sort: Title</option>
                </select>
                <select value={groupBy} onChange={(event) => setGroupBy(event.target.value as GroupBy)} className='h-10 rounded-md border border-input bg-background px-3 text-sm'>
                  <option value='status'>Group: Status</option>
                  <option value='assignee'>Group: Assignee</option>
                  <option value='due_date'>Group: Due date</option>
                  <option value='priority'>Group: Priority</option>
                </select>
              </div>

              {groupedTasks.length === 0 ? (
                <div className='rounded-lg border border-dashed bg-muted/10 p-8 text-center'>
                  <p className='text-sm font-medium text-foreground'>No tasks yet.</p>
                  <p className='mt-1 text-sm text-muted-foreground'>Create your first task to start tracking progress.</p>
                  <Button
                    className='mt-4'
                    onClick={() => {
                      setTaskDialogType('task')
                      setTaskDialogOpen(true)
                    }}
                  >
                    <CirclePlus className='h-4 w-4' />
                    Create Task
                  </Button>
                </div>
              ) : (
                groupedTasks.map(([group, tasks]) => (
                  <section key={group} className='space-y-2'>
                    <div className='flex items-center gap-2'>
                      <Filter className='h-3.5 w-3.5 text-muted-foreground' />
                      <h3 className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>{group}</h3>
                      <span className='text-xs text-muted-foreground'>{tasks.length}</span>
                    </div>
                    <div className='grid gap-2 md:grid-cols-2 xl:grid-cols-3'>
                      {tasks.map((task) => {
                        const taskIsCompleted = isTaskCompleted(task)
                        const isUpdatingTask = updatingTaskIds.has(task.id)
                        return (
                        <article key={task.id} className='rounded-lg border bg-card px-3 py-2.5 transition-colors hover:bg-accent/35'>
                          <div className='flex items-start justify-between gap-3'>
                            <div className='flex min-w-0 flex-1 items-start gap-2'>
                              <button
                                type='button'
                                onClick={() => void toggleTaskCompletion(task)}
                                disabled={isUpdatingTask}
                                aria-label={taskIsCompleted ? `Mark ${task.title} as incomplete` : `Mark ${task.title} as complete`}
                                className={cn(
                                  'mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                                  taskIsCompleted
                                    ? 'border-emerald-500 bg-emerald-500 text-white'
                                    : 'border-border bg-background text-transparent',
                                  isUpdatingTask && 'cursor-not-allowed opacity-60',
                                )}
                              >
                                <Check className='h-3 w-3' aria-hidden='true' />
                              </button>
                              <button type='button' onClick={() => openTaskDetailsModal(task.id)} className='min-w-0 flex-1 text-left'>
                                <div className='min-w-0'>
                                  <div className='flex items-center gap-2'>
                                    <p className={cn('truncate text-sm font-medium text-foreground', taskIsCompleted && 'line-through opacity-70')}>{task.title}</p>
                                    {task.parent_task_id ? (
                                      <Badge variant='outline' className='h-5 rounded-full px-2 text-[10px] uppercase tracking-wide'>
                                        Subtask
                                      </Badge>
                                    ) : null}
                                  </div>
                                  <div className='mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
                                    <span className='inline-flex items-center gap-1'>
                                      <CalendarDays className='h-3.5 w-3.5' />
                                      Start {formatShortDate(task.start_at)}
                                    </span>
                                    <span>•</span>
                                    <span className='inline-flex items-center gap-1'>
                                      <CalendarDays className='h-3.5 w-3.5' />
                                      Due {formatShortDate(task.due_at)}
                                    </span>
                                    <span>•</span>
                                    <span>{task.status_label ?? statusLabelFromKey(task.status_key ?? task.status)}</span>
                                  </div>
                                </div>
                              </button>
                            </div>
                            <div className='flex items-center gap-2'>
                              <div className='flex -space-x-2'>
                                {task.assignees.slice(0, 3).map((assignee) => (
                                  <Avatar key={assignee.id} className='h-6 w-6 border-2 border-background'>
                                    {assignee.avatar_url ? <AvatarImage src={assignee.avatar_url} alt={assignee.full_name ?? 'User'} /> : null}
                                    <AvatarFallback className='text-[9px] font-semibold'>{initialsForName(assignee.full_name ?? 'User')}</AvatarFallback>
                                  </Avatar>
                                ))}
                              </div>
                              {task.assignees.length === 0 ? <UserCircle2 className='h-4 w-4 text-muted-foreground' /> : null}
                            </div>
                          </div>
                        </article>
                      )})}
                    </div>
                  </section>
                ))
              )}
            </>
          ) : null}

          {activeTab === 'board' ? (
            <div className='grid gap-3 lg:grid-cols-4 xl:grid-cols-5'>
              {statusOptions.map((statusOption) => {
                const tasks = linkedTasks.filter((task) => (task.status_key ?? task.status ?? 'planned') === statusOption.key)
                return (
                  <div key={statusOption.key} className='rounded-lg border bg-muted/10 p-2.5'>
                    <div className='mb-2 flex items-center justify-between'>
                      <p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>{statusOption.label}</p>
                      <Badge variant='outline'>{tasks.length}</Badge>
                    </div>
                    <div className='space-y-2'>
                      {tasks.length === 0 ? (
                        <p className='rounded-md border border-dashed px-2 py-3 text-center text-xs text-muted-foreground'>No tasks</p>
                      ) : (
                        tasks.map((task) => (
                          <button
                            key={task.id}
                            type='button'
                            onClick={() => openTaskDetailsModal(task.id)}
                            className='block w-full rounded-md border bg-card px-2 py-2 text-left text-sm transition-colors hover:bg-accent/35'
                          >
                            <div className='flex items-center gap-2'>
                              <p className='line-clamp-2 font-medium'>{task.title}</p>
                              {task.parent_task_id ? (
                                <Badge variant='outline' className='h-5 rounded-full px-2 text-[10px] uppercase tracking-wide'>
                                  Subtask
                                </Badge>
                              ) : null}
                            </div>
                            <p className='mt-1 text-xs text-muted-foreground'>
                              Start {formatShortDate(task.start_at)} · Due {formatShortDate(task.due_at)}
                            </p>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : null}

          {activeTab === 'timeline' ? (
            <div className='space-y-2'>
              {timelineTasks.length === 0 ? (
                <p className='rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground'>No scheduled tasks yet.</p>
              ) : (
                timelineTasks.map((task) => (
                  <button
                    key={task.id}
                    type='button'
                    onClick={() => openTaskDetailsModal(task.id)}
                    className='block w-full rounded-md border bg-card px-3 py-2.5 text-left transition-colors hover:bg-accent/35'
                  >
                    <div className='flex items-center gap-2'>
                      <p className='text-sm font-medium text-foreground'>{task.title}</p>
                      {task.parent_task_id ? (
                        <Badge variant='outline' className='h-5 rounded-full px-2 text-[10px] uppercase tracking-wide'>
                          Subtask
                        </Badge>
                      ) : null}
                    </div>
                    <p className='mt-1 text-xs text-muted-foreground'>
                      {task.start_at ? formatShortDate(task.start_at) : 'No start date'} → {formatShortDate(task.due_at)}
                    </p>
                  </button>
                ))
              )}
            </div>
          ) : null}

          {activeTab === 'files' ? (
            <div className='rounded-md border border-dashed bg-muted/10 px-3 py-8 text-center'>
              <p className='text-sm font-medium text-foreground'>No files linked yet.</p>
              <p className='mt-1 text-sm text-muted-foreground'>Attach files from task comments to see them here.</p>
            </div>
          ) : null}

          {activeTab === 'activity' ? (
            <div className='space-y-2'>
              {activityItems.length === 0 ? (
                <p className='rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground'>No activity yet.</p>
              ) : (
                activityItems.map((item) => (
                  <article key={item.id} className='rounded-md border bg-card px-3 py-2.5'>
                    <p className='text-sm text-foreground'>{item.label}</p>
                    <p className='mt-1 text-xs text-muted-foreground'>{item.when}</p>
                  </article>
                ))
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className='text-sm'>
        <Link to='/dashboard/my-tasks' className='inline-flex items-center gap-1 text-primary hover:underline'>
          Back to My Tasks
          <span aria-hidden='true'>→</span>
        </Link>
      </div>

      <CreateTaskDialog
        open={taskDialogOpen}
        onOpenChange={setTaskDialogOpen}
        initialTaskType={taskDialogType}
        onTaskCreated={handleTaskCreated}
      />

      <Dialog open={editProjectOpen} onOpenChange={setEditProjectOpen}>
        <DialogContent className='max-w-2xl'>
          <DialogHeader>
            <DialogTitle>Edit Project</DialogTitle>
            <DialogDescription>Update project details and color. Changes are saved to the projects table.</DialogDescription>
          </DialogHeader>
          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <label className='text-sm font-medium text-foreground'>Project Name</label>
              <Input value={editProjectName} onChange={(event) => setEditProjectName(event.target.value)} placeholder='Project name' />
            </div>
            <div className='space-y-2'>
              <label className='text-sm font-medium text-foreground'>Owner</label>
              <select
                value={editProjectOwnerId}
                onChange={(event) => setEditProjectOwnerId(event.target.value)}
                className='flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
              >
                <option value=''>Unassigned</option>
                {profileDirectory.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.full_name ?? 'Unknown user'}
                  </option>
                ))}
              </select>
            </div>
            <div className='space-y-2'>
              <label className='text-sm font-medium text-foreground'>Start Date</label>
              <DatePicker value={editProjectStartDate} onChange={setEditProjectStartDate} placeholder='Pick start date' />
            </div>
            <div className='space-y-2'>
              <label className='text-sm font-medium text-foreground'>Target End Date</label>
              <DatePicker value={editProjectEndDate} onChange={setEditProjectEndDate} placeholder='Pick end date' />
            </div>
            <div className='space-y-2 md:col-span-2'>
              <label className='text-sm font-medium text-foreground'>Project Color</label>
              <div className='flex flex-wrap items-center gap-3 rounded-md border border-input bg-background px-3 py-2'>
                {PROJECT_COLOR_OPTIONS.map((color) => (
                  <button
                    key={color}
                    type='button'
                    onClick={() => setEditProjectColor(color)}
                    className={`h-6 w-6 rounded-full border-2 ${normalizeProjectColor(editProjectColor) === color ? 'border-foreground' : 'border-transparent'}`}
                    style={projectDotStyle(color)}
                    aria-label={`Select project color ${color}`}
                  />
                ))}
                <span className='ml-auto inline-flex items-center gap-2 text-xs text-muted-foreground'>
                  Custom
                  <input
                    type='color'
                    value={normalizeProjectColor(editProjectColor)}
                    onChange={(event) => setEditProjectColor(event.target.value)}
                    className='h-7 w-9 cursor-pointer rounded border border-input bg-background p-0.5'
                    aria-label='Pick custom project color'
                  />
                </span>
              </div>
            </div>
            <div className='space-y-2 md:col-span-2'>
              <label className='text-sm font-medium text-foreground'>Description</label>
              <textarea
                rows={5}
                value={editProjectDescription}
                onChange={(event) => setEditProjectDescription(event.target.value)}
                placeholder='Describe the project scope, goals, and outcomes.'
                className='flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
              />
            </div>
          </div>
          <DialogFooter>
            {editProjectError ? <p className='mr-auto text-sm text-destructive'>{editProjectError}</p> : null}
            <Button type='button' variant='outline' onClick={() => setEditProjectOpen(false)}>
              Cancel
            </Button>
            <Button type='button' onClick={() => void handleSaveProjectEdits()} disabled={editProjectSubmitting}>
              {editProjectSubmitting ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
