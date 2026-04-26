import {
  ArrowUpRight,
  AtSign,
  Bell,
  CheckCheck,
  CirclePlus,
  FolderOpen,
  Goal,
  HelpCircle,
  Layers,
  Menu,
  MessageSquarePlus,
  Search,
  ShieldAlert,
  X,
  UserPlus2,
  Users2,
  CheckSquare,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuth } from '@/features/auth/context/auth-context'
import { useUnreadNotifications } from '@/features/layout/hooks/use-unread-notifications'
import { adjustCachedUnreadCount } from '@/features/layout/lib/unread-notifications-sync'
import { Input } from '@/components/ui/input'
import { CreateTaskDialog } from '@/features/tasks/components/create-task-dialog'
import { openTaskDetailsModal } from '@/features/tasks/lib/open-task-details-modal'
import { DEFAULT_PROJECT_COLOR, PROJECT_COLOR_OPTIONS, normalizeProjectColor, projectDotStyle } from '@/features/projects/lib/project-colors'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

import { AccountMenu } from './account-menu'
import { InvitePeopleDialog } from './invite-people-dialog'

type ProjectOwnerOption = {
  id: string
  name: string
}

type HeaderNotificationType = 'mention' | 'task' | 'system'

type HeaderNotificationItem = {
  id: string
  title: string
  message: string
  taskId?: string
  chatRoomId?: string
  createdAt: string
  type: HeaderNotificationType
  read: boolean
}

type HeaderSearchProjectRow = {
  id: string
  name: string
  key: string
  description: string | null
  status: string | null
}

type HeaderSearchTaskRow = {
  id: string
  title: string
  status: string | null
  due_at: string | null
  project_name: string | null
  project_key: string | null
  assignee_names: string[]
}

type HeaderSearchGoalRow = {
  id: string
  title: string
  health: string | null
  cycle: string | null
  department: string | null
  owner_name: string | null
  due_at: string | null
}

type HeaderSearchPersonRow = {
  id: string
  full_name: string
  username: string | null
  email: string | null
  avatar_url: string | null
  role_label: string | null
  job_title: string | null
  department: string | null
}

type HeaderSearchData = {
  projects: HeaderSearchProjectRow[]
  tasks: HeaderSearchTaskRow[]
  goals: HeaderSearchGoalRow[]
  people: HeaderSearchPersonRow[]
}

type HeaderSearchItem = {
  id: string
  title: string
  description: string
  meta: string | undefined
  kind: 'task' | 'project' | 'goal' | 'person' | 'action'
  score: number
  avatarUrl: string | null | undefined
  onSelect: () => void
}

const HEADER_SEARCH_CACHE_TTL_MS = 5 * 60 * 1000
const HEADER_SEARCH_RELOAD_DEBOUNCE_MS = 250
const HEADER_SEARCH_CACHE_KEY = 'contas.header-search.cache.v1'

function getHeaderSearchCacheKey(userId: string) {
  return `${HEADER_SEARCH_CACHE_KEY}:${userId}`
}

function readHeaderSearchCache(userId: string): { cachedAt: number; data: HeaderSearchData } | null {
  try {
    const raw = localStorage.getItem(getHeaderSearchCacheKey(userId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { cachedAt?: number; data?: HeaderSearchData }
    if (!parsed?.cachedAt || !parsed.data) return null
    if (Date.now() - parsed.cachedAt > HEADER_SEARCH_CACHE_TTL_MS) return null
    return { cachedAt: parsed.cachedAt, data: parsed.data }
  } catch {
    return null
  }
}

function writeHeaderSearchCache(userId: string, data: HeaderSearchData) {
  try {
    localStorage.setItem(getHeaderSearchCacheKey(userId), JSON.stringify({ cachedAt: Date.now(), data }))
  } catch {
    // Ignore storage failures.
  }
}

function normalizeSearchText(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase()
}

function scoreSearchMatch(query: string, haystacks: Array<string | null | undefined>) {
  if (!query) return 0

  let score = 0
  for (const value of haystacks) {
    const candidate = normalizeSearchText(value)
    if (!candidate) continue
    if (candidate.startsWith(query)) {
      score = Math.max(score, 100)
    } else if (candidate.includes(query)) {
      score = Math.max(score, 60)
    }
  }

  return score
}

function formatSearchRelativeDate(value: string | null | undefined) {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(parsed)
}

function getSearchProfileName(profile: Pick<HeaderSearchPersonRow, 'full_name' | 'email'> | null | undefined) {
  return profile?.full_name || profile?.email || 'Unknown teammate'
}

function isHeaderSearchItem(item: HeaderSearchItem | null): item is HeaderSearchItem {
  return item !== null
}

function getSearchProfileRole(profile: Pick<HeaderSearchPersonRow, 'job_title' | 'role_label' | 'department'>) {
  return profile.job_title ?? profile.role_label ?? profile.department ?? 'Team member'
}

function getSearchProfileInitials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'U'
}

function SearchResultIcon({
  kind,
}: {
  kind: HeaderSearchItem['kind']
}) {
  if (kind === 'task') return <CheckSquare className='h-4 w-4 text-emerald-500' aria-hidden='true' />
  if (kind === 'project') return <FolderOpen className='h-4 w-4 text-sky-500' aria-hidden='true' />
  if (kind === 'goal') return <Goal className='h-4 w-4 text-violet-500' aria-hidden='true' />
  if (kind === 'person') return <Users2 className='h-4 w-4 text-amber-500' aria-hidden='true' />
  return <ArrowUpRight className='h-4 w-4 text-muted-foreground' aria-hidden='true' />
}

function SearchResultRow({
  item,
  active,
  onSelect,
  onHover,
}: {
  item: HeaderSearchItem
  active: boolean
  onSelect: () => void
  onHover: () => void
}) {
  return (
    <button
      type='button'
      onClick={onSelect}
      onMouseEnter={onHover}
      className={cn(
        'flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition',
        active
          ? 'border-primary/30 bg-primary/10 shadow-[0_10px_24px_hsl(var(--foreground)/0.08)]'
          : 'border-transparent bg-transparent hover:border-border/70 hover:bg-muted/40',
      )}
    >
      <div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-background'>
        {item.kind === 'person' ? (
          item.avatarUrl ? (
            <Avatar className='h-10 w-10 rounded-xl'>
              <AvatarImage src={item.avatarUrl} alt={item.title} />
              <AvatarFallback className='rounded-xl bg-muted text-xs font-semibold'>{getSearchProfileInitials(item.title)}</AvatarFallback>
            </Avatar>
          ) : (
            <div className='flex h-10 w-10 items-center justify-center rounded-xl bg-muted/60 text-xs font-semibold text-foreground'>
              {getSearchProfileInitials(item.title)}
            </div>
          )
        ) : (
          <SearchResultIcon kind={item.kind} />
        )}
      </div>
      <div className='min-w-0 flex-1 space-y-0.5'>
        <div className='flex items-center gap-2'>
          <p className='truncate text-sm font-semibold text-foreground'>{item.title}</p>
          {item.meta ? <Badge variant='secondary' className='h-5 rounded-full px-2 text-[10px] uppercase tracking-[0.16em]'>{item.meta}</Badge> : null}
        </div>
        <p className='truncate text-xs text-muted-foreground'>{item.description}</p>
      </div>
      <ArrowUpRight className='h-4 w-4 shrink-0 text-muted-foreground' aria-hidden='true' />
    </button>
  )
}

function notificationTimeLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Just now'
  const diffMs = Date.now() - date.getTime()
  const diffMinutes = Math.floor(diffMs / (1000 * 60))
  if (diffMinutes < 1) return 'Just now'
  if (diffMinutes < 60) return `${diffMinutes}m`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d`
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date)
}

function HeaderNotificationTypeIcon({ type }: { type: HeaderNotificationType }) {
  if (type === 'mention') return <AtSign className='h-3.5 w-3.5 text-blue-400' aria-hidden='true' />
  if (type === 'system') return <ShieldAlert className='h-3.5 w-3.5 text-amber-400' aria-hidden='true' />
  return <Bell className='h-3.5 w-3.5 text-emerald-400' aria-hidden='true' />
}

function generateProjectKey(name: string) {
  const letters = name
    .trim()
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 4)
  const suffix = Math.floor(100 + Math.random() * 900)
  return `${letters || 'PRJ'}-${suffix}`
}

export function AppHeader({
  onDesktopToggle,
  onMobileToggle,
}: {
  onDesktopToggle: () => void
  onMobileToggle: () => void
}) {
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const { unreadCount } = useUnreadNotifications()

  const [createTaskOpen, setCreateTaskOpen] = useState(false)
  const [createProjectOpen, setCreateProjectOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)

  const [projectName, setProjectName] = useState('')
  const [projectColor, setProjectColor] = useState(DEFAULT_PROJECT_COLOR)
  const [projectOwner, setProjectOwner] = useState('')
  const [projectStartDate, setProjectStartDate] = useState<Date | undefined>()
  const [projectEndDate, setProjectEndDate] = useState<Date | undefined>()
  const [projectDescription, setProjectDescription] = useState('')
  const [projectOwners, setProjectOwners] = useState<ProjectOwnerOption[]>([])
  const [projectSubmitError, setProjectSubmitError] = useState<string | null>(null)
  const [projectSubmitting, setProjectSubmitting] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [notificationsLoading, setNotificationsLoading] = useState(false)
  const [notificationItems, setNotificationItems] = useState<HeaderNotificationItem[]>([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchLoading, setSearchLoading] = useState(true)
  const [searchData, setSearchData] = useState<HeaderSearchData>({
    projects: [],
    tasks: [],
    goals: [],
    people: [],
  })
  const [searchActiveIndex, setSearchActiveIndex] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchReloadTimerRef = useRef<number | null>(null)

  const fetchNotificationItems = useCallback(async () => {
    if (!currentUser?.id) return

    setNotificationsLoading(true)
    const { data, error } = await supabase
      .from('notifications')
      .select('id, title, message, task_id, type, read_at, created_at, metadata')
      .eq('recipient_id', currentUser.id)
      .order('created_at', { ascending: false })
      .limit(8)

    if (error) {
      console.error('Failed to load header notifications', error)
      setNotificationsLoading(false)
      return
    }

    setNotificationItems(
      Array.from(
        new Map(
          (data ?? []).map((row) => [
            row.id,
            {
              id: row.id,
              title: row.title,
              message: row.message,
              taskId: row.task_id ?? undefined,
              chatRoomId: typeof row.metadata?.chat_room_id === 'string' ? row.metadata.chat_room_id : undefined,
              createdAt: row.created_at,
              type: row.type === 'mention' || row.type === 'system' ? row.type : 'task',
              read: Boolean(row.read_at),
            },
          ]),
        ).values(),
      ),
    )
    setNotificationsLoading(false)
  }, [currentUser?.id])

  const loadSearchData = useCallback(
    async ({ background = false }: { background?: boolean } = {}) => {
      if (!currentUser?.id) {
        setSearchData({ projects: [], tasks: [], goals: [], people: [] })
        setSearchLoading(false)
        return
      }

      const cached = background ? null : readHeaderSearchCache(currentUser.id)
      if (cached) {
        setSearchData(cached.data)
        setSearchLoading(false)
      } else if (!background) {
        setSearchLoading(true)
      }

      const [projectsResult, tasksResult, taskAssigneesResult, profilesResult, goalsResult] = await Promise.all([
        supabase.from('projects').select('id, name, key, description, status, owner_id').order('name', { ascending: true }),
        supabase.from('tasks').select('id, title, status, due_at, project_id, assigned_to, created_at').order('created_at', { ascending: false }).limit(250),
        supabase.from('task_assignees').select('task_id, assignee_id'),
        supabase.from('profiles').select('id, full_name, username, email, avatar_url, role_label, job_title, department').order('full_name', { ascending: true }),
        supabase.from('goals').select('id, title, owner_id, cycle, status, health, department, due_at').order('created_at', { ascending: false }).limit(200),
      ])

      const projectRows = (projectsResult.data ?? []) as Array<{
        id: string
        name: string | null
        key: string | null
        description: string | null
        status: string | null
        owner_id: string | null
      }>
      const taskRows = (tasksResult.data ?? []) as Array<{
        id: string
        title: string | null
        status: string | null
        due_at: string | null
        project_id: string | null
        assigned_to: string | null
        created_at: string | null
      }>
      const taskAssigneeRows = (taskAssigneesResult.data ?? []) as Array<{ task_id: string; assignee_id: string }>
      const profileRows = (profilesResult.data ?? []) as HeaderSearchPersonRow[]
      const goalRows = (goalsResult.data ?? []) as Array<{
        id: string
        title: string | null
        owner_id: string | null
        cycle: string | null
        status: string | null
        health: string | null
        department: string | null
        due_at: string | null
      }>

      if (projectsResult.error) console.error('Failed to load header projects', projectsResult.error)
      if (tasksResult.error) console.error('Failed to load header tasks', tasksResult.error)
      if (taskAssigneesResult.error) console.error('Failed to load header task assignees', taskAssigneesResult.error)
      if (profilesResult.error) console.error('Failed to load header profiles', profilesResult.error)
      if (goalsResult.error) console.error('Failed to load header goals', goalsResult.error)

      const projectById = new Map(projectRows.map((project) => [project.id, project]))
      const profileById = new Map(profileRows.map((profile) => [profile.id, profile]))
      const assigneeNamesByTaskId = new Map<string, string[]>()

      for (const row of taskAssigneeRows) {
        const profile = profileById.get(row.assignee_id)
        const displayName = profile ? getSearchProfileName(profile) : 'Unknown teammate'
        const nextNames = assigneeNamesByTaskId.get(row.task_id) ?? []
        if (!nextNames.includes(displayName)) {
          nextNames.push(displayName)
          assigneeNamesByTaskId.set(row.task_id, nextNames)
        }
      }

      const searchDataPayload: HeaderSearchData = {
        projects: projectRows.map((project) => ({
          id: project.id,
          name: project.name ?? 'Untitled project',
          key: project.key ?? 'PRJ',
          description: project.description,
          status: project.status,
        })),
        tasks: taskRows.map((task) => {
          const project = task.project_id ? projectById.get(task.project_id) ?? null : null
          return {
            id: task.id,
            title: task.title ?? 'Untitled task',
            status: task.status,
            due_at: task.due_at,
            project_name: project?.name ?? null,
            project_key: project?.key ?? null,
            assignee_names: assigneeNamesByTaskId.get(task.id) ?? [],
          }
        }),
        goals: goalRows.map((goal) => {
          const owner = goal.owner_id ? profileById.get(goal.owner_id) ?? null : null
          return {
            id: goal.id,
            title: goal.title ?? 'Untitled goal',
            health: goal.health,
            cycle: goal.cycle,
            department: goal.department,
            owner_name: owner ? getSearchProfileName(owner) : null,
            due_at: goal.due_at,
          }
        }),
        people: profileRows.map((profile) => ({
          ...profile,
          full_name: getSearchProfileName(profile),
        })),
      }

      setSearchData(searchDataPayload)
      writeHeaderSearchCache(currentUser.id, searchDataPayload)
      setSearchLoading(false)
    },
    [currentUser?.id],
  )

  const resetProjectFlow = () => {
    setProjectName('')
    setProjectColor(DEFAULT_PROJECT_COLOR)
    setProjectOwner('')
    setProjectStartDate(undefined)
    setProjectEndDate(undefined)
    setProjectDescription('')
    setProjectSubmitError(null)
    setProjectSubmitting(false)
  }

  const openCreateProjectModal = useCallback(() => {
    resetProjectFlow()
    setProjectOwner(currentUser?.id ?? '')
    setCreateProjectOpen(true)
  }, [currentUser?.id])

  const handleProjectModalChange = (open: boolean) => {
    if (!open) {
      resetProjectFlow()
    }
    setCreateProjectOpen(open)
  }

  useEffect(() => {
    if (!createProjectOpen || projectOwners.length > 0) return

    let cancelled = false

    void supabase
      .from('profiles')
      .select('id, full_name, email')
      .order('full_name', { ascending: true })
      .then((result) => {
        if (cancelled || result.error) return
        const owners = (result.data ?? []).map((profile) => ({
          id: profile.id,
          name: profile.full_name ?? profile.email ?? 'Unknown user',
        }))
        setProjectOwners(owners)
        if (!projectOwner && currentUser?.id && owners.some((owner) => owner.id === currentUser.id)) {
          setProjectOwner(currentUser.id)
        }
      })

    return () => {
      cancelled = true
    }
  }, [createProjectOpen, currentUser?.id, projectOwner, projectOwners.length])

  useEffect(() => {
    if (!currentUser?.id) return
    const timer = window.setTimeout(() => {
      void fetchNotificationItems()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [currentUser?.id, fetchNotificationItems])

  useEffect(() => {
    if (!currentUser?.id) return

    const timer = window.setTimeout(() => {
      const cached = readHeaderSearchCache(currentUser.id)
      if (cached) {
        setSearchData(cached.data)
        setSearchLoading(false)
      }

      void loadSearchData()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [currentUser?.id, loadSearchData])

  useEffect(() => {
    if (!searchOpen) return
    const timer = window.setTimeout(() => {
      searchInputRef.current?.focus()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [searchOpen])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchActiveIndex(0)
    }, 0)

    return () => window.clearTimeout(timer)
  }, [searchQuery])

  useEffect(() => {
    const handleOpenCreateProject = () => openCreateProjectModal()
    window.addEventListener('contas:open-create-project', handleOpenCreateProject as EventListener)
    return () => window.removeEventListener('contas:open-create-project', handleOpenCreateProject as EventListener)
  }, [openCreateProjectModal])

  useEffect(() => {
    const onRealtimeChange = (event: Event) => {
      const detail = (event as CustomEvent<{ table?: string }>).detail
      if (detail?.table !== 'notifications') return
      void fetchNotificationItems()
    }
    window.addEventListener('contas:realtime-change', onRealtimeChange as EventListener)

    return () => {
      window.removeEventListener('contas:realtime-change', onRealtimeChange as EventListener)
    }
  }, [fetchNotificationItems])

  useEffect(() => {
    const relevantTables = new Set(['projects', 'tasks', 'task_assignees', 'profiles', 'goals'])

    const onRealtimeChange = (event: Event) => {
      const detail = (event as CustomEvent<{ table?: string }>).detail
      if (!detail?.table || !relevantTables.has(detail.table)) return

      if (searchReloadTimerRef.current !== null) {
        window.clearTimeout(searchReloadTimerRef.current)
      }

      searchReloadTimerRef.current = window.setTimeout(() => {
        searchReloadTimerRef.current = null
        void loadSearchData({ background: true })
      }, HEADER_SEARCH_RELOAD_DEBOUNCE_MS)
    }

    window.addEventListener('contas:realtime-change', onRealtimeChange as EventListener)
    return () => {
      window.removeEventListener('contas:realtime-change', onRealtimeChange as EventListener)
      if (searchReloadTimerRef.current !== null) {
        window.clearTimeout(searchReloadTimerRef.current)
        searchReloadTimerRef.current = null
      }
    }
  }, [loadSearchData])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setSearchQuery('')
    setSearchActiveIndex(0)
  }, [])

  const openSearch = useCallback((prefill = '') => {
    setSearchQuery(prefill)
    setSearchOpen(true)
  }, [])

  const quickActions = useMemo(
    () => [
      {
        id: 'action-create-task',
        title: 'Create task',
        description: 'Start a new task from the header.',
        meta: 'Quick action',
        avatarUrl: undefined,
        kind: 'action' as const,
        score: 0,
        onSelect: () => {
          closeSearch()
          setCreateTaskOpen(true)
        },
      },
      {
        id: 'action-create-project',
        title: 'Create project',
        description: 'Kick off a new project with the prefilled flow.',
        meta: 'Quick action',
        avatarUrl: undefined,
        kind: 'action' as const,
        score: 0,
        onSelect: () => {
          closeSearch()
          openCreateProjectModal()
        },
      },
      {
        id: 'action-invite',
        title: 'Invite teammate',
        description: 'Open the invite dialog.',
        meta: 'Quick action',
        avatarUrl: undefined,
        kind: 'action' as const,
        score: 0,
        onSelect: () => {
          closeSearch()
          setInviteOpen(true)
        },
      },
      {
        id: 'action-my-tasks',
        title: 'Open My Tasks',
        description: 'Jump straight to your task queue.',
        meta: 'Navigation',
        avatarUrl: undefined,
        kind: 'action' as const,
        score: 0,
        onSelect: () => {
          closeSearch()
          navigate('/dashboard/my-tasks')
        },
      },
      {
        id: 'action-workspace',
        title: 'Open workspace',
        description: 'View the team directory and activity.',
        meta: 'Navigation',
        avatarUrl: undefined,
        kind: 'action' as const,
        score: 0,
        onSelect: () => {
          closeSearch()
          navigate('/dashboard/workspace')
        },
      },
    ],
    [closeSearch, navigate, openCreateProjectModal],
  )

  const searchSections = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return []

    const taskItems: HeaderSearchItem[] = searchData.tasks
      .map((task): HeaderSearchItem | null => {
        const score = scoreSearchMatch(query, [task.title, task.project_name, task.project_key, task.status, ...task.assignee_names])
        if (score === 0) return null
        return {
          id: `task-${task.id}`,
          title: task.title,
          description: task.project_name ? `${task.project_name} • ${task.status ?? 'Task'}` : task.status ?? 'Task',
          meta: formatSearchRelativeDate(task.due_at) ?? task.project_key ?? undefined,
          avatarUrl: undefined,
          kind: 'task' as const,
          score,
          onSelect: () => {
            closeSearch()
            openTaskDetailsModal(task.id)
          },
        }
      })
      .filter(isHeaderSearchItem)
      .sort((left, right) => right.score - left.score)
      .slice(0, 6)

    const projectItems: HeaderSearchItem[] = searchData.projects
      .map((project): HeaderSearchItem | null => {
        const score = scoreSearchMatch(query, [project.name, project.key, project.description, project.status])
        if (score === 0) return null
        return {
          id: `project-${project.id}`,
          title: project.name,
          description: project.description ?? project.status ?? 'Project',
          meta: project.key,
          avatarUrl: undefined,
          kind: 'project' as const,
          score,
          onSelect: () => {
            closeSearch()
            navigate(`/dashboard/projects/${project.id}`)
          },
        }
      })
      .filter(isHeaderSearchItem)
      .sort((left, right) => right.score - left.score)
      .slice(0, 6)

    const goalItems: HeaderSearchItem[] = searchData.goals
      .map((goal): HeaderSearchItem | null => {
        const score = scoreSearchMatch(query, [goal.title, goal.owner_name, goal.cycle, goal.department, goal.health])
        if (score === 0) return null
        return {
          id: `goal-${goal.id}`,
          title: goal.title,
          description: [goal.owner_name ?? 'Unassigned', goal.department ?? 'No department'].filter(Boolean).join(' • '),
          meta: goal.cycle ?? formatSearchRelativeDate(goal.due_at) ?? undefined,
          avatarUrl: undefined,
          kind: 'goal' as const,
          score,
          onSelect: () => {
            closeSearch()
            navigate(`/dashboard/goals?goalId=${goal.id}`)
          },
        }
      })
      .filter(isHeaderSearchItem)
      .sort((left, right) => right.score - left.score)
      .slice(0, 6)

    const personItems: HeaderSearchItem[] = searchData.people
      .map((person): HeaderSearchItem | null => {
        const displayName = getSearchProfileName(person)
        const score = scoreSearchMatch(query, [displayName, person.username, person.email, person.job_title, person.role_label, person.department])
        if (score === 0) return null
        return {
          id: `person-${person.id}`,
          title: displayName,
          description: getSearchProfileRole(person),
          meta: person.username ? `@${person.username}` : person.department ?? undefined,
          kind: 'person' as const,
          avatarUrl: person.avatar_url,
          score,
          onSelect: () => {
            closeSearch()
            navigate(`/dashboard/workspace?memberId=${person.id}`)
          },
        }
      })
      .filter(isHeaderSearchItem)
      .sort((left, right) => right.score - left.score)
      .slice(0, 6)

    return [
      { key: 'tasks', title: 'Tasks', items: taskItems },
      { key: 'projects', title: 'Projects', items: projectItems },
      { key: 'goals', title: 'Goals', items: goalItems },
      { key: 'people', title: 'People', items: personItems },
    ].filter((section) => section.items.length > 0)
  }, [closeSearch, navigate, searchData.goals, searchData.people, searchData.projects, searchData.tasks, searchQuery])

  const searchItems = useMemo(() => searchSections.flatMap((section) => section.items), [searchSections])
  const searchHasQuery = searchQuery.trim().length > 0
  const handleSearchSelect = useCallback(
    (item: HeaderSearchItem) => {
      item.onSelect()
    },
    [],
  )

  const handleSearchKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeSearch()
        return
      }

      if (!searchHasQuery || searchItems.length === 0) return

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSearchActiveIndex((current) => (current + 1) % searchItems.length)
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSearchActiveIndex((current) => (current - 1 + searchItems.length) % searchItems.length)
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        handleSearchSelect(searchItems[searchActiveIndex] ?? searchItems[0])
      }
    },
    [closeSearch, handleSearchSelect, searchActiveIndex, searchHasQuery, searchItems],
  )

  const unreadPreviewCount = useMemo(() => notificationItems.filter((item) => !item.read).length, [notificationItems])

  const markNotificationRead = async (id: string, read: boolean) => {
    let changed = false
    setNotificationItems((current) => {
      const target = current.find((item) => item.id === id)
      if (!target || target.read === read) return current
      changed = true
      const next = current.map((item) => (item.id === id ? { ...item, read } : item))
      return next
    })
    if (changed) {
      adjustCachedUnreadCount(read ? -1 : 1)
    }
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: read ? new Date().toISOString() : null })
      .eq('id', id)

    if (error && changed) {
      console.error('Failed to update notification state', error)
      adjustCachedUnreadCount(read ? 1 : -1)
      setNotificationItems((current) => current.map((item) => (item.id === id ? { ...item, read: !read } : item)))
    }
  }

  const markAllNotificationsRead = async () => {
    const unreadIds = notificationItems.filter((item) => !item.read).map((item) => item.id)
    if (unreadIds.length === 0) return

    const nowIso = new Date().toISOString()
    setNotificationItems((current) => current.map((item) => ({ ...item, read: true })))
    adjustCachedUnreadCount(-unreadIds.length)
    const { error } = await supabase.from('notifications').update({ read_at: nowIso }).in('id', unreadIds)
    if (error) {
      console.error('Failed to mark all notifications read', error)
      adjustCachedUnreadCount(unreadIds.length)
      setNotificationItems((current) => current.map((item) => (unreadIds.includes(item.id) ? { ...item, read: false } : item)))
    }
  }

  const handleCreateProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedName = projectName.trim()
    const trimmedDescription = projectDescription.trim()

    if (!trimmedName) {
      setProjectSubmitError('Project name is required.')
      return
    }
    if (!projectOwner) {
      setProjectSubmitError('Project owner is required.')
      return
    }
    if (projectStartDate && projectEndDate && projectStartDate.getTime() > projectEndDate.getTime()) {
      setProjectSubmitError('Start date must be before or equal to target end date.')
      return
    }

    setProjectSubmitting(true)
    setProjectSubmitError(null)

    const key = generateProjectKey(trimmedName)

    const { data, error } = await supabase
      .from('projects')
      .insert({
        name: trimmedName,
        key,
        status: 'planned',
        color: normalizeProjectColor(projectColor),
        owner_id: projectOwner || null,
        created_by: currentUser?.id ?? null,
        start_date: projectStartDate ? projectStartDate.toISOString().slice(0, 10) : null,
        end_date: projectEndDate ? projectEndDate.toISOString().slice(0, 10) : null,
        description: trimmedDescription || null,
      })
      .select('id')
      .single()

    if (error || !data) {
      setProjectSubmitting(false)
      setProjectSubmitError(error?.message ?? 'Project could not be created. Fix the error and try again.')
      return
    }

    sessionStorage.setItem('contas.projects.last-created-id', data.id)
    window.dispatchEvent(new CustomEvent('contas:project-created', { detail: { projectId: data.id } }))
    handleProjectModalChange(false)
    navigate(`/dashboard/projects/${data.id}`)
  }

  return (
    <>
      <header className='sticky top-0 z-30 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80'>
        <div className='flex h-16 w-full items-center gap-3 px-4 md:px-6'>
          <div className='flex items-center gap-2'>
            <Button variant='ghost' size='icon' className='md:hidden' onClick={onMobileToggle} aria-label='Open sidebar'>
              <Menu className='h-5 w-5' aria-hidden='true' />
            </Button>
            <Button variant='ghost' size='icon' className='hidden md:inline-flex' onClick={onDesktopToggle} aria-label='Collapse sidebar'>
              <Menu className='h-5 w-5' aria-hidden='true' />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className='h-9 gap-2 px-3 text-sm font-medium'>
                  <CirclePlus className='h-4 w-4' aria-hidden='true' />
                  Create
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='start'>
                <DropdownMenuItem onSelect={() => setCreateTaskOpen(true)}>
                  <CirclePlus className='mr-2 h-4 w-4' aria-hidden='true' />
                  Create Task
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={openCreateProjectModal}>
                  <Layers className='mr-2 h-4 w-4' aria-hidden='true' />
                  Create Project
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate('/dashboard/workspace')}>
                  <MessageSquarePlus className='mr-2 h-4 w-4' aria-hidden='true' />
                  Create Message
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate('/dashboard/goals')}>
                  <Goal className='mr-2 h-4 w-4' aria-hidden='true' />
                  Create Goal
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setInviteOpen(true)}>
                  <UserPlus2 className='mr-2 h-4 w-4' aria-hidden='true' />
                  Invite
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className='mx-auto hidden w-full max-w-2xl items-center md:flex'>
            <button
              type='button'
              onClick={() => openSearch()}
              className='flex h-10 w-full items-center gap-3 rounded-full border border-border/70 bg-muted/30 px-4 text-left text-sm text-muted-foreground shadow-sm transition hover:border-primary/30 hover:bg-muted/50 hover:text-foreground'
              aria-label='Open search'
            >
              <Search className='h-4 w-4 shrink-0' aria-hidden='true' />
              <span className='flex-1 truncate'>Search tasks, projects, goals, and teammates</span>
              <span className='hidden rounded-full border border-border/70 bg-background px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground xl:inline-flex'>
                Ctrl K
              </span>
            </button>
          </div>

          <div className='ml-auto flex items-center gap-1'>
            <Button variant='ghost' size='icon' aria-label='Help center'>
              <HelpCircle className='h-5 w-5' aria-hidden='true' />
            </Button>
            <DropdownMenu open={notificationsOpen} onOpenChange={setNotificationsOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant='ghost'
                  size='icon'
                  aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : 'Notifications'}
                  className='relative'
                >
                  <Bell className='h-5 w-5' aria-hidden='true' />
                  {unreadCount > 0 ? (
                    <span className='absolute right-1 top-1 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-none text-white'>
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  ) : null}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end' className='w-[360px] p-0'>
                <div className='flex items-center justify-between border-b px-3 py-2'>
                  <DropdownMenuLabel className='p-0'>Notifications</DropdownMenuLabel>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='h-7 w-7'
                    aria-label='Mark all read'
                    title='Mark all read'
                    onClick={() => void markAllNotificationsRead()}
                    disabled={unreadPreviewCount === 0}
                  >
                    <CheckCheck className='h-3.5 w-3.5' aria-hidden='true' />
                  </Button>
                </div>
                <div className='max-h-[420px] space-y-1 overflow-y-auto p-1'>
                  {notificationsLoading ? (
                    <div className='px-2 py-6 text-center text-sm text-muted-foreground'>Loading notifications...</div>
                  ) : null}
                  {!notificationsLoading && notificationItems.length === 0 ? (
                    <div className='px-2 py-6 text-center text-sm text-muted-foreground'>No notifications yet.</div>
                  ) : null}
                  {!notificationsLoading
                    ? notificationItems.map((item) => (
                        <button
                          key={item.id}
                          type='button'
                          onClick={() => {
                            if (!item.read) {
                              void markNotificationRead(item.id, true)
                            }
                            setNotificationsOpen(false)
                            if (item.taskId) {
                              const params = new URLSearchParams({ openNotificationId: item.id, openTaskId: item.taskId })
                              navigate(`/dashboard/notifications?${params.toString()}`)
                              return
                            }
                            if (item.chatRoomId) {
                              navigate('/dashboard/home?openGroupChat=1')
                              return
                            }
                            navigate(`/dashboard/notifications?openNotificationId=${item.id}`)
                          }}
                          className={`w-full rounded-md border px-2.5 py-2 text-left transition-colors ${item.read ? 'bg-muted/10 hover:bg-muted/20' : 'border-primary/30 bg-primary/5 hover:bg-primary/10'}`}
                        >
                          <div className='flex items-start gap-2'>
                            <div className='mt-0.5 rounded-md border bg-background p-1'>
                              <HeaderNotificationTypeIcon type={item.type} />
                            </div>
                            <div className='min-w-0 flex-1 space-y-0.5'>
                              <div className='flex items-start justify-between gap-2'>
                                <p className='truncate text-sm font-semibold text-foreground'>{item.title}</p>
                                <span className='shrink-0 text-[11px] text-muted-foreground'>{notificationTimeLabel(item.createdAt)}</span>
                              </div>
                              <p className='line-clamp-2 text-xs text-muted-foreground'>{item.message}</p>
                            </div>
                          </div>
                        </button>
                      ))
                    : null}
                </div>
                <DropdownMenuSeparator className='my-0' />
                <div className='p-1'>
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault()
                      setNotificationsOpen(false)
                      navigate('/dashboard/notifications')
                    }}
                    className='justify-center text-sm font-medium'
                  >
                    View all notifications
                  </DropdownMenuItem>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
            <AccountMenu />
          </div>
        </div>
        <div className='border-t px-4 py-2 md:hidden'>
          <button
            type='button'
            onClick={() => openSearch()}
            className='flex h-10 w-full items-center gap-3 rounded-full border border-border/70 bg-muted/30 px-4 text-left text-sm text-muted-foreground shadow-sm transition hover:border-primary/30 hover:bg-muted/50 hover:text-foreground'
            aria-label='Open search'
          >
            <Search className='h-4 w-4 shrink-0' aria-hidden='true' />
            <span className='flex-1 truncate'>Search tasks, projects, goals, and teammates</span>
          </button>
        </div>
      </header>

      <Dialog
        open={searchOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeSearch()
          } else {
            setSearchOpen(true)
          }
        }}
      >
        <DialogContent
          showClose={false}
          className='max-w-4xl overflow-hidden border-border/70 bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.16),transparent_35%),linear-gradient(180deg,hsl(var(--card)),hsl(var(--background))_76%)] p-0 shadow-[0_40px_120px_rgba(15,23,42,0.28)]'
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            window.requestAnimationFrame(() => {
              searchInputRef.current?.focus()
            })
          }}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <DialogHeader className='border-b border-border/70 px-4 py-4 sm:px-6'>
            <div className='flex items-start justify-between gap-4'>
              <div className='space-y-1'>
                <DialogTitle>Search workspace</DialogTitle>
                <DialogDescription>Find tasks, projects, goals, and teammates without leaving the header.</DialogDescription>
              </div>
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className='h-9 w-9 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground'
                onClick={closeSearch}
                aria-label='Close search'
              >
                <X className='h-4 w-4' aria-hidden='true' />
              </Button>
            </div>
            <div className='relative mt-4'>
              <Search className='pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground' aria-hidden='true' />
              <Input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={handleSearchKeyDown}
                aria-label='Search workspace'
                placeholder='Search by task title, project code, goal, name, or email'
                className='h-12 rounded-full border-border/70 bg-background/95 pl-11 pr-32 text-sm shadow-sm'
              />
              <div className='pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-full border border-border/70 bg-muted/35 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground'>
                <span className='hidden sm:inline'>Esc closes</span>
                <span className='sm:hidden'>Esc</span>
              </div>
            </div>
          </DialogHeader>

          <div className='max-h-[70vh] overflow-y-auto px-3 py-3 sm:px-4'>
            {searchLoading && searchHasQuery ? (
              <div className='grid gap-3 py-4'>
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={`search-loading-${index}`} className='h-16 animate-pulse rounded-2xl border border-border/60 bg-muted/30' />
                ))}
              </div>
            ) : searchHasQuery ? (
              searchSections.length > 0 ? (
                <div className='space-y-5'>
                  {searchSections.map((section) => (
                    <section key={section.key} className='space-y-2'>
                      <div className='flex items-center justify-between px-2'>
                        <h3 className='text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground'>{section.title}</h3>
                        <span className='text-xs text-muted-foreground'>{section.items.length}</span>
                      </div>
                      <div className='space-y-1.5'>
                        {section.items.map((item) => {
                          const itemIndex = searchItems.findIndex((entry) => entry.id === item.id)
                          return (
                            <SearchResultRow
                              key={item.id}
                              item={item}
                              active={itemIndex === searchActiveIndex}
                              onSelect={() => handleSearchSelect(item)}
                              onHover={() => setSearchActiveIndex(itemIndex)}
                            />
                          )
                        })}
                      </div>
                    </section>
                  ))}
                  <div className='rounded-2xl border border-border/70 bg-muted/20 px-4 py-3 text-xs text-muted-foreground'>
                    Tip: use <span className='font-semibold text-foreground'>Arrow keys</span> to move and <span className='font-semibold text-foreground'>Enter</span> to open.
                  </div>
                </div>
              ) : (
                <div className='flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-border/70 bg-muted/20 px-6 py-14 text-center'>
                  <div className='flex h-12 w-12 items-center justify-center rounded-full border border-border/70 bg-background'>
                    <Search className='h-5 w-5 text-muted-foreground' aria-hidden='true' />
                  </div>
                  <div className='space-y-1'>
                    <p className='text-sm font-semibold text-foreground'>No matches found</p>
                    <p className='text-sm text-muted-foreground'>Try a project name, task title, teammate email, or goal keyword.</p>
                  </div>
                </div>
              )
            ) : (
              <div className='grid gap-4'>
                <section className='rounded-3xl border border-border/70 bg-background/85 p-4 shadow-sm'>
                  <div className='mb-3 flex items-center justify-between'>
                    <div>
                      <p className='text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground'>Quick actions</p>
                      <p className='text-sm text-muted-foreground'>Common jumps from the header.</p>
                    </div>
                    <Badge variant='secondary' className='rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.16em]'>
                      Ready
                    </Badge>
                  </div>
                  <div className='grid gap-2 sm:grid-cols-2'>
                    {quickActions.map((item) => (
                      <button
                        key={item.id}
                        type='button'
                        onClick={item.onSelect}
                        className='flex items-start gap-3 rounded-2xl border border-border/70 bg-muted/20 px-3 py-3 text-left transition hover:border-primary/30 hover:bg-primary/5'
                      >
                        <div className='mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl border border-border/70 bg-background'>
                          <ArrowUpRight className='h-4 w-4 text-muted-foreground' aria-hidden='true' />
                        </div>
                        <div className='min-w-0 flex-1'>
                          <div className='flex items-center gap-2'>
                            <p className='text-sm font-semibold text-foreground'>{item.title}</p>
                            <Badge variant='secondary' className='rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.16em]'>
                              {item.meta}
                            </Badge>
                          </div>
                          <p className='mt-0.5 text-xs text-muted-foreground'>{item.description}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </section>

                <section className='grid gap-3 rounded-3xl border border-border/70 bg-[linear-gradient(135deg,hsl(var(--background)),hsl(var(--muted)/0.18))] p-4 sm:grid-cols-2'>
                  <div className='space-y-1'>
                    <p className='text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground'>Search scope</p>
                    <p className='text-sm text-foreground'>Tasks, projects, goals, and teammates are indexed here.</p>
                  </div>
                  <div className='grid gap-2 text-xs text-muted-foreground'>
                    <p className='inline-flex items-center gap-2'>
                      <CheckSquare className='h-3.5 w-3.5 text-emerald-500' aria-hidden='true' />
                      Task results open the detail modal instantly.
                    </p>
                    <p className='inline-flex items-center gap-2'>
                      <FolderOpen className='h-3.5 w-3.5 text-sky-500' aria-hidden='true' />
                      Project results go straight to the project page.
                    </p>
                    <p className='inline-flex items-center gap-2'>
                      <Users2 className='h-3.5 w-3.5 text-amber-500' aria-hidden='true' />
                      Teammates open in the workspace member panel.
                    </p>
                  </div>
                </section>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <CreateTaskDialog
        open={createTaskOpen}
        onOpenChange={setCreateTaskOpen}
        onTaskCreated={() => navigate('/dashboard/my-tasks')}
      />

      <Dialog open={createProjectOpen} onOpenChange={handleProjectModalChange}>
        <DialogContent className='max-h-[88vh] max-w-3xl overflow-hidden p-0'>
          <div className='flex max-h-[88vh] flex-col'>
            <DialogHeader className='border-b px-6 py-4'>
              <DialogTitle>Create Project</DialogTitle>
              <DialogDescription>
                Add the core details and choose a project color.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleCreateProject} className='flex min-h-0 flex-1 flex-col'>
              <section className='min-h-0 flex-1 overflow-y-auto p-5 md:p-6'>
                <div className='mx-auto grid w-full max-w-3xl gap-4 md:grid-cols-2'>
                  <div className='space-y-2'>
                    <label className='text-sm font-medium text-foreground'>Project Name</label>
                    <Input
                      required
                      placeholder='Enter project name'
                      value={projectName}
                      onChange={(event) => setProjectName(event.target.value)}
                    />
                  </div>
                  <div className='space-y-2'>
                    <label className='text-sm font-medium text-foreground'>Owner</label>
                    <select
                      required
                      value={projectOwner}
                      onChange={(event) => setProjectOwner(event.target.value)}
                      className='flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
                    >
                      <option value='' disabled>
                        Select owner
                      </option>
                      {projectOwners.map((owner) => (
                        <option key={owner.id} value={owner.id}>
                          {owner.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className='space-y-2'>
                    <label className='text-sm font-medium text-foreground'>Start Date</label>
                    <DatePicker value={projectStartDate} onChange={setProjectStartDate} placeholder='Pick start date' withTime={false} />
                  </div>
                  <div className='space-y-2'>
                    <label className='text-sm font-medium text-foreground'>Target End Date</label>
                    <DatePicker value={projectEndDate} onChange={setProjectEndDate} placeholder='Pick end date' withTime={false} />
                  </div>
                  <div className='space-y-2 md:col-span-2'>
                    <label className='text-sm font-medium text-foreground'>Project Color</label>
                    <div className='flex flex-wrap items-center gap-3 rounded-md border border-input bg-background px-3 py-2'>
                      {PROJECT_COLOR_OPTIONS.map((color) => (
                        <button
                          key={color}
                          type='button'
                          onClick={() => setProjectColor(color)}
                          className={`h-6 w-6 rounded-full border-2 ${normalizeProjectColor(projectColor) === color ? 'border-foreground' : 'border-transparent'}`}
                          style={projectDotStyle(color)}
                          aria-label={`Select project color ${color}`}
                        />
                      ))}
                      <span className='ml-auto inline-flex items-center gap-2 text-xs text-muted-foreground'>
                        Custom
                        <input
                          type='color'
                          value={normalizeProjectColor(projectColor)}
                          onChange={(event) => setProjectColor(event.target.value)}
                          className='h-7 w-9 cursor-pointer rounded border border-input bg-background p-0.5'
                          aria-label='Pick custom project color'
                        />
                      </span>
                    </div>
                  </div>
                  <div className='space-y-2 md:col-span-2'>
                    <label className='text-sm font-medium text-foreground'>Project Description</label>
                    <textarea
                      rows={6}
                      value={projectDescription}
                      onChange={(event) => setProjectDescription(event.target.value)}
                      placeholder='Describe the project scope, goals, and outcomes.'
                      className='flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
                    />
                  </div>
                </div>
              </section>

              <DialogFooter className='border-t px-6 py-4'>
                {projectSubmitError ? <p className='mr-auto text-sm text-destructive'>{projectSubmitError}</p> : null}
                <Button
                  type='button'
                  variant='outline'
                  onClick={() => {
                    handleProjectModalChange(false)
                  }}
                >
                  Cancel
                </Button>
                <Button type='submit' disabled={projectSubmitting}>
                  {projectSubmitting ? 'Creating...' : 'Create Project'}
                </Button>
              </DialogFooter>
            </form>
          </div>
        </DialogContent>
      </Dialog>

      <InvitePeopleDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </>
  )
}
