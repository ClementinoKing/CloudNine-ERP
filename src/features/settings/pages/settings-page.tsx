import {
  Activity,
  Bell,
  BriefcaseBusiness,
  Building2,
  Camera,
  CircleUserRound,
  Flame,
  Mail,
  Medal,
  MonitorCog,
  SmartphoneNfc,
  Plug,
  Shield,
  Smartphone,
  Trash2,
  UserCircle2,
  UserRoundCog,
} from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent, type ComponentType } from 'react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/features/auth/context/auth-context'
import { useOrganization } from '@/features/organization/context/organization-context'
import { uploadAvatarToR2 } from '@/lib/r2'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

type SettingsTabKey = 'profile' | 'organization' | 'notifications' | 'account' | 'display' | 'apps' | 'admin'
type InvitationRole = 'owner' | 'admin' | 'member' | 'viewer'
type WeekdayKey = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'
type AvailabilityBlock = { id: string; day: WeekdayKey; startTime: string; endTime: string }

const INVITE_JOB_TITLES = [
  'Managing Director',
  'HR & Compliance Manager',
  'Accounting Manager',
  'Senior Accountant',
  'Junior Accountant',
  'Payroll and Regulatory Support Officer',
  'Junior Business Executive Officer',
] as const

const INVITE_DEPARTMENTS = [
  'Executive Leadership',
  'Accounting & Financial Services',
  'Payroll & Regulatory Services',
  'Human Resources & Compliance',
  'Business Development & Client Services',
] as const

const WEEKDAY_OPTIONS: Array<{ key: WeekdayKey; label: string }> = [
  { key: 'monday', label: 'Monday' },
  { key: 'tuesday', label: 'Tuesday' },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday', label: 'Thursday' },
  { key: 'friday', label: 'Friday' },
  { key: 'saturday', label: 'Saturday' },
  { key: 'sunday', label: 'Sunday' },
]

function createLocalId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `av-${Math.random().toString(36).slice(2, 10)}`
}

function createAvailabilityBlock(partial?: Partial<Omit<AvailabilityBlock, 'id'>>): AvailabilityBlock {
  return {
    id: createLocalId(),
    day: partial?.day ?? 'monday',
    startTime: partial?.startTime ?? '08:00',
    endTime: partial?.endTime ?? '17:00',
  }
}

function isValidTimeValue(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

function toMinutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

function getWeekdayIndex(day: WeekdayKey) {
  return WEEKDAY_OPTIONS.findIndex((option) => option.key === day)
}

function getDaysInRange(fromDay: WeekdayKey, toDay: WeekdayKey): WeekdayKey[] {
  const fromIndex = getWeekdayIndex(fromDay)
  const toIndex = getWeekdayIndex(toDay)
  if (fromIndex < 0 || toIndex < 0) return []
  if (fromIndex <= toIndex) {
    return WEEKDAY_OPTIONS.slice(fromIndex, toIndex + 1).map((option) => option.key)
  }
  return [...WEEKDAY_OPTIONS.slice(fromIndex), ...WEEKDAY_OPTIONS.slice(0, toIndex + 1)].map((option) => option.key)
}

function normalizeAvailabilitySchedule(raw: unknown): AvailabilityBlock[] {
  if (!Array.isArray(raw)) return []
  const weekdays = new Set(WEEKDAY_OPTIONS.map((option) => option.key))
  return raw
    .filter((item): item is { day?: unknown; startTime?: unknown; endTime?: unknown } => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      day: typeof item.day === 'string' ? item.day.toLowerCase() : '',
      startTime: typeof item.startTime === 'string' ? item.startTime : '',
      endTime: typeof item.endTime === 'string' ? item.endTime : '',
    }))
    .filter((item): item is { day: WeekdayKey; startTime: string; endTime: string } => {
      return weekdays.has(item.day as WeekdayKey) && isValidTimeValue(item.startTime) && isValidTimeValue(item.endTime)
    })
    .map((item) => createAvailabilityBlock(item))
}

type InvitationItem = {
  id: string
  email: string
  role: InvitationRole
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  createdAt: string
  expiresAt: string | null
}

type SettingsProfileCachePayload = {
  cachedAt: number
  fullName: string
  email: string
  avatarUrl?: string
  avatarPath?: string
  jobTitle: string
  department: string
  roleLabel: string
  aboutMe: string
  availabilitySchedule: AvailabilityBlock[]
}

type SettingsStatsCachePayload = {
  cachedAt: number
  assignedTasks: number
  completedTasks: number
  overdueTasks: number
  activeProjects: number
}

type SettingsProjectsCachePayload = {
  cachedAt: number
  projects: Array<{ id: string; name: string }>
}

type SettingsInvitesCachePayload = {
  cachedAt: number
  invitations: InvitationItem[]
}

const SETTINGS_PROFILE_CACHE_PREFIX = 'contas.settings.profile.v1'
const SETTINGS_STATS_CACHE_PREFIX = 'contas.settings.stats.v1'
const SETTINGS_PROJECTS_CACHE_KEY = 'contas.settings.projects.v1'
const SETTINGS_INVITES_CACHE_PREFIX = 'contas.settings.invites.v1'

const SETTINGS_PROFILE_CACHE_TTL_MS = 10 * 60 * 1000
const SETTINGS_STATS_CACHE_TTL_MS = 3 * 60 * 1000
const SETTINGS_PROJECTS_CACHE_TTL_MS = 10 * 60 * 1000
const SETTINGS_INVITES_CACHE_TTL_MS = 2 * 60 * 1000

function readTimedCache<T>(key: string, ttlMs: number): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { cachedAt?: number } & T
    if (!parsed || typeof parsed.cachedAt !== 'number') return null
    if (Date.now() - parsed.cachedAt > ttlMs) return null
    return parsed
  } catch {
    return null
  }
}

function writeTimedCache<T extends Record<string, unknown>>(key: string, payload: T) {
  localStorage.setItem(
    key,
    JSON.stringify({
      cachedAt: Date.now(),
      ...payload,
    }),
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type='button'
      role='switch'
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        checked ? 'border-primary bg-primary' : 'border-border bg-muted',
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 transform rounded-full bg-card transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}

function SectionHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: ComponentType<{ className?: string }>
  title: string
  description: string
}) {
  return (
    <div className='mb-4 flex items-start gap-3'>
      <div className='mt-0.5 rounded-md border bg-muted/40 p-2'>
        <Icon className='h-4 w-4 text-muted-foreground' aria-hidden='true' />
      </div>
      <div>
        <h3 className='text-base font-semibold text-foreground'>{title}</h3>
        <p className='text-sm text-muted-foreground'>{description}</p>
      </div>
    </div>
  )
}

function AdminInvitesSkeleton() {
  return (
    <div className='space-y-2'>
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={`admin-invite-skeleton-${index}`} className='rounded-md border p-3'>
          <div className='h-3.5 w-44 rounded bg-muted/60 animate-pulse' />
          <div className='mt-2 h-3 w-64 max-w-[80vw] rounded bg-muted/40 animate-pulse' />
        </div>
      ))}
    </div>
  )
}

function initials(name: string) {
  const parts = name.split(' ').filter(Boolean)
  if (parts.length === 0) return 'U'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
}

function isDirectAvatarUrl(value?: string | null) {
  if (!value) return false
  return value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:')
}

const SETTINGS_TABS: Array<{ key: SettingsTabKey; label: string }> = [
  { key: 'profile', label: 'Profile' },
  { key: 'organization', label: 'Organization' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'account', label: 'Account' },
  { key: 'display', label: 'Display' },
  { key: 'apps', label: 'Apps' },
  { key: 'admin', label: 'Admin Settings' },
]

function splitEmails(input: string) {
  return input
    .split(/[\n,;]+/g)
    .map((item) => item.trim())
    .filter(Boolean)
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

async function getAdminFunctionHeaders(preferredToken?: string | null) {
  if (preferredToken) {
    return { Authorization: `Bearer ${preferredToken}` }
  }

  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (session?.access_token) {
    return { Authorization: `Bearer ${session.access_token}` }
  }

  const { data: refreshed, error } = await supabase.auth.refreshSession()
  if (error || !refreshed.session?.access_token) {
    return null
  }

  return { Authorization: `Bearer ${refreshed.session.access_token}` }
}

export function SettingsPage() {
  const { currentUser, session, updateCurrentUser } = useAuth()
  const { currentOrganization } = useOrganization()

  const [activeTab, setActiveTab] = useState<SettingsTabKey>('profile')

  const [emailUpdates, setEmailUpdates] = useState(true)
  const [pushAlerts, setPushAlerts] = useState(false)
  const [weeklyDigest, setWeeklyDigest] = useState(true)
  const [twoFactor, setTwoFactor] = useState(false)
  const [availabilitySchedule, setAvailabilitySchedule] = useState<AvailabilityBlock[]>([])
  const [availabilityRangeFrom, setAvailabilityRangeFrom] = useState<WeekdayKey>('monday')
  const [availabilityRangeTo, setAvailabilityRangeTo] = useState<WeekdayKey>('friday')
  const [availabilityRangeStartTime, setAvailabilityRangeStartTime] = useState('08:00')
  const [availabilityRangeEndTime, setAvailabilityRangeEndTime] = useState('17:00')
  const [connectedCalendar, setConnectedCalendar] = useState(true)
  const [slackSync, setSlackSync] = useState(false)
  const [mobileAppSync, setMobileAppSync] = useState(true)
  const [gmailAddonSync, setGmailAddonSync] = useState(false)
  const [teamsSync, setTeamsSync] = useState(false)
  const [profileName, setProfileName] = useState(currentUser?.name ?? 'Organization User')
  const [profileEmail, setProfileEmail] = useState(currentUser?.email ?? 'user@example.com')
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | undefined>(currentUser?.avatarUrl)
  const [profileAvatarPath, setProfileAvatarPath] = useState<string | undefined>(currentUser?.avatarPath)
  const [profileJobTitle, setProfileJobTitle] = useState('')
  const [profileDepartment, setProfileDepartment] = useState('')
  const [profileRoleLabel, setProfileRoleLabel] = useState('')
  const [profileAboutMe, setProfileAboutMe] = useState('')
  const [profileStats, setProfileStats] = useState({ assignedTasks: 0, completedTasks: 0, overdueTasks: 0, activeProjects: 0 })
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileSaveMessage, setProfileSaveMessage] = useState<string | null>(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const [organizationProjects, setOrganizationProjects] = useState<Array<{ id: string; name: string }>>([])
  const [inviteEmailInput, setInviteEmailInput] = useState('')
  const [inviteFullName, setInviteFullName] = useState('')
  const [inviteJobTitle, setInviteJobTitle] = useState('')
  const [inviteDepartment, setInviteDepartment] = useState('')
  const [inviteRole, setInviteRole] = useState<InvitationRole>('member')
  const [selectedInviteProjectIds, setSelectedInviteProjectIds] = useState<string[]>([])
  const [invitingMembers, setInvitingMembers] = useState(false)
  const [inviteMessage, setInviteMessage] = useState<string | null>(null)
  const [adminInvitations, setAdminInvitations] = useState<InvitationItem[]>([])
  const [loadingAdminInvitations, setLoadingAdminInvitations] = useState(false)
  const isAdmin = (currentUser?.roleLabel ?? '').toLowerCase() === 'admin'
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const profileCacheKey = currentUser?.id ? `${SETTINGS_PROFILE_CACHE_PREFIX}:${currentUser.id}` : null
  const statsCacheKey = currentUser?.id ? `${SETTINGS_STATS_CACHE_PREFIX}:${currentUser.id}` : null
  const invitesCacheKey = currentUser?.id ? `${SETTINGS_INVITES_CACHE_PREFIX}:${currentUser.id}` : null

  useEffect(() => {
    setProfileName(currentUser?.name ?? 'Organization User')
    setProfileEmail(currentUser?.email ?? 'user@example.com')
    setProfileAvatarUrl(currentUser?.avatarUrl)
    setProfileAvatarPath(currentUser?.avatarPath)
  }, [currentUser?.avatarPath, currentUser?.avatarUrl, currentUser?.email, currentUser?.name])

  useEffect(() => {
    const cachedProjects = readTimedCache<SettingsProjectsCachePayload>(SETTINGS_PROJECTS_CACHE_KEY, SETTINGS_PROJECTS_CACHE_TTL_MS)
    if (cachedProjects?.projects) {
      setOrganizationProjects(cachedProjects.projects)
    }

    if (profileCacheKey) {
      const cachedProfile = readTimedCache<SettingsProfileCachePayload>(profileCacheKey, SETTINGS_PROFILE_CACHE_TTL_MS)
      if (cachedProfile) {
        setProfileName(cachedProfile.fullName)
        setProfileEmail(cachedProfile.email)
        setProfileAvatarUrl(cachedProfile.avatarUrl)
        setProfileAvatarPath(cachedProfile.avatarPath)
        setProfileJobTitle(cachedProfile.jobTitle)
        setProfileDepartment(cachedProfile.department)
        setProfileRoleLabel(cachedProfile.roleLabel)
        setProfileAboutMe(cachedProfile.aboutMe)
        setAvailabilitySchedule(cachedProfile.availabilitySchedule)
      }
    }

    if (statsCacheKey) {
      const cachedStats = readTimedCache<SettingsStatsCachePayload>(statsCacheKey, SETTINGS_STATS_CACHE_TTL_MS)
      if (cachedStats) {
        setProfileStats({
          assignedTasks: cachedStats.assignedTasks,
          completedTasks: cachedStats.completedTasks,
          overdueTasks: cachedStats.overdueTasks,
          activeProjects: cachedStats.activeProjects,
        })
      }
    }

    if (invitesCacheKey) {
      const cachedInvites = readTimedCache<SettingsInvitesCachePayload>(invitesCacheKey, SETTINGS_INVITES_CACHE_TTL_MS)
      if (cachedInvites?.invitations) {
        setAdminInvitations(cachedInvites.invitations)
      }
    }
  }, [invitesCacheKey, profileCacheKey, statsCacheKey])

  useEffect(() => {
    if (!currentUser?.id) return

    let cancelled = false

    void supabase
      .from('profiles')
      .select(
        'full_name, email, avatar_url, job_title, department, role_label, about_me, availability_schedule',
      )
      .eq('id', currentUser.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled || error || !data) return

        setProfileName(data.full_name ?? currentUser.name ?? 'Organization User')
        setProfileEmail(data.email ?? currentUser.email ?? 'user@example.com')
        setProfileAvatarUrl(isDirectAvatarUrl(data.avatar_url) ? (data.avatar_url ?? undefined) : currentUser.avatarUrl)
        setProfileAvatarPath(!isDirectAvatarUrl(data.avatar_url) ? (data.avatar_url ?? undefined) : currentUser.avatarPath)
        setProfileJobTitle(data.job_title ?? '')
        setProfileDepartment(data.department ?? '')
        setProfileRoleLabel(data.role_label ?? '')
        setProfileAboutMe(data.about_me ?? '')
        const normalizedAvailability = normalizeAvailabilitySchedule(data.availability_schedule)
        setAvailabilitySchedule(normalizedAvailability)
        if (profileCacheKey) {
          writeTimedCache(profileCacheKey, {
            fullName: data.full_name ?? currentUser.name ?? 'Organization User',
            email: data.email ?? currentUser.email ?? 'user@example.com',
            avatarUrl: isDirectAvatarUrl(data.avatar_url) ? (data.avatar_url ?? undefined) : currentUser.avatarUrl,
            avatarPath: !isDirectAvatarUrl(data.avatar_url) ? (data.avatar_url ?? undefined) : currentUser.avatarPath,
            jobTitle: data.job_title ?? '',
            department: data.department ?? '',
            roleLabel: data.role_label ?? '',
            aboutMe: data.about_me ?? '',
            availabilitySchedule: normalizedAvailability,
          } satisfies Omit<SettingsProfileCachePayload, 'cachedAt'>)
        }
      })

    return () => {
      cancelled = true
    }
  }, [currentUser?.avatarPath, currentUser?.avatarUrl, currentUser?.email, currentUser?.id, currentUser?.name, profileCacheKey])

  useEffect(() => {
    if (!currentUser?.id) return

    let cancelled = false
    void supabase
      .from('tasks')
      .select('id, status, completed_at, due_at, project_id')
      .eq('assigned_to', currentUser.id)
      .then(({ data, error }) => {
        if (cancelled || error) return
        const now = Date.now()
        const assigned = data ?? []
        const completed = assigned.filter((task) => Boolean(task.completed_at) || ['done', 'completed', 'closed'].includes((task.status ?? '').toLowerCase())).length
        const overdue = assigned.filter((task) => {
          if (task.completed_at || !task.due_at) return false
          const due = new Date(task.due_at)
          return !Number.isNaN(due.getTime()) && due.getTime() < now
        }).length
        const activeProjects = new Set(assigned.map((task) => task.project_id).filter((value): value is string => Boolean(value))).size
        setProfileStats({
          assignedTasks: assigned.length,
          completedTasks: completed,
          overdueTasks: overdue,
          activeProjects,
        })
        if (statsCacheKey) {
          writeTimedCache(statsCacheKey, {
            assignedTasks: assigned.length,
            completedTasks: completed,
            overdueTasks: overdue,
            activeProjects,
          } satisfies Omit<SettingsStatsCachePayload, 'cachedAt'>)
        }
      })

    return () => {
      cancelled = true
    }
  }, [currentUser?.id, statsCacheKey])

  useEffect(() => {
    let cancelled = false
    void supabase
      .from('projects')
      .select('id, name')
      .order('name', { ascending: true })
      .then(({ data }) => {
        if (cancelled) return
        const projects = (data ?? []).map((project) => ({ id: project.id, name: project.name ?? 'Untitled project' }))
        setOrganizationProjects(projects)
        writeTimedCache(SETTINGS_PROJECTS_CACHE_KEY, {
          projects,
        } satisfies Omit<SettingsProjectsCachePayload, 'cachedAt'>)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const loadAdminInvitations = async () => {
    if (!isAdmin) return
    if (!currentUser?.id) return
    setLoadingAdminInvitations(true)
    const authHeaders = await getAdminFunctionHeaders(session?.token)
    if (!authHeaders) {
      setInviteMessage('Your session expired. Sign in again and retry.')
      setLoadingAdminInvitations(false)
      return
    }
    const { data, error } = await supabase.functions.invoke('admin-invite', {
      body: { action: 'list' },
      headers: authHeaders,
    })
    if (error) {
      setInviteMessage(error.message)
      setLoadingAdminInvitations(false)
      return
    }
    const mappedInvitations = ((data?.invitations as Array<{
        id: string
        email: string
        role: InvitationRole
        status: 'pending' | 'accepted' | 'revoked' | 'expired'
        createdAt?: string
        expiresAt?: string | null
        created_at?: string
        expires_at?: string | null
      }> | undefined) ?? []
      ).map((item) => ({
        id: item.id,
        email: item.email,
        role: item.role,
        status: item.status,
        createdAt: item.createdAt ?? item.created_at ?? new Date().toISOString(),
        expiresAt: item.expiresAt ?? item.expires_at ?? null,
      }))
    setAdminInvitations(mappedInvitations)
    if (invitesCacheKey) {
      writeTimedCache(invitesCacheKey, {
        invitations: mappedInvitations,
      } satisfies Omit<SettingsInvitesCachePayload, 'cachedAt'>)
    }
    setLoadingAdminInvitations(false)
  }

  useEffect(() => {
    if (!isAdmin) return
    if (activeTab !== 'admin') return
    void loadAdminInvitations()
  }, [activeTab, currentUser?.id, isAdmin])

  useEffect(() => {
    if (!isAdmin && activeTab === 'admin') {
      setActiveTab('profile')
    }
  }, [activeTab, isAdmin])

  const toggleInviteProject = (projectId: string) => {
    setSelectedInviteProjectIds((current) =>
      current.includes(projectId) ? current.filter((id) => id !== projectId) : [...current, projectId],
    )
  }

  const handleInviteMembers = async () => {
    if (!isAdmin) return
    if (!currentUser?.id) return
    const emails = splitEmails(inviteEmailInput)
    if (emails.length === 0) {
      setInviteMessage('Enter at least one email address.')
      return
    }
    const invalidEmails = emails.filter((email) => !isValidEmail(email))
    if (invalidEmails.length > 0) {
      setInviteMessage(`Invalid emails: ${invalidEmails.join(', ')}`)
      return
    }
    if (!inviteFullName.trim()) {
      setInviteMessage('Full name is required.')
      return
    }
    if (!inviteJobTitle.trim()) {
      setInviteMessage('Job title is required.')
      return
    }
    if (!inviteDepartment.trim()) {
      setInviteMessage('Department is required.')
      return
    }

    const authHeaders = await getAdminFunctionHeaders(session?.token)
    if (!authHeaders) {
      setInviteMessage('Your session expired. Sign in again and retry.')
      return
    }

    setInvitingMembers(true)
    setInviteMessage(null)
    const results = await Promise.all(
      emails.map(async (email) => {
        const { data, error } = await supabase.functions.invoke('admin-invite', {
          body: {
            action: 'invite',
            email,
            role: inviteRole,
            fullName: inviteFullName.trim(),
            jobTitle: inviteJobTitle.trim(),
            department: inviteDepartment.trim(),
            projectIds: selectedInviteProjectIds,
          },
          headers: authHeaders,
        })
        return { data, error }
      }),
    )
    const failures = results.filter((result) => result.error || result.data?.ok === false)
    if (failures.length > 0) {
      setInviteMessage(`${emails.length - failures.length}/${emails.length} invites sent. Some failed.`)
    } else {
      setInviteMessage(`Invites sent to ${emails.length} teammate(s).`)
      setInviteEmailInput('')
      setInviteFullName('')
      setInviteJobTitle('')
      setInviteDepartment('')
      setSelectedInviteProjectIds([])
    }
    setInvitingMembers(false)
    void loadAdminInvitations()
  }

  const handleResendInvite = async (invitationId: string) => {
    if (!isAdmin) return
    if (!currentUser?.id) return
    const authHeaders = await getAdminFunctionHeaders(session?.token)
    if (!authHeaders) {
      setInviteMessage('Your session expired. Sign in again and retry.')
      return
    }
    const { data, error } = await supabase.functions.invoke('admin-invite', {
      body: { action: 'resend', invitationId },
      headers: authHeaders,
    })
    if (error || data?.ok === false) {
      setInviteMessage(error?.message ?? data?.message ?? 'Failed to resend invite.')
      return
    }
    setInviteMessage('Invite resent.')
    void loadAdminInvitations()
  }

  const handleRevokeInvite = async (invitationId: string) => {
    if (!isAdmin) return
    if (!currentUser?.id) return
    const authHeaders = await getAdminFunctionHeaders(session?.token)
    if (!authHeaders) {
      setInviteMessage('Your session expired. Sign in again and retry.')
      return
    }
    const { data, error } = await supabase.functions.invoke('admin-invite', {
      body: { action: 'revoke', invitationId },
      headers: authHeaders,
    })
    if (error || data?.ok === false) {
      setInviteMessage(error?.message ?? data?.message ?? 'Failed to revoke invite.')
      return
    }
    setInviteMessage('Invite revoked.')
    void loadAdminInvitations()
  }

  const handleAvatarFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) return

    setUploadingAvatar(true)
    setAvatarError(null)
    try {
      const upload = await uploadAvatarToR2(file)
      setProfileAvatarUrl(upload.url)
      setProfileAvatarPath(upload.key)
      updateCurrentUser({ avatarUrl: upload.url, avatarPath: upload.key })
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : 'Avatar upload failed.')
    } finally {
      setUploadingAvatar(false)
      event.target.value = ''
    }
  }

  const handleRemoveAvatar = () => {
    setProfileAvatarUrl(undefined)
    setProfileAvatarPath(undefined)
    setAvatarError(null)
    updateCurrentUser({ avatarUrl: undefined, avatarPath: undefined })
  }

  const handleSaveProfile = async () => {
    if (!currentUser?.id) return
    setSavingProfile(true)
    setProfileSaveMessage(null)

    const invalidBlock = availabilitySchedule.find(
      (block) => !isValidTimeValue(block.startTime) || !isValidTimeValue(block.endTime) || toMinutes(block.endTime) <= toMinutes(block.startTime),
    )
    if (invalidBlock) {
      const dayLabel = WEEKDAY_OPTIONS.find((option) => option.key === invalidBlock.day)?.label ?? 'Selected day'
      setProfileSaveMessage(`${dayLabel}: end time must be later than start time.`)
      setSavingProfile(false)
      return
    }

    const avatarValue = profileAvatarPath ?? profileAvatarUrl ?? null
    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: profileName.trim() || 'Organization User',
        avatar_url: avatarValue,
        job_title: profileJobTitle.trim() || null,
        department: profileDepartment.trim() || null,
        role_label: profileRoleLabel.trim() || null,
        about_me: profileAboutMe.trim() || null,
        availability_schedule: availabilitySchedule.map((block) => ({
          day: block.day,
          startTime: block.startTime,
          endTime: block.endTime,
        })),
        out_of_office: false,
        out_of_office_start: null,
        out_of_office_end: null,
      })
      .eq('id', currentUser.id)

    if (error) {
      setProfileSaveMessage(error.message)
      setSavingProfile(false)
      return
    }

    updateCurrentUser({
      name: profileName.trim() || 'Organization User',
      roleLabel: profileRoleLabel.trim() || undefined,
      jobTitle: profileJobTitle.trim() || undefined,
      avatarUrl: profileAvatarUrl,
      avatarPath: profileAvatarPath,
    })
    if (profileCacheKey) {
      writeTimedCache(profileCacheKey, {
        fullName: profileName.trim() || 'Organization User',
        email: profileEmail.trim() || currentUser.email || 'user@example.com',
        avatarUrl: profileAvatarUrl,
        avatarPath: profileAvatarPath,
        jobTitle: profileJobTitle.trim(),
        department: profileDepartment.trim(),
        roleLabel: profileRoleLabel.trim(),
        aboutMe: profileAboutMe.trim(),
        availabilitySchedule,
      } satisfies Omit<SettingsProfileCachePayload, 'cachedAt'>)
    }
    setProfileSaveMessage('Profile updated.')
    setSavingProfile(false)
  }

  const addAvailabilityBlock = () => {
    setAvailabilitySchedule((current) => [...current, createAvailabilityBlock()])
  }

  const updateAvailabilityBlock = (id: string, nextValues: Partial<Omit<AvailabilityBlock, 'id'>>) => {
    setAvailabilitySchedule((current) =>
      current.map((block) => (block.id === id ? { ...block, ...nextValues } : block)),
    )
  }

  const removeAvailabilityBlock = (id: string) => {
    setAvailabilitySchedule((current) => current.filter((block) => block.id !== id))
  }

  const addAvailabilityRange = () => {
    if (
      !isValidTimeValue(availabilityRangeStartTime) ||
      !isValidTimeValue(availabilityRangeEndTime) ||
      toMinutes(availabilityRangeEndTime) <= toMinutes(availabilityRangeStartTime)
    ) {
      setProfileSaveMessage('Range time is invalid. End time must be later than start time.')
      return
    }

    const days = getDaysInRange(availabilityRangeFrom, availabilityRangeTo)
    if (days.length === 0) {
      setProfileSaveMessage('Invalid day range selected.')
      return
    }

    let inserted = 0
    setAvailabilitySchedule((current) => {
      const next = [...current]
      for (const day of days) {
        const exists = next.some(
          (block) => block.day === day && block.startTime === availabilityRangeStartTime && block.endTime === availabilityRangeEndTime,
        )
        if (exists) continue
        next.push(createAvailabilityBlock({ day, startTime: availabilityRangeStartTime, endTime: availabilityRangeEndTime }))
        inserted += 1
      }
      return next
    })

    setProfileSaveMessage(
      inserted > 0
        ? `Added ${inserted} availability block${inserted > 1 ? 's' : ''} from ${availabilityRangeFrom} to ${availabilityRangeTo}.`
        : 'That day/time range already exists.',
    )
  }

  const renderAdminInviteForm = (containerClassName?: string) => (
    <div className={cn('space-y-4 rounded-lg border p-4', containerClassName)}>
      <div>
        <p className='font-medium text-foreground'>Invite Team Members</p>
        <p className='text-sm text-muted-foreground'>Create accounts by sending invite emails to teammates.</p>
      </div>
      <div className='grid gap-3 md:grid-cols-2'>
        <div className='space-y-2 md:col-span-2'>
          <label className='text-sm font-medium text-foreground'>Email addresses</label>
          <textarea
            value={inviteEmailInput}
            onChange={(event) => setInviteEmailInput(event.target.value)}
            rows={3}
            placeholder='name@company.com, teammate@company.com'
            className='flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
          />
        </div>
        <div className='space-y-2'>
          <label className='text-sm font-medium text-foreground'>Default role</label>
          <select
            value={inviteRole}
            onChange={(event) => setInviteRole(event.target.value as InvitationRole)}
            className='h-10 w-full rounded-md border border-input bg-background px-3 text-sm'
          >
            <option value='member'>Member</option>
            <option value='viewer'>Viewer</option>
            <option value='admin'>Admin</option>
            <option value='owner'>Owner</option>
          </select>
        </div>
        <div className='space-y-2'>
          <label className='text-sm font-medium text-foreground'>Full name</label>
          <Input
            value={inviteFullName}
            onChange={(event) => setInviteFullName(event.target.value)}
            placeholder='Enter teammate full name'
          />
          {!inviteFullName.trim() && inviteMessage === 'Full name is required.' ? (
            <p className='text-xs text-destructive'>Full name is required.</p>
          ) : null}
        </div>
        <div className='space-y-2'>
          <label className='text-sm font-medium text-foreground'>Job title</label>
          <select
            value={inviteJobTitle}
            onChange={(event) => setInviteJobTitle(event.target.value)}
            className='h-10 w-full rounded-md border border-input bg-background px-3 text-sm'
          >
            <option value=''>Select job title</option>
            {INVITE_JOB_TITLES.map((title) => (
              <option key={title} value={title}>
                {title}
              </option>
            ))}
          </select>
          {!inviteJobTitle.trim() && inviteMessage === 'Job title is required.' ? (
            <p className='text-xs text-destructive'>Job title is required.</p>
          ) : null}
        </div>
        <div className='space-y-2'>
          <label className='text-sm font-medium text-foreground'>Department</label>
          <select
            value={inviteDepartment}
            onChange={(event) => setInviteDepartment(event.target.value)}
            className='h-10 w-full rounded-md border border-input bg-background px-3 text-sm'
          >
            <option value=''>Select department</option>
            {INVITE_DEPARTMENTS.map((department) => (
              <option key={department} value={department}>
                {department}
              </option>
            ))}
          </select>
          {!inviteDepartment.trim() && inviteMessage === 'Department is required.' ? (
            <p className='text-xs text-destructive'>Department is required.</p>
          ) : null}
        </div>
      </div>
      <div className='space-y-2'>
        <label className='text-sm font-medium text-foreground'>Project access</label>
        <div className='flex flex-wrap gap-2 rounded-md border bg-background p-2'>
          {organizationProjects.map((project) => {
            const selected = selectedInviteProjectIds.includes(project.id)
            return (
              <button
                key={project.id}
                type='button'
                onClick={() => toggleInviteProject(project.id)}
                className={cn(
                  'rounded-md border px-2.5 py-1.5 text-xs',
                  selected ? 'border-primary/60 bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-accent',
                )}
              >
                {project.name}
              </button>
            )
          })}
          {organizationProjects.length === 0 ? <p className='text-xs text-muted-foreground'>No projects available.</p> : null}
        </div>
      </div>
      <div className='flex items-center justify-between gap-3'>
        {inviteMessage ? <p className='text-xs text-muted-foreground'>{inviteMessage}</p> : <span />}
        <Button onClick={() => void handleInviteMembers()} disabled={invitingMembers}>
          {invitingMembers ? 'Sending invites...' : 'Send invites'}
        </Button>
      </div>
    </div>
  )

  const renderActiveSection = () => {
    switch (activeTab) {
      case 'profile':
        return (
          <>
            <CardHeader>
              <SectionHeader icon={UserCircle2} title='Profile' description='Update identity and contact details.' />
            </CardHeader>
            <CardContent className='grid gap-4 md:grid-cols-2'>
              <div className='rounded-lg border bg-muted/10 p-4 md:col-span-2'>
                <div className='flex flex-wrap items-center justify-between gap-4'>
                  <div className='flex items-center gap-3'>
                    <Avatar className='h-16 w-16 border'>
                      {profileAvatarUrl ? <AvatarImage src={profileAvatarUrl} alt={profileName} className='object-cover' /> : null}
                      <AvatarFallback className='text-sm font-semibold'>{initials(profileName)}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className='font-medium text-foreground'>Profile photo</p>
                      <p className='text-sm text-muted-foreground'>JPG, PNG, or WEBP. Recommended square image.</p>
                    </div>
                  </div>
                  <div className='flex flex-wrap items-center gap-2'>
                    <input
                      ref={avatarInputRef}
                      type='file'
                      accept='image/*'
                      onChange={(event) => void handleAvatarFileChange(event)}
                      className='hidden'
                    />
                    <Button
                      type='button'
                      variant='outline'
                      onClick={() => avatarInputRef.current?.click()}
                      disabled={uploadingAvatar}
                    >
                      <Camera className='mr-2 h-4 w-4' aria-hidden='true' />
                      {uploadingAvatar ? 'Uploading...' : profileAvatarUrl ? 'Change photo' : 'Upload photo'}
                    </Button>
                    {profileAvatarUrl ? (
                      <Button type='button' variant='outline' onClick={handleRemoveAvatar}>
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </div>
                {avatarError ? <p className='mt-3 text-xs text-destructive'>{avatarError}</p> : null}
              </div>

              <div className='grid gap-4 md:col-span-2 lg:grid-cols-3'>
                <div className='rounded-lg border bg-muted/10 p-4 lg:col-span-1'>
                  <p className='mb-3 text-sm font-semibold text-foreground'>Overview</p>
                  <div className='space-y-3'>
                    <div className='flex items-center justify-between rounded-md border px-3 py-2'>
                      <span className='inline-flex items-center gap-2 text-sm text-muted-foreground'>
                        <Flame className='h-4 w-4 text-amber-500' />
                        Assigned Tasks
                      </span>
                      <span className='font-semibold text-foreground'>{profileStats.assignedTasks}</span>
                    </div>
                    <div className='flex items-center justify-between rounded-md border px-3 py-2'>
                      <span className='inline-flex items-center gap-2 text-sm text-muted-foreground'>
                        <Activity className='h-4 w-4 text-emerald-500' />
                        Completed
                      </span>
                      <span className='font-semibold text-foreground'>{profileStats.completedTasks}</span>
                    </div>
                    <div className='flex items-center justify-between rounded-md border px-3 py-2'>
                      <span className='inline-flex items-center gap-2 text-sm text-muted-foreground'>
                        <Medal className='h-4 w-4 text-emerald-500' />
                        Active Projects
                      </span>
                      <span className='font-semibold text-foreground'>{profileStats.activeProjects}</span>
                    </div>
                  </div>
                </div>

                <div className='rounded-lg border bg-muted/10 p-4 lg:col-span-2'>
                  <div className='mb-3 flex items-center justify-between'>
                    <p className='text-sm font-semibold text-foreground'>Task Completion</p>
                    <p className='text-xs text-muted-foreground'>Assigned work</p>
                  </div>
                  <div className='space-y-3'>
                    <div className='flex items-center justify-between text-xs text-muted-foreground'>
                      <span>Completed rate</span>
                      <span className='font-semibold text-foreground'>
                        {profileStats.assignedTasks > 0 ? Math.round((profileStats.completedTasks / profileStats.assignedTasks) * 100) : 0}%
                      </span>
                    </div>
                    <div className='h-2 rounded-full bg-muted'>
                      <div
                        className='h-full rounded-full bg-primary transition-[width] duration-300'
                        style={{
                          width: `${profileStats.assignedTasks > 0 ? Math.round((profileStats.completedTasks / profileStats.assignedTasks) * 100) : 0}%`,
                        }}
                      />
                    </div>
                    <div className='flex items-center justify-between text-xs text-muted-foreground'>
                      <span>Overdue tasks</span>
                      <span className='font-semibold text-foreground'>{profileStats.overdueTasks}</span>
                    </div>
                  </div>
                </div>

                <div className='rounded-lg border bg-muted/10 p-4 lg:col-span-3'>
                  <div className='mb-3 flex items-center justify-between'>
                    <p className='inline-flex items-center gap-2 text-sm font-semibold text-foreground'>
                      <Activity className='h-4 w-4 text-blue-500' />
                      Profile Snapshot
                    </p>
                    <p className='text-xs text-muted-foreground'>Live data from your assigned tasks</p>
                  </div>
                  <div className='grid gap-2 sm:grid-cols-2 xl:grid-cols-3'>
                    <div className='flex items-center justify-between rounded-md border px-3 py-2'>
                      <span className='text-sm text-muted-foreground'>Assigned</span>
                      <span className='text-sm font-semibold text-foreground'>{profileStats.assignedTasks}</span>
                    </div>
                    <div className='flex items-center justify-between rounded-md border px-3 py-2'>
                      <span className='text-sm text-muted-foreground'>Completed</span>
                      <span className='text-sm font-semibold text-foreground'>{profileStats.completedTasks}</span>
                    </div>
                    <div className='flex items-center justify-between rounded-md border px-3 py-2'>
                      <span className='text-sm text-muted-foreground'>Overdue</span>
                      <span className='text-sm font-semibold text-foreground'>{profileStats.overdueTasks}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className='space-y-2'>
                <label className='text-sm font-medium text-foreground'>Full Name</label>
                <Input value={profileName} onChange={(event) => setProfileName(event.target.value)} />
              </div>
              <div className='space-y-2'>
                <label className='text-sm font-medium text-foreground'>Email</label>
                <Input type='email' value={profileEmail} readOnly disabled className='cursor-not-allowed opacity-70' />
              </div>
              <div className='space-y-2'>
                <label className='text-sm font-medium text-foreground'>Job Title</label>
                <select
                  value={profileJobTitle}
                  onChange={(event) => setProfileJobTitle(event.target.value)}
                  className='h-10 w-full rounded-md border border-input bg-background px-3 text-sm'
                >
                  <option value=''>Select job title</option>
                  {INVITE_JOB_TITLES.map((title) => (
                    <option key={title} value={title}>
                      {title}
                    </option>
                  ))}
                </select>
              </div>
              <div className='space-y-2'>
                <label className='text-sm font-medium text-foreground'>Department</label>
                <select
                  value={profileDepartment}
                  onChange={(event) => setProfileDepartment(event.target.value)}
                  className='h-10 w-full rounded-md border border-input bg-background px-3 text-sm'
                >
                  <option value=''>Select department</option>
                  {INVITE_DEPARTMENTS.map((department) => (
                    <option key={department} value={department}>
                      {department}
                    </option>
                  ))}
                </select>
              </div>
              <div className='space-y-2'>
                <label className='text-sm font-medium text-foreground'>Role</label>
                <Input value={profileRoleLabel} onChange={(event) => setProfileRoleLabel(event.target.value)} />
              </div>
              <div className='space-y-2 md:col-span-2'>
                <label className='text-sm font-medium text-foreground'>About Me</label>
                <textarea
                  value={profileAboutMe}
                  onChange={(event) => setProfileAboutMe(event.target.value)}
                  rows={4}
                  className='flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
                />
              </div>
              <div className='space-y-3 rounded-lg border p-3 md:col-span-2'>
                <div className='flex flex-wrap items-center justify-between gap-3'>
                  <div>
                    <p className='font-medium text-foreground'>Availability schedule</p>
                    <p className='text-sm text-muted-foreground'>
                      Define weekly office availability. Outside these hours, you are treated as unavailable.
                    </p>
                  </div>
                  <Button type='button' variant='outline' size='sm' onClick={addAvailabilityBlock}>
                    Add availability block
                  </Button>
                </div>
                <div className='grid gap-2 rounded-md border bg-muted/10 p-2 md:grid-cols-[1fr_1fr_1fr_1fr_auto]'>
                  <select
                    value={availabilityRangeFrom}
                    onChange={(event) => setAvailabilityRangeFrom(event.target.value as WeekdayKey)}
                    className='h-9 w-full rounded-md border border-input bg-background px-3 text-sm'
                  >
                    {WEEKDAY_OPTIONS.map((option) => (
                      <option key={option.key} value={option.key}>
                        From {option.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={availabilityRangeTo}
                    onChange={(event) => setAvailabilityRangeTo(event.target.value as WeekdayKey)}
                    className='h-9 w-full rounded-md border border-input bg-background px-3 text-sm'
                  >
                    {WEEKDAY_OPTIONS.map((option) => (
                      <option key={option.key} value={option.key}>
                        To {option.label}
                      </option>
                    ))}
                  </select>
                  <Input type='time' value={availabilityRangeStartTime} onChange={(event) => setAvailabilityRangeStartTime(event.target.value)} />
                  <Input type='time' value={availabilityRangeEndTime} onChange={(event) => setAvailabilityRangeEndTime(event.target.value)} />
                  <Button type='button' variant='outline' size='sm' onClick={addAvailabilityRange}>
                    Apply range
                  </Button>
                </div>
                {availabilitySchedule.length === 0 ? (
                  <div className='rounded-md border border-dashed p-3 text-xs text-muted-foreground'>
                    No availability set yet. You will appear unavailable until at least one block is added.
                  </div>
                ) : (
                  <div className='space-y-2'>
                    {availabilitySchedule.map((block) => (
                      <div key={block.id} className='grid gap-2 rounded-md border p-2 md:grid-cols-[1.2fr_1fr_1fr_auto]'>
                        <select
                          value={block.day}
                          onChange={(event) => updateAvailabilityBlock(block.id, { day: event.target.value as WeekdayKey })}
                          className='h-9 w-full rounded-md border border-input bg-background px-3 text-sm'
                        >
                          {WEEKDAY_OPTIONS.map((option) => (
                            <option key={option.key} value={option.key}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <Input
                          type='time'
                          value={block.startTime}
                          onChange={(event) => updateAvailabilityBlock(block.id, { startTime: event.target.value })}
                        />
                        <Input
                          type='time'
                          value={block.endTime}
                          onChange={(event) => updateAvailabilityBlock(block.id, { endTime: event.target.value })}
                        />
                        <Button type='button' variant='outline' size='sm' onClick={() => removeAvailabilityBlock(block.id)}>
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                <p className='text-xs text-muted-foreground'>End time must be later than start time. Schedule repeats every week.</p>
              </div>
              <div className='flex justify-end md:col-span-2'>
                <div className='flex items-center gap-3'>
                  {profileSaveMessage ? <p className='text-xs text-muted-foreground'>{profileSaveMessage}</p> : null}
                  <Button onClick={() => void handleSaveProfile()} disabled={savingProfile}>
                    {savingProfile ? 'Saving...' : 'Save profile'}
                  </Button>
                </div>
              </div>
            </CardContent>
          </>
        )

      case 'organization':
        return (
          <>
            <CardHeader>
              <SectionHeader icon={Building2} title='Organization' description='Manage your organization profile and operating details.' />
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='grid gap-4 md:grid-cols-2'>
                <div className='space-y-2'>
                  <label className='text-sm font-medium text-foreground'>Organization Name</label>
                  <Input defaultValue={currentOrganization.name} />
                </div>
                <div className='space-y-2'>
                  <label className='text-sm font-medium text-foreground'>Plan</label>
                  <Input defaultValue={currentOrganization.plan} readOnly />
                </div>
                <div className='space-y-2'>
                  <label className='text-sm font-medium text-foreground'>Legal Name</label>
                  <Input defaultValue={currentOrganization.legalName} />
                </div>
                <div className='space-y-2'>
                  <label className='text-sm font-medium text-foreground'>Website</label>
                  <Input defaultValue={currentOrganization.website} />
                </div>
                <div className='space-y-2'>
                  <label className='text-sm font-medium text-foreground'>Industry</label>
                  <Input defaultValue={currentOrganization.industry} />
                </div>
                <div className='space-y-2'>
                  <label className='text-sm font-medium text-foreground'>Company Size</label>
                  <Input defaultValue={currentOrganization.size} />
                </div>
                <div className='space-y-2'>
                  <label className='text-sm font-medium text-foreground'>Timezone</label>
                  <Input defaultValue={currentOrganization.timezone} />
                </div>
                <div className='space-y-2'>
                  <label className='text-sm font-medium text-foreground'>Location</label>
                  <Input defaultValue={currentOrganization.location} />
                </div>
                <div className='space-y-2 md:col-span-2'>
                  <label className='text-sm font-medium text-foreground'>Organization Details</label>
                  <textarea
                    defaultValue={currentOrganization.description}
                    rows={4}
                    className='flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
                  />
                </div>
              </div>
              <div className='flex justify-end'>
                <Button variant='outline'>Update organization</Button>
              </div>
              {isAdmin ? renderAdminInviteForm() : null}
            </CardContent>
          </>
        )

      case 'notifications':
        return (
          <>
            <CardHeader>
              <SectionHeader icon={Bell} title='Notifications' description='Control when and how we notify you.' />
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='flex items-center justify-between rounded-lg border p-3'>
                <div>
                  <p className='font-medium text-foreground'>Email task updates</p>
                  <p className='text-sm text-muted-foreground'>Receive task assignment and due date updates by email.</p>
                </div>
                <Toggle checked={emailUpdates} onChange={setEmailUpdates} label='Toggle email task updates' />
              </div>
              <div className='flex items-center justify-between rounded-lg border p-3'>
                <div>
                  <p className='font-medium text-foreground'>Push alerts</p>
                  <p className='text-sm text-muted-foreground'>Show real-time desktop notifications for comments and mentions.</p>
                </div>
                <Toggle checked={pushAlerts} onChange={setPushAlerts} label='Toggle push alerts' />
              </div>
              <div className='flex items-center justify-between rounded-lg border p-3'>
                <div>
                  <p className='font-medium text-foreground'>Weekly digest</p>
                  <p className='text-sm text-muted-foreground'>Get a weekly summary every Monday morning.</p>
                </div>
                <Toggle checked={weeklyDigest} onChange={setWeeklyDigest} label='Toggle weekly digest' />
              </div>
            </CardContent>
          </>
        )

      case 'account':
        return (
          <>
            <CardHeader>
              <SectionHeader icon={Shield} title='Account' description='Security and account access controls.' />
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='rounded-lg border p-3'>
                <div className='mb-3 flex items-center gap-2'>
                  <Mail className='h-4 w-4 text-muted-foreground' aria-hidden='true' />
                  <p className='font-medium text-foreground'>Email Addresses</p>
                </div>
                <div className='grid gap-3 md:grid-cols-3'>
                  <div className='space-y-2'>
                    <label className='text-sm font-medium text-foreground'>Work Email</label>
                    <Input type='email' defaultValue={currentUser?.email ?? 'work@example.com'} readOnly disabled className='cursor-not-allowed opacity-70' />
                  </div>
                  <div className='space-y-2'>
                    <label className='text-sm font-medium text-foreground'>Personal Email</label>
                    <Input type='email' defaultValue='personal@example.com' readOnly disabled className='cursor-not-allowed opacity-70' />
                  </div>
                  <div className='space-y-2'>
                    <label className='text-sm font-medium text-foreground'>Other Email</label>
                    <Input type='email' defaultValue='other@example.com' readOnly disabled className='cursor-not-allowed opacity-70' />
                  </div>
                </div>
              </div>
              <div className='flex items-center justify-between rounded-lg border p-3'>
                <div>
                  <p className='font-medium text-foreground'>Two-factor authentication</p>
                  <p className='text-sm text-muted-foreground'>Require a verification code during sign in.</p>
                </div>
                <Toggle checked={twoFactor} onChange={setTwoFactor} label='Toggle two-factor authentication' />
              </div>
              <div className='flex items-center justify-end gap-2'>
                <Button variant='outline'>Change password</Button>
                <Button variant='outline'>Manage sessions</Button>
                <Button variant='outline'>
                  <BriefcaseBusiness className='mr-2 h-4 w-4' aria-hidden='true' />
                  Manage work profile
                </Button>
              </div>
              <div className='rounded-lg border border-destructive/40 bg-destructive/5 p-3'>
                <div className='mb-3'>
                  <p className='font-medium text-foreground'>Danger Zone</p>
                  <p className='text-sm text-muted-foreground'>These actions affect account access and cannot be easily reversed.</p>
                </div>
                <div className='flex flex-wrap gap-2'>
                  <Button variant='outline'>
                    <UserRoundCog className='mr-2 h-4 w-4' aria-hidden='true' />
                    Deactivate account
                  </Button>
                  <Button variant='destructive'>
                    <Trash2 className='mr-2 h-4 w-4' aria-hidden='true' />
                    Delete account
                  </Button>
                </div>
              </div>
            </CardContent>
          </>
        )

      case 'display':
        return (
          <>
            <CardHeader>
              <SectionHeader icon={MonitorCog} title='Display' description='Personalize the interface and visual experience.' />
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='grid gap-4 md:grid-cols-2'>
                <div className='space-y-2'>
                  <label className='text-sm font-medium text-foreground'>Language</label>
                  <select className='flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'>
                    <option>English (US)</option>
                    <option>English (UK)</option>
                    <option>French</option>
                    <option>Portuguese</option>
                  </select>
                </div>
                <div className='space-y-2'>
                  <label className='text-sm font-medium text-foreground'>First Day of the Week</label>
                  <select className='flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'>
                    <option>Monday</option>
                    <option>Sunday</option>
                    <option>Saturday</option>
                  </select>
                </div>
              </div>
              <div className='grid gap-3 md:grid-cols-3'>
                {['System', 'Light', 'Dark'].map((mode) => (
                  <button
                    key={mode}
                    type='button'
                    className='rounded-lg border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                  >
                    {mode}
                  </button>
                ))}
              </div>
              <p className='text-sm text-muted-foreground'>Use the sidebar theme control for instant light/dark switching.</p>
              <div className='flex justify-end'>
                <Button variant='outline'>Save display preferences</Button>
              </div>
            </CardContent>
          </>
        )

      case 'apps':
        return (
          <>
            <CardHeader>
              <SectionHeader icon={Plug} title='Apps' description='Connect external apps and sync workflows.' />
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='rounded-lg border p-4'>
                <div className='flex flex-col gap-4 md:flex-row md:items-center md:justify-between'>
                  <div>
                    <p className='font-medium text-foreground'>Download Spryar Tech Mobile App</p>
                    <p className='text-sm text-muted-foreground'>
                      Scan the QR code to open the mobile app download page.
                    </p>
                    <div className='mt-3 flex flex-wrap gap-2'>
                      <Badge variant='outline'>iOS</Badge>
                      <Badge variant='outline'>Android</Badge>
                    </div>
                  </div>
                  <div className='rounded-md border bg-card p-2'>
                    <img
                      src='https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=https%3A%2F%2Fcontas.app%2Fdownload'
                      alt='QR code to download the Spryar Tech mobile app'
                      width={160}
                      height={160}
                      className='h-24 w-24 md:h-28 md:w-28'
                    />
                  </div>
                </div>
              </div>
              <div className='flex items-center justify-between rounded-lg border p-3'>
                <div className='flex items-center gap-3'>
                  <SmartphoneNfc className='h-4 w-4 text-muted-foreground' aria-hidden='true' />
                  <div>
                    <p className='font-medium text-foreground'>Spryar Tech Mobile App</p>
                    <p className='text-sm text-muted-foreground'>Sync push alerts and mobile activity updates.</p>
                  </div>
                </div>
                <Toggle checked={mobileAppSync} onChange={setMobileAppSync} label='Toggle mobile app integration' />
              </div>
              <div className='flex items-center justify-between rounded-lg border p-3'>
                <div className='flex items-center gap-3'>
                  <Mail className='h-4 w-4 text-muted-foreground' aria-hidden='true' />
                  <div>
                    <p className='font-medium text-foreground'>Gmail Add-on</p>
                    <p className='text-sm text-muted-foreground'>Turn emails into tasks directly from Gmail.</p>
                  </div>
                </div>
                <Toggle checked={gmailAddonSync} onChange={setGmailAddonSync} label='Toggle Gmail add-on integration' />
              </div>
              <div className='flex items-center justify-between rounded-lg border p-3'>
                <div className='flex items-center gap-3'>
                  <CircleUserRound className='h-4 w-4 text-muted-foreground' aria-hidden='true' />
                  <div>
                    <p className='font-medium text-foreground'>Microsoft Teams</p>
                    <p className='text-sm text-muted-foreground'>Share task updates and reminders in team channels.</p>
                  </div>
                </div>
                <Toggle checked={teamsSync} onChange={setTeamsSync} label='Toggle Microsoft Teams integration' />
              </div>
              <div className='flex items-center justify-between rounded-lg border p-3'>
                <div className='flex items-center gap-3'>
                  <Smartphone className='h-4 w-4 text-muted-foreground' aria-hidden='true' />
                  <div>
                    <p className='font-medium text-foreground'>Google Calendar</p>
                    <p className='text-sm text-muted-foreground'>Sync task deadlines with your calendar.</p>
                  </div>
                </div>
                <Toggle checked={connectedCalendar} onChange={setConnectedCalendar} label='Toggle calendar integration' />
              </div>
              <div className='flex items-center justify-between rounded-lg border p-3'>
                <div className='flex items-center gap-3'>
                  <CircleUserRound className='h-4 w-4 text-muted-foreground' aria-hidden='true' />
                  <div>
                    <p className='font-medium text-foreground'>Slack</p>
                    <p className='text-sm text-muted-foreground'>Send project updates to your team channels.</p>
                  </div>
                </div>
                <Toggle checked={slackSync} onChange={setSlackSync} label='Toggle slack integration' />
              </div>
            </CardContent>
          </>
        )

      case 'admin':
        return (
          <>
            <CardHeader>
              <SectionHeader icon={Shield} title='Admin Settings' description='Manage invitations and account provisioning.' />
            </CardHeader>
            <CardContent className='space-y-4'>
              {!isAdmin ? (
                <div className='rounded-lg border border-dashed p-4 text-sm text-muted-foreground'>Admin access required.</div>
              ) : (
                <>
                  {renderAdminInviteForm('border-border/80')}
                  <div className='flex items-center justify-between'>
                    <p className='text-sm font-medium text-foreground'>Invitation History</p>
                    <Button variant='outline' size='sm' onClick={() => void loadAdminInvitations()}>
                      Refresh
                    </Button>
                  </div>
                  <div className='space-y-2'>
                    {loadingAdminInvitations ? (
                      <AdminInvitesSkeleton />
                    ) : adminInvitations.length === 0 ? (
                      <p className='text-sm text-muted-foreground'>No invitations yet.</p>
                    ) : (
                      adminInvitations.map((invite) => (
                        <div key={invite.id} className='flex flex-wrap items-center justify-between gap-3 rounded-md border p-3'>
                          <div>
                            <p className='text-sm font-medium text-foreground'>{invite.email}</p>
                            <p className='text-xs text-muted-foreground'>
                              {invite.role} • {invite.status} • {new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(invite.createdAt))}
                            </p>
                          </div>
                          <div className='flex items-center gap-2'>
                            <Button
                              size='sm'
                              variant='outline'
                              onClick={() => void handleResendInvite(invite.id)}
                              disabled={invite.status !== 'pending'}
                            >
                              Resend
                            </Button>
                            <Button
                              size='sm'
                              variant='outline'
                              onClick={() => void handleRevokeInvite(invite.id)}
                              disabled={invite.status !== 'pending'}
                            >
                              Revoke
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </>
        )

      default:
        return null
    }
  }

  return (
    <div className='space-y-6'>
      <Card>
        <CardContent className='p-3'>
          <div className='overflow-x-auto'>
            <div className='inline-flex min-w-full gap-1 rounded-lg bg-muted/35 p-1'>
              {SETTINGS_TABS.map((tab) => (
                (tab.key !== 'admin' || isAdmin) ? (
                <button
                  key={tab.key}
                  type='button'
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    'rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    activeTab === tab.key
                      ? 'bg-card text-foreground border shadow-[inset_0_0_0_1px_hsl(var(--border))]'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  {tab.label}
                </button>
                ) : null
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>{renderActiveSection()}</Card>
    </div>
  )
}
