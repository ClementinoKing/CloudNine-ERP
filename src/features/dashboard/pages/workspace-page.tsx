import {
  Bell,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CirclePlus,
  FileText,
  KeyRound,
  Mail,
  MapPin,
  Pencil,
  ReceiptText,
  Shield,
  Sparkles,
  Trash2,
  UserCog,
  UserPlus,
  UserX,
  Users2,
  Workflow,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useAuth } from '@/features/auth/context/auth-context'
import { notify } from '@/lib/notify'
import { supabase } from '@/lib/supabase'
import { useSearchParams } from 'react-router-dom'
import { useOrganization } from '@/features/organization/context/organization-context'

const WORKSPACE_MEMBERS_CACHE_KEY = 'cloudnine.workspace.members.v1'
const WORKSPACE_PRESENCE_CACHE_KEY = 'cloudnine.workspace.presence.v1'
const WORKSPACE_TIMELINE_CACHE_KEY = 'cloudnine.workspace.timeline.v1'
const ONLINE_WINDOW_MS = 5 * 60 * 1000

type TeamMember = {
  id: string
  full_name: string | null
  email: string | null
  avatar_url: string | null
  job_title: string | null
  department: string | null
  role_label: string | null
  account_status: 'active' | 'deactivated' | 'deleted'
  deactivated_at: string | null
  deleted_at: string | null
  availability_schedule: unknown
}

type PresenceSession = {
  user_id: string
  is_online: boolean
  last_seen_at: string | null
}

type WeekdayKey = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'
type AvailabilityBlock = { day: WeekdayKey; startTime: string; endTime: string }
const WEEKDAY_BY_INDEX: WeekdayKey[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

type OrganizationTimelineEvent = {
  id: string
  title: string
  event_type: string
  starts_at: string
}

type DepartmentRow = {
  id: string
  organization_id: string
  name: string
  description: string | null
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
  archived_at: string | null
}

type JobRow = {
  id: string
  organization_id: string
  department_id: string
  name: string
  description: string | null
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
  archived_at: string | null
}

type WorkspaceInvitation = {
  id: string
  email: string
  role: string
  status: string
  created_at: string
  expires_at: string | null
}

type WorkspaceCacheSnapshot = {
  members: TeamMember[]
  presenceSessions: PresenceSession[]
  timelineEvents: OrganizationTimelineEvent[]
  hasCache: boolean
}

type TeamMemberDraft = {
  fullName: string
  department: string
  jobTitle: string
  roleLabel: string
}

type TeamMemberUpdate = {
  full_name: string
  department: string | null
  job_title: string | null
  role_label: string | null
}

type MemberAccountStatus = 'active' | 'deactivated' | 'deleted'
type MemberAccountAction = 'deactivate' | 'delete' | 'reactivate'
type WorkspaceSectionKey =
  | 'overview'
  | 'organization-settings'
  | 'departments'
  | 'jobs'
  | 'roles-permissions'
  | 'invitations'
  | 'audit-logs'
  | 'notification-settings'
  | 'branches'
  | 'business-units'
  | 'employee-directory'
  | 'org-chart'
  | 'teams'
  | 'schedules'
  | 'leave-types'
  | 'approval-workflows'
  | 'invoice-settings'
  | 'tax-settings'
  | 'email-templates'
  | 'templates'
  | 'branding'
  | 'api-keys'
  | 'webhooks'
  | 'two-factor'
  | 'subscription'
  | 'usage'
  | 'import-export'
  | 'backups'

type WorkspaceSection = {
  key: WorkspaceSectionKey
  label: string
  description: string
  icon: typeof Building2
  comingSoon?: boolean
}

type WorkspaceSectionGroup = {
  title: string
  icon: typeof Building2
  items: WorkspaceSection[]
}

const WEEKDAY_LABELS: Record<WeekdayKey, string> = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
  sunday: 'Sun',
}

const MEMBER_ROLE_LABELS = [
  { value: 'member', label: 'Member' },
  { value: 'viewer', label: 'Viewer' },
  { value: 'admin', label: 'Admin' },
  { value: 'owner', label: 'Owner' },
] as const

const V1_LIVE_SECTIONS = new Set<WorkspaceSectionKey>([
  'overview',
  'organization-settings',
  'departments',
  'jobs',
  'roles-permissions',
  'invitations',
  'audit-logs',
  'notification-settings',
])

const WORKSPACE_SECTION_GROUPS: WorkspaceSectionGroup[] = [
  {
    title: 'Organization',
    icon: Sparkles,
    items: [
      { key: 'overview', label: 'Overview', description: 'Summary dashboard and quick actions.', icon: Sparkles },
    ],
  },
  {
    title: 'Setup',
    icon: Building2,
    items: [
      { key: 'organization-settings', label: 'Organization Settings', description: 'Identity and structure settings.', icon: Building2 },
      { key: 'branches', label: 'Branches', description: 'Branch and location setup.', icon: MapPin, comingSoon: true },
      { key: 'business-units', label: 'Business Units', description: 'Unit-level operational grouping.', icon: Workflow, comingSoon: true },
    ],
  },
  {
    title: 'Workforce',
    icon: Users2,
    items: [
      { key: 'departments', label: 'Departments', description: 'Department structure and occupancy.', icon: Users2 },
      { key: 'jobs', label: 'Jobs', description: 'Roles and job-position mapping.', icon: UserCog },
      { key: 'employee-directory', label: 'Employee Directory', description: 'Full organization people directory.', icon: Users2, comingSoon: true },
      { key: 'org-chart', label: 'Org Chart', description: 'Visual reporting hierarchy.', icon: Workflow, comingSoon: true },
    ],
  },
  {
    title: 'Access Control',
    icon: Shield,
    items: [
      { key: 'roles-permissions', label: 'Roles & Permissions', description: 'Access control matrix.', icon: Shield },
      { key: 'teams', label: 'Teams', description: 'Group-based access control.', icon: Users2, comingSoon: true },
      { key: 'invitations', label: 'Invitations', description: 'Invite and access lifecycle.', icon: UserPlus },
    ],
  },
  {
    title: 'Work Config',
    icon: CalendarDays,
    items: [
      { key: 'schedules', label: 'Schedules', description: 'Work schedule and shift templates.', icon: CalendarDays, comingSoon: true },
      { key: 'leave-types', label: 'Leave Types', description: 'Leave and time-off setup.', icon: CalendarDays, comingSoon: true },
      { key: 'approval-workflows', label: 'Approval Workflows', description: 'Approval path automation.', icon: Workflow, comingSoon: true },
    ],
  },
  {
    title: 'Finance',
    icon: ReceiptText,
    items: [
      { key: 'invoice-settings', label: 'Invoice Settings', description: 'Invoice numbering and templates.', icon: ReceiptText, comingSoon: true },
      { key: 'tax-settings', label: 'Tax Settings', description: 'Tax policies and defaults.', icon: ReceiptText, comingSoon: true },
    ],
  },
  {
    title: 'Communication',
    icon: Mail,
    items: [
      { key: 'notification-settings', label: 'Notifications', description: 'Organization notification defaults.', icon: Bell },
      { key: 'email-templates', label: 'Email Templates', description: 'Template branding and copy.', icon: Mail, comingSoon: true },
    ],
  },
  {
    title: 'Documents',
    icon: FileText,
    items: [
      { key: 'templates', label: 'Templates', description: 'Document template standards.', icon: FileText, comingSoon: true },
      { key: 'branding', label: 'Branding', description: 'Branding across PDF and email assets.', icon: Building2, comingSoon: true },
    ],
  },
  {
    title: 'Integrations',
    icon: Workflow,
    items: [
      { key: 'api-keys', label: 'API Keys', description: 'External API key management.', icon: KeyRound, comingSoon: true },
      { key: 'webhooks', label: 'Webhooks', description: 'Outbound event subscriptions.', icon: Workflow, comingSoon: true },
    ],
  },
  {
    title: 'Security',
    icon: Shield,
    items: [
      { key: 'two-factor', label: '2FA', description: 'Multi-factor authentication policy.', icon: Shield, comingSoon: true },
      { key: 'audit-logs', label: 'Audit Logs', description: 'Organization access and action traces.', icon: FileText },
    ],
  },
  {
    title: 'Billing',
    icon: ReceiptText,
    items: [
      { key: 'subscription', label: 'Subscription', description: 'Plan status and subscription details.', icon: ReceiptText, comingSoon: true },
      { key: 'usage', label: 'Usage', description: 'Current usage and threshold visibility.', icon: Users2, comingSoon: true },
    ],
  },
  {
    title: 'Data',
    icon: FileText,
    items: [
      { key: 'import-export', label: 'Import / Export', description: 'Data import and export operations.', icon: FileText, comingSoon: true },
      { key: 'backups', label: 'Backups', description: 'Backup and restore controls.', icon: FileText, comingSoon: true },
    ],
  },
]

function isWorkspaceSectionKey(value: string | null): value is WorkspaceSectionKey {
  if (!value) return false
  return WORKSPACE_SECTION_GROUPS.some((group) => group.items.some((item) => item.key === value))
}

function readCachedArray<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw) as { items?: T[] } | T[]
    if (Array.isArray(parsed)) return parsed
    if (Array.isArray(parsed.items)) return parsed.items
    return []
  } catch {
    return []
  }
}

function writeCachedArray<T>(key: string, items: T[]) {
  localStorage.setItem(key, JSON.stringify({ items, cachedAt: Date.now() }))
}

function readWorkspaceCacheSnapshot(): WorkspaceCacheSnapshot {
  const members = readCachedArray<TeamMember>(WORKSPACE_MEMBERS_CACHE_KEY)
  const presenceSessions = readCachedArray<PresenceSession>(WORKSPACE_PRESENCE_CACHE_KEY)
  const timelineEvents = readCachedArray<OrganizationTimelineEvent>(WORKSPACE_TIMELINE_CACHE_KEY)

  return {
    members,
    presenceSessions,
    timelineEvents,
    hasCache: members.length > 0 || presenceSessions.length > 0 || timelineEvents.length > 0,
  }
}

function initials(name: string) {
  const parts = name.split(' ').filter(Boolean)
  if (parts.length === 0) return 'U'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
}

function memberRole(member: TeamMember) {
  return member.job_title ?? member.role_label ?? member.department ?? 'Team member'
}

function memberStatusLabel(status: MemberAccountStatus) {
  if (status === 'deactivated') return 'Deactivated'
  if (status === 'deleted') return 'Deleted'
  return 'Active'
}

function memberStatusBadgeClass(status: MemberAccountStatus) {
  if (status === 'deactivated') {
    return 'border-amber-500/40 bg-amber-500/15 text-amber-200'
  }
  if (status === 'deleted') {
    return 'border-rose-500/40 bg-rose-500/15 text-rose-200'
  }
  return 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
}

function formatInvitationDate(value: string | null) {
  if (!value) return 'Not set'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not set'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
}

function invitationStatusClass(status: string) {
  switch (status.toLowerCase()) {
    case 'accepted':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'
    case 'revoked':
    case 'expired':
      return 'border-rose-500/30 bg-rose-500/10 text-rose-600'
    default:
      return 'border-amber-500/30 bg-amber-500/10 text-amber-600'
  }
}

function openInvitePeopleDialog() {
  window.dispatchEvent(new CustomEvent('cloudnine:open-invite-people'))
}

function DepartmentSelectPopover({
  value,
  departments,
  disabled,
  placeholder = 'Select department',
  onChange,
  onAddDepartment,
}: {
  value: string
  departments: DepartmentRow[]
  disabled?: boolean
  placeholder?: string
  onChange: (departmentId: string) => void
  onAddDepartment: () => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const selectedDepartment = departments.find((department) => department.id === value) ?? null
  const filteredDepartments = departments.filter((department) =>
    department.name.toLowerCase().includes(query.trim().toLowerCase()),
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type='button'
          variant='outline'
          className='h-10 w-full justify-between px-3 font-normal'
          disabled={disabled}
        >
          <span className={selectedDepartment ? 'text-foreground' : 'text-muted-foreground'}>
            {selectedDepartment?.name ?? placeholder}
          </span>
          <ChevronDown className='h-4 w-4 text-muted-foreground' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[var(--radix-popover-trigger-width)] p-2' align='start'>
        <div className='space-y-2'>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder='Search departments'
            className='h-9'
          />
          <div
            className='max-h-44 overscroll-contain overflow-y-auto rounded-md border'
            onWheel={(event) => event.stopPropagation()}
            onTouchMove={(event) => event.stopPropagation()}
          >
            {filteredDepartments.length === 0 ? (
              <p className='px-3 py-2 text-xs text-muted-foreground'>No departments found.</p>
            ) : (
              filteredDepartments.map((department) => (
                <button
                  key={department.id}
                  type='button'
                  className='block w-full border-b border-border/60 px-3 py-2 text-left text-sm transition-colors last:border-b-0 hover:bg-muted/40'
                  onClick={() => {
                    onChange(department.id)
                    setOpen(false)
                    setQuery('')
                  }}
                >
                  {department.name}
                </button>
              ))
            )}
          </div>
          <Button
            type='button'
            size='sm'
            variant='outline'
            className='w-full justify-center gap-1.5'
            onClick={() => {
              setOpen(false)
              setQuery('')
              onAddDepartment()
            }}
          >
            <CirclePlus className='h-4 w-4' />
            Add department
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function formatClockLabel(value: string) {
  const [hours, minutes] = value.split(':').map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value
  const date = new Date()
  date.setHours(hours, minutes, 0, 0)
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date)
}

function formatAvailabilityBlock(block: AvailabilityBlock) {
  return `${WEEKDAY_LABELS[block.day]} ${formatClockLabel(block.startTime)} - ${formatClockLabel(block.endTime)}`
}

function isValidTimeValue(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

function toMinutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

function normalizeAvailabilitySchedule(raw: unknown): AvailabilityBlock[] {
  if (!Array.isArray(raw)) return []
  const validDays = new Set<WeekdayKey>(WEEKDAY_BY_INDEX)
  return raw
    .filter((item): item is { day?: unknown; startTime?: unknown; endTime?: unknown } => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      day: typeof item.day === 'string' ? item.day.toLowerCase() : '',
      startTime: typeof item.startTime === 'string' ? item.startTime : '',
      endTime: typeof item.endTime === 'string' ? item.endTime : '',
    }))
    .filter((item): item is AvailabilityBlock => {
      return (
        validDays.has(item.day as WeekdayKey) &&
        isValidTimeValue(item.startTime) &&
        isValidTimeValue(item.endTime) &&
        toMinutes(item.endTime) > toMinutes(item.startTime)
      )
    })
}

function isMemberAvailable(member: TeamMember) {
  if (member.account_status !== 'active') return false
  const schedule = normalizeAvailabilitySchedule(member.availability_schedule)
  if (schedule.length === 0) return false
  const now = new Date()
  const currentDay = WEEKDAY_BY_INDEX[now.getDay()]
  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  return schedule.some(
    (block) =>
      block.day === currentDay &&
      currentMinutes >= toMinutes(block.startTime) &&
      currentMinutes < toMinutes(block.endTime),
  )
}

function isPresenceSessionActive(session: PresenceSession, nowMs: number) {
  if (!session.is_online) return false
  if (!session.last_seen_at) return true
  const lastSeenMs = new Date(session.last_seen_at).getTime()
  if (Number.isNaN(lastSeenMs)) return false
  return nowMs - lastSeenMs <= ONLINE_WINDOW_MS
}

function isMemberOnline(member: TeamMember, presenceSessions: PresenceSession[], nowMs: number) {
  if (member.account_status !== 'active') return false
  return presenceSessions.some((session) => session.user_id === member.id && isPresenceSessionActive(session, nowMs))
}

function formatTimelineTime(startsAt: string) {
  const eventDate = new Date(startsAt)
  if (Number.isNaN(eventDate.getTime())) return 'TBD'

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfEventDay = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate())
  const dayDiff = Math.round((startOfEventDay.getTime() - startOfToday.getTime()) / (24 * 60 * 60 * 1000))

  const timeLabel = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(eventDate)
  if (dayDiff === 0) return `Today • ${timeLabel}`
  if (dayDiff === 1) return `Tomorrow • ${timeLabel}`
  if (dayDiff > 1 && dayDiff <= 6) {
    const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(eventDate)
    return `${weekday} • ${timeLabel}`
  }
  const dateLabel = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(eventDate)
  return `${dateLabel} • ${timeLabel}`
}

function WorkspacePageSkeleton() {
  return (
    <div className='space-y-4'>
      <Card>
        <CardContent className='flex items-center justify-between gap-3 p-3'>
          <div className='space-y-2'>
            <div className='h-4 w-40 rounded bg-muted/60 animate-pulse' />
            <div className='h-3 w-72 max-w-[70vw] rounded bg-muted/40 animate-pulse' />
          </div>
          <div className='h-9 w-40 rounded-md bg-muted/50 animate-pulse' />
        </CardContent>
      </Card>
      <section className='grid gap-4 xl:grid-cols-[1.35fr_1fr]'>
        <Card>
          <CardHeader className='pb-3'>
            <div className='h-5 w-32 rounded bg-muted/50 animate-pulse' />
          </CardHeader>
          <CardContent className='space-y-2'>
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={`workspace-member-skeleton-${index}`} className='h-14 rounded-md border bg-muted/20 animate-pulse' />
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className='pb-3'>
            <div className='h-5 w-40 rounded bg-muted/50 animate-pulse' />
          </CardHeader>
          <CardContent className='space-y-3'>
            <div className='h-20 rounded-md border bg-muted/20 animate-pulse' />
            <div className='h-20 rounded-md border bg-muted/20 animate-pulse' />
          </CardContent>
        </Card>
      </section>
      <Card>
        <CardHeader className='pb-3'>
          <div className='h-5 w-56 rounded bg-muted/50 animate-pulse' />
        </CardHeader>
        <CardContent className='space-y-2'>
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={`workspace-timeline-skeleton-${index}`} className='h-14 rounded-md border bg-muted/20 animate-pulse' />
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

function MemberDetailsDialog({
  member,
  isAdmin,
  isOnline,
  isAvailable,
  availabilityBlocks,
  open,
  onOpenChange,
  onSave,
  onChangeAccountStatus,
  departmentOptions,
  jobsByDepartment,
  onRequestCreateDepartment,
  onRequestCreateJob,
}: {
  member: TeamMember | null
  isAdmin: boolean
  isOnline: boolean
  isAvailable: boolean
  availabilityBlocks: AvailabilityBlock[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (memberId: string, updates: TeamMemberUpdate) => Promise<void>
  onChangeAccountStatus: (memberId: string, accountStatus: MemberAccountStatus) => Promise<void>
  departmentOptions: string[]
  jobsByDepartment: Record<string, string[]>
  onRequestCreateDepartment: () => void
  onRequestCreateJob: (departmentName?: string) => void
}) {
  const [draft, setDraft] = useState<TeamMemberDraft>({
    fullName: '',
    department: '',
    jobTitle: '',
    roleLabel: '',
  })
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<MemberAccountAction | null>(null)
  const [actionSaving, setActionSaving] = useState(false)
  const [departmentOpen, setDepartmentOpen] = useState(false)
  const [departmentQuery, setDepartmentQuery] = useState('')
  const [jobOpen, setJobOpen] = useState(false)
  const [jobQuery, setJobQuery] = useState('')

  useEffect(() => {
    if (!open || !member) return
    setDraft({
      fullName: member.full_name ?? '',
      department: member.department ?? '',
      jobTitle: member.job_title ?? '',
      roleLabel: member.role_label ?? '',
    })
    setSaving(false)
    setActionSaving(false)
    setPendingAction(null)
    setErrorMessage(null)
    setDepartmentOpen(false)
    setDepartmentQuery('')
    setJobOpen(false)
    setJobQuery('')
  }, [member, open])

  const displayName = member?.full_name ?? member?.email ?? 'Unnamed user'
  const headline = member ? memberRole(member) : 'Team member'
  const accountStatus = member?.account_status ?? 'active'
  const statusLabel = member ? memberStatusLabel(accountStatus) : 'Active'
  const canDeactivate = accountStatus === 'active'
  const canDelete = accountStatus !== 'deleted'
  const canReactivate = accountStatus !== 'active'
  const deactivateLabel = accountStatus === 'active' ? 'Deactivate account' : 'Deactivate unavailable'
  const deleteLabel = accountStatus === 'deleted' ? 'Already deleted' : 'Delete account'
  const reactivateLabel = accountStatus === 'deleted' ? 'Restore account' : 'Reactivate account'
  const filteredJobOptions = draft.department.trim() ? (jobsByDepartment[draft.department.trim()] ?? []) : []
  const filteredDepartmentOptions = departmentOptions.filter((department) => department.toLowerCase().includes(departmentQuery.trim().toLowerCase()))
  const filteredJobOptionsByQuery = filteredJobOptions.filter((job) => job.toLowerCase().includes(jobQuery.trim().toLowerCase()))

  const handleSave = async () => {
    if (!member) return
    const fullName = draft.fullName.trim()
    if (!fullName) {
      setErrorMessage('Full name is required.')
      notify.error('Full name is required')
      return
    }

    setSaving(true)
    setErrorMessage(null)
    try {
      await onSave(member.id, {
        full_name: fullName,
        department: draft.department.trim() || null,
        job_title: draft.jobTitle.trim() || null,
        role_label: draft.roleLabel.trim() || null,
      })
      onOpenChange(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save member.'
      setErrorMessage(message)
      notify.error('Unable to save member', { description: message })
    } finally {
      setSaving(false)
    }
  }

  const handleAccountAction = async (action: MemberAccountAction) => {
    if (!member) return

    setActionSaving(true)
    setErrorMessage(null)
    try {
      await onChangeAccountStatus(
        member.id,
        action === 'delete' ? 'deleted' : action === 'reactivate' ? 'active' : 'deactivated',
      )
      setPendingAction(null)
      onOpenChange(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update account status.'
      setErrorMessage(message)
      notify.error('Unable to update account status', { description: message })
    } finally {
      setActionSaving(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className='max-w-2xl max-h-[85vh] overflow-y-auto p-7 sm:p-8'>
          <DialogHeader>
            <DialogTitle>Member details</DialogTitle>
            <DialogDescription>
              {isAdmin ? 'Admins can edit the team profile directly here.' : 'View the member profile and availability.'}
            </DialogDescription>
          </DialogHeader>

          {member ? (
            <div className='space-y-6'>
              <div className='flex items-start gap-4 rounded-lg border bg-muted/10 p-4'>
                <div className='relative'>
                  <Avatar className='h-14 w-14 border'>
                    {member.avatar_url ? <AvatarImage src={member.avatar_url} alt={displayName} /> : null}
                    <AvatarFallback className='text-sm font-semibold'>{initials(displayName)}</AvatarFallback>
                  </Avatar>
                  <span
                    className={
                      isOnline
                        ? 'absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border border-background bg-emerald-400'
                        : 'absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border border-background bg-rose-400'
                    }
                    aria-label={isOnline ? 'Online' : 'Offline'}
                    title={isOnline ? 'Online' : 'Offline'}
                  />
                </div>
                <div className='min-w-0 flex-1 space-y-2'>
                  <div className='space-y-1'>
                    <p className='truncate text-base font-semibold text-foreground'>{displayName}</p>
                    <p className='text-sm text-muted-foreground'>{headline}</p>
                  </div>
                  <div className='flex flex-wrap gap-2'>
                    <Badge
                      variant='outline'
                      className={
                        isOnline
                          ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                          : 'border-rose-500/40 bg-rose-500/15 text-rose-300'
                      }
                    >
                      {isOnline ? 'Online' : 'Offline'}
                    </Badge>
                    <Badge
                      variant='outline'
                      className={
                        isAvailable
                          ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                          : 'border-rose-500/40 bg-rose-500/15 text-rose-300'
                      }
                    >
                      {isAvailable ? 'Available' : 'Unavailable'}
                    </Badge>
                    <Badge variant='outline' className={memberStatusBadgeClass(accountStatus)}>
                      {statusLabel}
                    </Badge>
                  </div>
                  <p className='inline-flex items-center gap-2 text-sm text-muted-foreground'>
                    <Mail className='h-4 w-4' />
                    <span>{member.email ?? 'No email on file'}</span>
                  </p>
                </div>
              </div>

              {isAdmin ? (
                <div className='grid gap-4 sm:grid-cols-2'>
                  <div className='space-y-2 sm:col-span-2'>
                    <label className='text-sm font-medium text-foreground'>Full name</label>
                    <Input
                      value={draft.fullName}
                      onChange={(event) => setDraft((current) => ({ ...current, fullName: event.target.value }))}
                      placeholder='Enter full name'
                    />
                  </div>
                  <div className='space-y-2'>
                    <label className='text-sm font-medium text-foreground'>Department</label>
                    <Popover open={departmentOpen} onOpenChange={setDepartmentOpen}>
                      <PopoverTrigger asChild>
                        <Button type='button' variant='outline' className='h-10 w-full justify-between px-3 font-normal'>
                          <span className={draft.department ? 'text-foreground' : 'text-muted-foreground'}>
                            {draft.department || 'Select department'}
                          </span>
                          <ChevronDown className='h-4 w-4 text-muted-foreground' />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className='w-[var(--radix-popover-trigger-width)] p-2' align='start'>
                        <div className='space-y-2'>
                          <Input
                            value={departmentQuery}
                            onChange={(event) => setDepartmentQuery(event.target.value)}
                            placeholder='Search departments'
                            className='h-9'
                          />
                          <div
                            className='max-h-44 overscroll-contain overflow-y-auto rounded-md border'
                            onWheel={(event) => event.stopPropagation()}
                            onTouchMove={(event) => event.stopPropagation()}
                          >
                            {filteredDepartmentOptions.length === 0 ? (
                              <p className='px-3 py-2 text-xs text-muted-foreground'>No departments found.</p>
                            ) : (
                              filteredDepartmentOptions.map((department) => (
                                <button
                                  key={department}
                                  type='button'
                                  className='block w-full border-b border-border/60 px-3 py-2 text-left text-sm transition-colors last:border-b-0 hover:bg-muted/40'
                                  onClick={() => {
                                    setDraft((current) => ({ ...current, department, jobTitle: '' }))
                                    setDepartmentOpen(false)
                                    setDepartmentQuery('')
                                    setJobQuery('')
                                  }}
                                >
                                  {department}
                                </button>
                              ))
                            )}
                          </div>
                          <Button
                            type='button'
                            size='sm'
                            variant='outline'
                            className='w-full justify-center gap-1.5'
                            onClick={() => {
                              setDepartmentOpen(false)
                              onRequestCreateDepartment()
                            }}
                          >
                            <CirclePlus className='h-4 w-4' />
                            Add department
                          </Button>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className='space-y-2'>
                    <label className='text-sm font-medium text-foreground'>Job title</label>
                    <Popover open={jobOpen} onOpenChange={setJobOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          type='button'
                          variant='outline'
                          className='h-10 w-full justify-between px-3 font-normal'
                          disabled={!draft.department.trim()}
                        >
                          <span className={draft.jobTitle ? 'text-foreground' : 'text-muted-foreground'}>
                            {draft.jobTitle || (draft.department.trim() ? 'Select job title' : 'Select department first')}
                          </span>
                          <ChevronDown className='h-4 w-4 text-muted-foreground' />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className='w-[var(--radix-popover-trigger-width)] p-2' align='start'>
                        <div className='space-y-2'>
                          <Input value={jobQuery} onChange={(event) => setJobQuery(event.target.value)} placeholder='Search jobs' className='h-9' />
                          <div
                            className='max-h-44 overscroll-contain overflow-y-auto rounded-md border'
                            onWheel={(event) => event.stopPropagation()}
                            onTouchMove={(event) => event.stopPropagation()}
                          >
                            {filteredJobOptionsByQuery.length === 0 ? (
                              <p className='px-3 py-2 text-xs text-muted-foreground'>No jobs found for this department.</p>
                            ) : (
                              filteredJobOptionsByQuery.map((job) => (
                                <button
                                  key={job}
                                  type='button'
                                  className='block w-full border-b border-border/60 px-3 py-2 text-left text-sm transition-colors last:border-b-0 hover:bg-muted/40'
                                  onClick={() => {
                                    setDraft((current) => ({ ...current, jobTitle: job }))
                                    setJobOpen(false)
                                    setJobQuery('')
                                  }}
                                >
                                  {job}
                                </button>
                              ))
                            )}
                          </div>
                          <Button
                            type='button'
                            size='sm'
                            variant='outline'
                            className='w-full justify-center gap-1.5'
                            onClick={() => {
                              setJobOpen(false)
                              onRequestCreateJob(draft.department.trim() || undefined)
                            }}
                            disabled={!draft.department.trim()}
                          >
                            <CirclePlus className='h-4 w-4' />
                            Add job
                          </Button>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className='space-y-2 sm:col-span-2'>
                    <label className='text-sm font-medium text-foreground'>Role label</label>
                    <select
                      value={draft.roleLabel}
                      onChange={(event) => setDraft((current) => ({ ...current, roleLabel: event.target.value }))}
                      className='h-10 w-full rounded-md border border-input bg-background px-3 text-sm'
                    >
                      <option value=''>Select role label</option>
                      {MEMBER_ROLE_LABELS.map((role) => (
                        <option key={role.value} value={role.value}>
                          {role.label}
                        </option>
                      ))}
                      {draft.roleLabel.trim() && !MEMBER_ROLE_LABELS.some((role) => role.value === draft.roleLabel) ? (
                        <option value={draft.roleLabel}>{draft.roleLabel}</option>
                      ) : null}
                    </select>
                  </div>
                </div>
              ) : (
                <div className='grid gap-3 sm:grid-cols-2'>
                  <div className='rounded-md border bg-muted/10 p-3'>
                    <p className='text-xs uppercase tracking-wide text-muted-foreground'>Department</p>
                    <p className='mt-1 text-sm text-foreground'>{member.department ?? 'No department set'}</p>
                  </div>
                  <div className='rounded-md border bg-muted/10 p-3'>
                    <p className='text-xs uppercase tracking-wide text-muted-foreground'>Job title</p>
                    <p className='mt-1 text-sm text-foreground'>{member.job_title ?? 'No job title set'}</p>
                  </div>
                </div>
              )}

              {errorMessage ? <p className='text-sm text-rose-400'>{errorMessage}</p> : null}

              <div className='rounded-md border bg-muted/10 p-3'>
                <div className='mb-2 flex items-center gap-2 text-sm font-medium text-foreground'>
                  <span className='inline-flex h-2 w-2 rounded-full bg-primary' />
                  Availability schedule
                </div>
                {availabilityBlocks.length === 0 ? (
                  <p className='text-sm text-muted-foreground'>No availability schedule set.</p>
                ) : (
                  <div className='flex flex-wrap gap-2'>
                    {availabilityBlocks.map((block) => (
                      <span key={`${block.day}-${block.startTime}-${block.endTime}`} className='rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground'>
                        {formatAvailabilityBlock(block)}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {isAdmin ? (
                <div className='space-y-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4'>
                  <div className='space-y-1'>
                    <p className='text-sm font-medium text-foreground'>Account actions</p>
                    <p className='text-sm text-muted-foreground'>
                      Deactivate blocks sign-in until an administrator restores the account. Delete marks the account as removed and refuses future access. Reactivate returns the account to normal access.
                    </p>
                  </div>
                  <div className='flex flex-wrap gap-2'>
                    <Button
                      type='button'
                      variant='outline'
                      className='border-amber-500/30 bg-amber-500/10 text-amber-100 hover:bg-amber-500/15 hover:text-amber-50 disabled:opacity-60'
                      disabled={!canDeactivate || actionSaving}
                      onClick={() => setPendingAction('deactivate')}
                      >
                      <UserX className='h-4 w-4' />
                      {deactivateLabel}
                    </Button>
                    <Button
                      type='button'
                      variant='default'
                      className='bg-emerald-600 text-white hover:bg-emerald-500'
                      disabled={!canReactivate || actionSaving}
                      onClick={() => setPendingAction('reactivate')}
                    >
                      <Workflow className='h-4 w-4' />
                      {reactivateLabel}
                    </Button>
                    <Button
                      type='button'
                      variant='destructive'
                      disabled={!canDelete || actionSaving}
                      onClick={() => setPendingAction('delete')}
                    >
                      <Trash2 className='h-4 w-4' />
                      {deleteLabel}
                    </Button>
                  </div>
                </div>
              ) : null}

              <DialogFooter className='gap-2 sm:gap-0'>
                <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
                  Close
                </Button>
                {isAdmin ? (
                  <Button
                    type='button'
                    onClick={() => {
                      void handleSave()
                    }}
                    disabled={saving}
                  >
                    {saving ? 'Saving...' : 'Save changes'}
                  </Button>
                ) : null}
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(pendingAction)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !actionSaving) setPendingAction(null)
        }}
      >
        <DialogContent className='max-w-md overflow-hidden p-0'>
          <DialogHeader className='px-6 pt-6 pb-3 text-left'>
            <DialogTitle>
              {pendingAction === 'delete'
                ? 'Delete account?'
                : pendingAction === 'reactivate'
                  ? 'Reactivate account?'
                  : 'Deactivate account?'}
            </DialogTitle>
            <DialogDescription>
              {pendingAction === 'delete'
                ? 'This will mark the account as deleted and refuse future sign-in attempts.'
                : pendingAction === 'reactivate'
                  ? 'This will restore the account to active access and allow sign-in again.'
                  : 'This will sign the user out and block future sign-in attempts until an admin restores access.'}
            </DialogDescription>
          </DialogHeader>

          <div className='px-6 pb-6'>
            <div className='space-y-6'>
              <div className='space-y-2 rounded-2xl bg-muted/35 px-4 py-4'>
                <p className='text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground'>Selected account</p>
                <div className='space-y-1'>
                  <p className='text-base font-semibold text-foreground'>{displayName}</p>
                  <p className='text-sm text-muted-foreground'>{member?.email ?? 'No email on file'}</p>
                </div>
              </div>

              <div className='flex flex-col-reverse gap-3 sm:flex-row sm:justify-end'>
                <Button type='button' variant='outline' onClick={() => setPendingAction(null)} disabled={actionSaving}>
                  Cancel
                </Button>
                <Button
                  type='button'
                  variant={pendingAction === 'delete' ? 'destructive' : pendingAction === 'reactivate' ? 'default' : 'default'}
                  className={pendingAction === 'reactivate' ? 'bg-emerald-600 text-white hover:bg-emerald-500' : undefined}
                  onClick={() => {
                    if (!pendingAction) return
                    void handleAccountAction(pendingAction)
                  }}
                  disabled={!pendingAction || actionSaving}
                >
                  {actionSaving
                    ? 'Processing...'
                    : pendingAction === 'delete'
                      ? 'Delete account'
                      : pendingAction === 'reactivate'
                        ? 'Reactivate account'
                        : 'Deactivate account'}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function WorkspacePage() {
  const { currentOrganization } = useOrganization()
  const [initialWorkspaceCache] = useState(() => readWorkspaceCacheSnapshot())
  const { currentUser, updateCurrentUser, logout } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeSection: WorkspaceSectionKey = isWorkspaceSectionKey(searchParams.get('section'))
    ? (searchParams.get('section') as WorkspaceSectionKey)
    : 'overview'
  const [members, setMembers] = useState<TeamMember[]>(() => initialWorkspaceCache.members)
  const [presenceSessions, setPresenceSessions] = useState<PresenceSession[]>(() => initialWorkspaceCache.presenceSessions)
  const [timelineEvents, setTimelineEvents] = useState<OrganizationTimelineEvent[]>(() => initialWorkspaceCache.timelineEvents)
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([])
  const [clockMs, setClockMs] = useState(() => Date.now())
  const [loadingWorkspace, setLoadingWorkspace] = useState(() => !initialWorkspaceCache.hasCache)
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null)
  const [groupExpansionOverrides, setGroupExpansionOverrides] = useState<Record<string, boolean>>({})
  const [departments, setDepartments] = useState<DepartmentRow[]>([])
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [newDepartmentName, setNewDepartmentName] = useState('')
  const [creatingDepartment, setCreatingDepartment] = useState(false)
  const [editingDepartmentId, setEditingDepartmentId] = useState<string | null>(null)
  const [editingDepartmentName, setEditingDepartmentName] = useState('')
  const [departmentSavingId, setDepartmentSavingId] = useState<string | null>(null)
  const [createDepartmentModalOpen, setCreateDepartmentModalOpen] = useState(false)
  const [editDepartmentModalOpen, setEditDepartmentModalOpen] = useState(false)
  const [newJobName, setNewJobName] = useState('')
  const [newJobDepartmentId, setNewJobDepartmentId] = useState('')
  const [creatingJob, setCreatingJob] = useState(false)
  const [editingJobId, setEditingJobId] = useState<string | null>(null)
  const [editingJobName, setEditingJobName] = useState('')
  const [editingJobDepartmentId, setEditingJobDepartmentId] = useState('')
  const [jobSavingId, setJobSavingId] = useState<string | null>(null)
  const [createJobModalOpen, setCreateJobModalOpen] = useState(false)
  const [editJobModalOpen, setEditJobModalOpen] = useState(false)

  useEffect(() => {
    const memberId = searchParams.get('memberId')
    if (!memberId) return

    const timer = window.setTimeout(() => {
      setSelectedMemberId(memberId)

      const nextParams = new URLSearchParams(searchParams)
      nextParams.delete('memberId')
      setSearchParams(nextParams, { replace: true })
    }, 0)

    return () => window.clearTimeout(timer)
  }, [searchParams, setSearchParams])

  useEffect(() => {
    let cancelled = false
    let refreshTimer: number | null = null
    let pollTimer: number | null = null
    let loadErrorNotified = false

    const loadMembersAndPresence = async () => {
      try {
        const membersResult = await supabase
          .from('profiles')
          .select('id, full_name, email, avatar_url, job_title, department, role_label, account_status, deactivated_at, deleted_at, availability_schedule')
          .order('full_name', { ascending: true })
        if (!cancelled && !membersResult.error && membersResult.data) {
          setMembers(membersResult.data as TeamMember[])
          writeCachedArray(WORKSPACE_MEMBERS_CACHE_KEY, membersResult.data as TeamMember[])
        }

        const sinceIso = new Date(Date.now() - 6 * 60 * 1000).toISOString()
        const presenceResult = await supabase
          .from('user_presence_sessions')
          .select('user_id, is_online, last_seen_at')
          .eq('is_online', true)
          .gte('last_seen_at', sinceIso)

        if (!cancelled && !presenceResult.error && presenceResult.data) {
          setPresenceSessions(presenceResult.data as PresenceSession[])
          writeCachedArray(WORKSPACE_PRESENCE_CACHE_KEY, presenceResult.data as PresenceSession[])
        }

        const timelineResult = await supabase
          .from('organization_timeline_events')
          .select('id, title, event_type, starts_at')
          .gte('starts_at', new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString())
          .order('starts_at', { ascending: true })
          .limit(10)

        if (!cancelled && !timelineResult.error && timelineResult.data) {
          setTimelineEvents(timelineResult.data as OrganizationTimelineEvent[])
          writeCachedArray(WORKSPACE_TIMELINE_CACHE_KEY, timelineResult.data as OrganizationTimelineEvent[])
        }

        const invitationsResult = await supabase
          .from('organization_invitations')
          .select('id, email, role, status, created_at, expires_at')
          .order('created_at', { ascending: false })
          .limit(25)

        if (!cancelled && !invitationsResult.error && invitationsResult.data) {
          setInvitations(invitationsResult.data as WorkspaceInvitation[])
        }

        const departmentsResult = await supabase
          .from('departments')
          .select('id, organization_id, name, description, is_active, created_by, created_at, updated_at, archived_at')
          .eq('organization_id', currentOrganization.id)
          .order('name', { ascending: true })

        if (!cancelled && !departmentsResult.error && departmentsResult.data) {
          setDepartments(departmentsResult.data as DepartmentRow[])
        }

        const jobsResult = await supabase
          .from('jobs')
          .select('id, organization_id, department_id, name, description, is_active, created_by, created_at, updated_at, archived_at')
          .eq('organization_id', currentOrganization.id)
          .order('name', { ascending: true })

        if (!cancelled && !jobsResult.error && jobsResult.data) {
          setJobs(jobsResult.data as JobRow[])
        }

        if (!cancelled) {
          setLoadingWorkspace(false)
        }
      } catch (error) {
        if (cancelled) return

        setLoadingWorkspace(false)
        console.error('Workspace data refresh failed', error)

        if (!loadErrorNotified) {
          loadErrorNotified = true
          const message = error instanceof Error ? error.message : 'Unable to load workspace data.'
          notify.error('Workspace data refresh failed', { description: message })
        }
      }
    }

    const refreshWorkspaceData = () => {
      void loadMembersAndPresence()
    }

    refreshWorkspaceData()

    const channel = supabase
      .channel('workspace-profiles-presence')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
        if (refreshTimer !== null) {
          window.clearTimeout(refreshTimer)
        }
        refreshTimer = window.setTimeout(() => {
          refreshWorkspaceData()
          refreshTimer = null
        }, 200)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_presence_sessions' }, () => {
        if (refreshTimer !== null) {
          window.clearTimeout(refreshTimer)
        }
        refreshTimer = window.setTimeout(() => {
          refreshWorkspaceData()
          refreshTimer = null
        }, 200)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'organization_timeline_events' }, () => {
        if (refreshTimer !== null) {
          window.clearTimeout(refreshTimer)
        }
        refreshTimer = window.setTimeout(() => {
          refreshWorkspaceData()
          refreshTimer = null
        }, 200)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'organization_invitations' }, () => {
        if (refreshTimer !== null) {
          window.clearTimeout(refreshTimer)
        }
        refreshTimer = window.setTimeout(() => {
          refreshWorkspaceData()
          refreshTimer = null
        }, 200)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'departments' }, () => {
        if (refreshTimer !== null) {
          window.clearTimeout(refreshTimer)
        }
        refreshTimer = window.setTimeout(() => {
          refreshWorkspaceData()
          refreshTimer = null
        }, 200)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, () => {
        if (refreshTimer !== null) {
          window.clearTimeout(refreshTimer)
        }
        refreshTimer = window.setTimeout(() => {
          refreshWorkspaceData()
          refreshTimer = null
        }, 200)
      })
      .subscribe()

    const handleRealtimeChange = (event: Event) => {
      const detail = (event as CustomEvent<{ table?: string }>).detail
      if (!detail?.table || !['profiles', 'organization_invitations', 'departments', 'jobs'].includes(detail.table)) return
      refreshWorkspaceData()
    }
    window.addEventListener('cloudnine:realtime-change', handleRealtimeChange as EventListener)

    pollTimer = window.setInterval(() => {
      refreshWorkspaceData()
    }, 45000)

    return () => {
      cancelled = true
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer)
      }
      if (pollTimer !== null) {
        window.clearInterval(pollTimer)
      }
      window.removeEventListener('cloudnine:realtime-change', handleRealtimeChange as EventListener)
      void supabase.removeChannel(channel)
    }
  }, [currentOrganization.id])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClockMs(Date.now())
    }, 15000)

    return () => {
      window.clearInterval(timer)
    }
  }, [])

  const activeCollaborators = members.filter((member) => member.account_status === 'active').length
  const departmentMap = useMemo(() => {
    const map = new Map<string, TeamMember[]>()
    for (const member of members) {
      const key = member.department?.trim() || 'Unassigned'
      const existing = map.get(key) ?? []
      existing.push(member)
      map.set(key, existing)
    }
    return Array.from(map.entries())
      .map(([name, team]) => ({ name, count: team.length, active: team.filter((member) => member.account_status === 'active').length }))
      .sort((a, b) => b.count - a.count)
  }, [members])
  const activeDepartmentRows = useMemo(
    () => departments.filter((department) => department.is_active && !department.archived_at),
    [departments],
  )
  const departmentOptions = useMemo(
    () =>
      activeDepartmentRows
        .map((department) => department.name.trim())
        .filter((name) => name.length > 0)
        .sort((left, right) => left.localeCompare(right)),
    [activeDepartmentRows],
  )
  const activeJobRows = useMemo(() => jobs.filter((job) => job.is_active && !job.archived_at), [jobs])
  const jobsByDepartment = useMemo(() => {
    const departmentNameById = new Map(activeDepartmentRows.map((department) => [department.id, department.name.trim()]))
    const grouped: Record<string, string[]> = {}

    for (const job of activeJobRows) {
      const departmentName = departmentNameById.get(job.department_id)
      const jobName = job.name.trim()
      if (!departmentName || !jobName) continue

      const existing = grouped[departmentName] ?? []
      if (!existing.includes(jobName)) {
        existing.push(jobName)
      }
      grouped[departmentName] = existing
    }

    for (const departmentName of Object.keys(grouped)) {
      grouped[departmentName].sort((left, right) => left.localeCompare(right))
    }

    return grouped
  }, [activeDepartmentRows, activeJobRows])
  const jobsMap = useMemo(() => {
    const map = new Map<string, TeamMember[]>()
    for (const member of members) {
      const key = member.job_title?.trim() || 'Unspecified role'
      const existing = map.get(key) ?? []
      existing.push(member)
      map.set(key, existing)
    }
    return map
  }, [members])
  const roleMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const member of members) {
      const key = member.role_label?.trim().toLowerCase() || 'member'
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return Array.from(map.entries())
      .map(([role, count]) => ({ role, count }))
      .sort((a, b) => b.count - a.count)
  }, [members])
  const onlineCollaborators = useMemo(
    () => members.filter((member) => isMemberOnline(member, presenceSessions, clockMs)).length,
    [clockMs, members, presenceSessions],
  )
  const isAdmin = (currentUser?.roleLabel ?? '').toLowerCase() === 'admin'
  const canManageDepartments = ['admin', 'owner'].includes((currentUser?.roleLabel ?? '').toLowerCase())
  const canInviteUsers = ['admin', 'owner'].includes((currentUser?.roleLabel ?? '').toLowerCase())
  const selectedMember = useMemo(
    () => members.find((member) => member.id === selectedMemberId) ?? null,
    [members, selectedMemberId],
  )

  const handleSaveMember = async (memberId: string, updates: TeamMemberUpdate) => {
    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', memberId)
      .select('id, full_name, email, avatar_url, job_title, department, role_label, account_status, deactivated_at, deleted_at, availability_schedule')
      .maybeSingle()

    if (error) throw error
    if (!data) throw new Error('Member profile was not updated.')

    setMembers((current) => current.map((member) => (member.id === memberId ? ({ ...member, ...data } as TeamMember) : member)))

    if (currentUser?.id === memberId) {
      // Keep the signed-in user session in sync when they edit their own profile here.
      const nextName = updates.full_name.trim()
      updateCurrentUser({
        name: nextName,
        jobTitle: updates.job_title ?? undefined,
        roleLabel: updates.role_label ?? undefined,
      })
    }

    notify.success('Member updated', {
      description: `${data.full_name ?? 'Team member'} has been saved.`,
    })
  }

  const handleChangeMemberAccountStatus = async (memberId: string, accountStatus: MemberAccountStatus) => {
    const nowIso = new Date().toISOString()
    const nextValues = {
      account_status: accountStatus,
      deactivated_at: accountStatus === 'deactivated' ? nowIso : null,
      deleted_at: accountStatus === 'deleted' ? nowIso : null,
    }

    const { data, error } = await supabase
      .from('profiles')
      .update(nextValues)
      .eq('id', memberId)
      .select('id, full_name, email, avatar_url, job_title, department, role_label, account_status, deactivated_at, deleted_at, availability_schedule')
      .maybeSingle()

    if (error) throw error
    if (!data) throw new Error('Member account was not updated.')

    setMembers((current) => current.map((member) => (member.id === memberId ? ({ ...member, ...data } as TeamMember) : member)))

    const actionLabel = accountStatus === 'deleted' ? 'deleted' : 'deactivated'
    notify.success(`Account ${actionLabel}`, {
      description: `${data.full_name ?? 'Team member'} has been ${actionLabel}.`,
    })

    if (currentUser?.id === memberId) {
      await logout({
        accessNotice:
          accountStatus === 'deleted'
            ? 'Your account has been deleted. Contact your administrator.'
            : 'Your account has been deactivated. Contact your administrator.',
      })
    }
  }

  const handleCreateDepartment = async () => {
    const name = newDepartmentName.trim()
    if (!name) {
      notify.error('Department name is required')
      return
    }

    setCreatingDepartment(true)
    try {
      const { data, error } = await supabase
        .from('departments')
        .insert({
          organization_id: currentOrganization.id,
          name,
          created_by: currentUser?.id ?? null,
          is_active: true,
        })
        .select('id, organization_id, name, description, is_active, created_by, created_at, updated_at, archived_at')
        .maybeSingle()

      if (error) throw error
      if (!data) throw new Error('Department was not created.')

      setDepartments((current) => [...current, data as DepartmentRow].sort((left, right) => left.name.localeCompare(right.name)))
      setNewDepartmentName('')
      setCreateDepartmentModalOpen(false)
      notify.success('Department created', { description: `${name} is now available for your organization.` })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create department.'
      notify.error('Unable to create department', { description: message })
    } finally {
      setCreatingDepartment(false)
    }
  }

  const handleRenameDepartment = async (departmentId: string) => {
    const name = editingDepartmentName.trim()
    if (!name) {
      notify.error('Department name is required')
      return
    }

    setDepartmentSavingId(departmentId)
    try {
      const { data, error } = await supabase
        .from('departments')
        .update({ name })
        .eq('id', departmentId)
        .eq('organization_id', currentOrganization.id)
        .select('id, organization_id, name, description, is_active, created_by, created_at, updated_at, archived_at')
        .maybeSingle()

      if (error) throw error
      if (!data) throw new Error('Department was not updated.')

      setDepartments((current) =>
        current
          .map((department) => (department.id === departmentId ? (data as DepartmentRow) : department))
          .sort((left, right) => left.name.localeCompare(right.name)),
      )
      setEditingDepartmentId(null)
      setEditingDepartmentName('')
      setEditDepartmentModalOpen(false)
      notify.success('Department updated')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update department.'
      notify.error('Unable to update department', { description: message })
    } finally {
      setDepartmentSavingId(null)
    }
  }

  const handleDeleteDepartment = async (departmentId: string) => {
    setDepartmentSavingId(departmentId)
    try {
      const { error } = await supabase
        .from('departments')
        .delete()
        .eq('id', departmentId)
        .eq('organization_id', currentOrganization.id)

      if (error) throw error

      setDepartments((current) => current.filter((department) => department.id !== departmentId))
      if (editingDepartmentId === departmentId) {
        setEditingDepartmentId(null)
        setEditingDepartmentName('')
      }
      notify.success('Department deleted')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to delete department.'
      notify.error('Unable to delete department', { description: message })
    } finally {
      setDepartmentSavingId(null)
    }
  }

  const handleCreateJob = async () => {
    const name = newJobName.trim()
    if (!name) {
      notify.error('Job name is required')
      return
    }
    if (!newJobDepartmentId) {
      notify.error('Select a department for this job')
      return
    }

    setCreatingJob(true)
    try {
      const { data, error } = await supabase
        .from('jobs')
        .insert({
          organization_id: currentOrganization.id,
          department_id: newJobDepartmentId,
          name,
          created_by: currentUser?.id ?? null,
          is_active: true,
        })
        .select('id, organization_id, department_id, name, description, is_active, created_by, created_at, updated_at, archived_at')
        .maybeSingle()

      if (error) throw error
      if (!data) throw new Error('Job was not created.')

      setJobs((current) => [...current, data as JobRow].sort((left, right) => left.name.localeCompare(right.name)))
      setNewJobName('')
      setNewJobDepartmentId('')
      setCreateJobModalOpen(false)
      notify.success('Job created', { description: `${name} has been added.` })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create job.'
      notify.error('Unable to create job', { description: message })
    } finally {
      setCreatingJob(false)
    }
  }

  const handleUpdateJob = async (jobId: string) => {
    const name = editingJobName.trim()
    if (!name) {
      notify.error('Job name is required')
      return
    }
    if (!editingJobDepartmentId) {
      notify.error('Select a department for this job')
      return
    }

    setJobSavingId(jobId)
    try {
      const { data, error } = await supabase
        .from('jobs')
        .update({ name, department_id: editingJobDepartmentId })
        .eq('id', jobId)
        .eq('organization_id', currentOrganization.id)
        .select('id, organization_id, department_id, name, description, is_active, created_by, created_at, updated_at, archived_at')
        .maybeSingle()

      if (error) throw error
      if (!data) throw new Error('Job was not updated.')

      setJobs((current) => current.map((job) => (job.id === jobId ? (data as JobRow) : job)).sort((left, right) => left.name.localeCompare(right.name)))
      setEditingJobId(null)
      setEditingJobName('')
      setEditingJobDepartmentId('')
      setEditJobModalOpen(false)
      notify.success('Job updated')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update job.'
      notify.error('Unable to update job', { description: message })
    } finally {
      setJobSavingId(null)
    }
  }

  const handleDeleteJob = async (jobId: string) => {
    setJobSavingId(jobId)
    try {
      const { error } = await supabase.from('jobs').delete().eq('id', jobId).eq('organization_id', currentOrganization.id)
      if (error) throw error

      setJobs((current) => current.filter((job) => job.id !== jobId))
      if (editingJobId === jobId) {
        setEditingJobId(null)
        setEditingJobName('')
        setEditingJobDepartmentId('')
      }
      notify.success('Job deleted')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to delete job.'
      notify.error('Unable to delete job', { description: message })
    } finally {
      setJobSavingId(null)
    }
  }

  if (loadingWorkspace) {
    return <WorkspacePageSkeleton />
  }

  const setSection = (section: WorkspaceSectionKey) => {
    const next = new URLSearchParams(searchParams)
    next.set('section', section)
    setSearchParams(next, { replace: true })
  }

  const selectedSectionMeta =
    WORKSPACE_SECTION_GROUPS.flatMap((group) => group.items).find((item) => item.key === activeSection) ??
    WORKSPACE_SECTION_GROUPS[0].items[0]

  return (
    <div className='grid min-h-[calc(100vh-8rem)] gap-4 lg:grid-cols-[252px_minmax(0,1fr)]'>
      <aside className='h-full w-full lg:sticky lg:top-4 lg:self-start'>
        <div className='flex h-full w-full flex-col overflow-hidden rounded-xl border border-border/80 bg-card text-card-foreground shadow-sm lg:h-[calc(100vh-8rem)]'>
          <div className='border-b border-border/70 px-3 py-3'>
            <div className='flex items-center gap-2 rounded-lg px-2 py-1.5'>
              <span className='flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-muted/30'>
                <Building2 className='h-4 w-4 text-muted-foreground' />
              </span>
              <div className='min-w-0'>
                <p className='truncate text-sm font-semibold text-foreground'>{currentOrganization.name}</p>
                <p className='truncate text-xs text-muted-foreground'>Organization settings</p>
              </div>
            </div>
          </div>
          <div className='min-h-0 flex-1 space-y-2 overflow-y-auto px-2 py-3'>
            {WORKSPACE_SECTION_GROUPS.map((group) => {
              const hasActive = group.items.some((item) => item.key === activeSection)
              const isExpanded = groupExpansionOverrides[group.title] ?? (hasActive || group.title === 'Organization')
              const GroupIcon = group.icon
              return (
                <div key={group.title} className='space-y-1'>
                  <button
                    type='button'
                    onClick={() =>
                      setGroupExpansionOverrides((current) => ({
                        ...current,
                        [group.title]: !isExpanded,
                      }))
                    }
                    className={`flex h-8 w-full items-center justify-between rounded-md px-2 text-left transition-colors ${
                      hasActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                    }`}
                  >
                    <span className='flex min-w-0 items-center gap-2'>
                      <GroupIcon className={`h-3.5 w-3.5 shrink-0 ${hasActive ? 'text-primary' : 'text-muted-foreground'}`} />
                      <span className={`truncate text-[11px] font-semibold uppercase tracking-[0.14em] ${hasActive ? 'text-primary' : 'text-muted-foreground'}`}>
                        {group.title}
                      </span>
                    </span>
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${hasActive ? 'text-primary' : 'text-muted-foreground'} ${isExpanded ? 'rotate-180' : ''}`} />
                  </button>
                  {isExpanded ? (
                    <div className='ml-4 space-y-1 border-l border-border/60 pl-2'>
                      {group.items.map((item) => {
                        const Icon = item.icon
                        const isActive = activeSection === item.key
                        const isComingSoon = item.comingSoon ?? !V1_LIVE_SECTIONS.has(item.key)
                        return (
                          <button
                            key={item.key}
                            type='button'
                            onClick={() => setSection(item.key)}
                            className={`group/menu flex h-9 w-full items-center justify-between rounded-md px-2.5 text-left text-sm transition-colors ${
                              isActive
                                ? 'bg-primary/10 text-primary shadow-[inset_3px_0_0_hsl(var(--primary))]'
                                : 'text-muted-foreground hover:bg-muted/45 hover:text-foreground'
                            }`}
                          >
                            <span className='flex min-w-0 items-center gap-2.5'>
                              <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground group-hover/menu:text-foreground'}`} />
                              <span className='truncate text-sm'>{item.label}</span>
                            </span>
                            {isComingSoon ? (
                              <Badge variant='outline' className='h-5 rounded-md px-1.5 text-[9px] uppercase tracking-wide text-muted-foreground'>
                                Soon
                              </Badge>
                            ) : null}
                          </button>
                        )
                      })}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      </aside>

      <div className='space-y-4'>
        <Card>
          <CardContent className='flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5'>
            <div>
              <p className='text-sm font-semibold text-foreground'>{selectedSectionMeta.label}</p>
              <p className='text-xs text-muted-foreground'>{selectedSectionMeta.description}</p>
            </div>
            {activeSection === 'overview' ? (
              <div className='flex gap-2'>
                <Button size='sm' variant='outline' className='gap-1.5' onClick={openInvitePeopleDialog} disabled={!canInviteUsers}>
                  <UserPlus className='h-4 w-4' />
                  Invite user
                </Button>
                <Button size='sm' className='gap-1.5' onClick={() => setSection('departments')}>
                  <Building2 className='h-4 w-4' />
                  Create department
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {activeSection === 'overview' ? (
          <>
            <section className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
              <Card><CardContent className='p-4'><p className='text-xs text-muted-foreground'>Users</p><p className='text-2xl font-semibold'>{activeCollaborators}</p></CardContent></Card>
              <Card><CardContent className='p-4'><p className='text-xs text-muted-foreground'>Departments</p><p className='text-2xl font-semibold'>{activeDepartmentRows.length}</p></CardContent></Card>
              <Card><CardContent className='p-4'><p className='text-xs text-muted-foreground'>Active Modules</p><p className='text-2xl font-semibold'>8</p></CardContent></Card>
              <Card><CardContent className='p-4'><p className='text-xs text-muted-foreground'>Online Now</p><p className='text-2xl font-semibold'>{onlineCollaborators}</p></CardContent></Card>
            </section>
            <section className='grid gap-4 xl:grid-cols-[1.35fr_1fr]'>
              <Card>
                <CardHeader className='pb-3'><CardTitle>Team Members</CardTitle></CardHeader>
                <CardContent className='space-y-2'>
                  {members.length === 0 ? <p className='rounded-md border bg-muted/10 px-3 py-4 text-sm text-muted-foreground'>No team profiles found yet.</p> : members.slice(0, 8).map((member) => {
                    const displayName = member.full_name ?? member.email ?? 'Unnamed user'
                    const online = isMemberOnline(member, presenceSessions, clockMs)
                    return (
                      <button key={member.id} type='button' onClick={() => setSelectedMemberId(member.id)} className='flex w-full items-center justify-between rounded-md border bg-muted/10 px-3 py-2.5 text-left transition-colors hover:border-primary/30 hover:bg-muted/20'>
                        <div className='flex items-center gap-3'>
                          <div className='relative'>
                            <Avatar className='h-9 w-9 border'>
                              {member.avatar_url ? <AvatarImage src={member.avatar_url} alt={displayName} /> : null}
                              <AvatarFallback className='text-xs font-semibold'>{initials(displayName)}</AvatarFallback>
                            </Avatar>
                            <span className={online ? 'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-background bg-emerald-400' : 'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-background bg-rose-400'} />
                          </div>
                          <div>
                            <p className='text-sm font-medium text-foreground'>{displayName}</p>
                            <p className='text-xs text-muted-foreground'>{member.department ?? 'No department'}</p>
                          </div>
                        </div>
                        <ChevronRight className='h-4 w-4 text-muted-foreground' />
                      </button>
                    )
                  })}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className='pb-3'><CardTitle>Upcoming Timeline</CardTitle></CardHeader>
                <CardContent className='space-y-2'>
                  {timelineEvents.length === 0 ? <p className='rounded-md border bg-muted/10 px-3 py-4 text-sm text-muted-foreground'>No upcoming events.</p> : timelineEvents.map((event) => (
                    <article key={event.id} className='flex items-center justify-between rounded-md border bg-muted/10 px-3 py-2.5'>
                      <div>
                        <p className='text-sm font-medium text-foreground'>{event.title}</p>
                        <p className='text-xs text-muted-foreground'>{event.event_type}</p>
                      </div>
                      <span className='inline-flex items-center gap-1.5 text-xs text-muted-foreground'><CalendarDays className='h-3.5 w-3.5' />{formatTimelineTime(event.starts_at)}</span>
                    </article>
                  ))}
                </CardContent>
              </Card>
            </section>
          </>
        ) : null}

        {activeSection === 'organization-settings' ? (
          <Card>
            <CardHeader><CardTitle>Organization Settings</CardTitle></CardHeader>
            <CardContent className='grid gap-4 md:grid-cols-2'>
              <div className='rounded-md border bg-muted/10 p-3'><p className='text-xs text-muted-foreground'>Organization Name</p><p className='mt-1 text-sm font-medium'>{currentOrganization.name}</p></div>
              <div className='rounded-md border bg-muted/10 p-3'><p className='text-xs text-muted-foreground'>Plan</p><p className='mt-1 text-sm font-medium'>{currentOrganization.plan}</p></div>
              <div className='rounded-md border bg-muted/10 p-3'><p className='text-xs text-muted-foreground'>Industry</p><p className='mt-1 text-sm font-medium'>{currentOrganization.industry || 'Not set'}</p></div>
              <div className='rounded-md border bg-muted/10 p-3'><p className='text-xs text-muted-foreground'>Location</p><p className='mt-1 text-sm font-medium'>{currentOrganization.location || 'Not set'}</p></div>
            </CardContent>
          </Card>
        ) : null}

        {activeSection === 'departments' ? (
          <Card>
            <CardHeader>
              <div className='flex items-center justify-between gap-2'>
                <CardTitle>Departments</CardTitle>
                <Button
                  size='sm'
                  onClick={() => setCreateDepartmentModalOpen(true)}
                  disabled={!canManageDepartments}
                  className='gap-1.5'
                >
                  Add department
                  <CirclePlus className='h-4 w-4' />
                </Button>
              </div>
            </CardHeader>
            <CardContent className='space-y-4'>
              {!canManageDepartments ? (
                <p className='text-xs text-muted-foreground'>Only organization admins/owners can manage departments.</p>
              ) : null}

              {activeDepartmentRows.length === 0 ? (
                <p className='rounded-md border bg-muted/10 px-3 py-4 text-sm text-muted-foreground'>No departments yet.</p>
              ) : (
                <div className='overflow-x-auto rounded-md border'>
                  <table className='w-full min-w-[560px] text-sm'>
                    <thead className='bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground'>
                      <tr>
                        <th className='px-3 py-2'>Department</th>
                        <th className='px-3 py-2'>Active Users</th>
                        <th className='px-3 py-2'>Total Users</th>
                        <th className='px-3 py-2 text-right'>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeDepartmentRows.map((department) => {
                        const usage = departmentMap.find((item) => item.name.toLowerCase() === department.name.toLowerCase())
                        return (
                          <tr key={department.id} className='border-t border-border/70'>
                            <td className='px-3 py-2.5 font-medium'>{department.name}</td>
                            <td className='px-3 py-2.5 text-muted-foreground'>{usage?.active ?? 0}</td>
                            <td className='px-3 py-2.5 text-muted-foreground'>{usage?.count ?? 0}</td>
                            <td className='px-3 py-2.5'>
                              {canManageDepartments ? (
                                <div className='flex justify-end gap-2'>
                                  <Button
                                    size='sm'
                                    variant='outline'
                                    onClick={() => {
                                      setEditingDepartmentId(department.id)
                                      setEditingDepartmentName(department.name)
                                      setEditDepartmentModalOpen(true)
                                    }}
                                    disabled={departmentSavingId === department.id}
                                    className='h-9 w-9 p-0'
                                    aria-label={`Rename ${department.name}`}
                                    title='Rename department'
                                  >
                                    <Pencil className='h-4 w-4' />
                                  </Button>
                                  <Button
                                    size='sm'
                                    variant='destructive'
                                    onClick={() => void handleDeleteDepartment(department.id)}
                                    disabled={departmentSavingId === department.id}
                                    className='h-9 w-9 p-0'
                                    aria-label={`Delete ${department.name}`}
                                    title='Delete department'
                                  >
                                    <Trash2 className='h-4 w-4' />
                                  </Button>
                                </div>
                              ) : null}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}

        {activeSection === 'jobs' ? (
          <Card>
            <CardHeader>
              <div className='flex items-center justify-between gap-2'>
                <CardTitle>Jobs / Positions</CardTitle>
                <Button
                  size='sm'
                  onClick={() => setCreateJobModalOpen(true)}
                  disabled={!canManageDepartments || activeDepartmentRows.length === 0}
                  className='gap-1.5'
                >
                  Add job
                  <CirclePlus className='h-4 w-4' />
                </Button>
              </div>
            </CardHeader>
            <CardContent className='space-y-4'>
              {activeJobRows.length === 0 ? (
                <p className='rounded-md border bg-muted/10 px-3 py-4 text-sm text-muted-foreground'>No job positions yet.</p>
              ) : (
                <div className='overflow-x-auto rounded-md border'>
                  <table className='w-full min-w-[680px] text-sm'>
                    <thead className='bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground'>
                      <tr>
                        <th className='px-3 py-2'>Job</th>
                        <th className='px-3 py-2'>Department</th>
                        <th className='px-3 py-2'>Members</th>
                        <th className='px-3 py-2 text-right'>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeJobRows.map((job) => {
                        const department = activeDepartmentRows.find((item) => item.id === job.department_id)
                        const linkedMembers = jobsMap.get(job.name)?.length ?? 0
                        return (
                          <tr key={job.id} className='border-t border-border/70'>
                            <td className='px-3 py-2.5 font-medium'>{job.name}</td>
                            <td className='px-3 py-2.5 text-muted-foreground'>{department?.name ?? 'No department'}</td>
                            <td className='px-3 py-2.5 text-muted-foreground'>{linkedMembers}</td>
                            <td className='px-3 py-2.5'>
                              {canManageDepartments ? (
                                <div className='flex justify-end gap-2'>
                                  <Button
                                    size='sm'
                                    variant='outline'
                                    className='h-9 w-9 p-0'
                                    aria-label={`Edit ${job.name}`}
                                    title='Edit job'
                                    onClick={() => {
                                      setEditingJobId(job.id)
                                      setEditingJobName(job.name)
                                      setEditingJobDepartmentId(job.department_id)
                                      setEditJobModalOpen(true)
                                    }}
                                    disabled={jobSavingId === job.id}
                                  >
                                    <Pencil className='h-4 w-4' />
                                  </Button>
                                  <Button
                                    size='sm'
                                    variant='destructive'
                                    className='h-9 w-9 p-0'
                                    aria-label={`Delete ${job.name}`}
                                    title='Delete job'
                                    onClick={() => void handleDeleteJob(job.id)}
                                    disabled={jobSavingId === job.id}
                                  >
                                    <Trash2 className='h-4 w-4' />
                                  </Button>
                                </div>
                              ) : null}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}

        {activeSection === 'roles-permissions' ? (
          <Card>
            <CardHeader><CardTitle>Roles & Permissions</CardTitle></CardHeader>
            <CardContent className='space-y-3'>
              {roleMap.map((role) => (
                <div key={role.role} className='rounded-md border bg-muted/10 p-3'>
                  <div className='flex items-center justify-between'>
                    <p className='text-sm font-medium capitalize'>{role.role}</p>
                    <Badge variant='outline'>{role.count} users</Badge>
                  </div>
                  <p className='mt-1 text-xs text-muted-foreground'>Permissions matrix configuration will be expanded in next steps.</p>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        {activeSection === 'invitations' ? (
          <Card>
            <CardHeader>
              <div className='flex flex-wrap items-center justify-between gap-3'>
                <div>
                  <CardTitle>Invitations & User Access</CardTitle>
                  <p className='mt-1 text-xs text-muted-foreground'>Track invite lifecycle and add new organization users.</p>
                </div>
                <Button size='sm' className='gap-1.5' onClick={openInvitePeopleDialog} disabled={!canInviteUsers}>
                  <UserPlus className='h-4 w-4' />
                  Invite user
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {invitations.length === 0 ? (
                <p className='rounded-md border bg-muted/10 px-3 py-4 text-sm text-muted-foreground'>No invitations yet.</p>
              ) : (
                <div className='overflow-x-auto rounded-md border'>
                  <table className='w-full min-w-[760px] text-sm'>
                    <thead className='bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground'>
                      <tr>
                        <th className='px-3 py-2'>Email</th>
                        <th className='px-3 py-2'>Role</th>
                        <th className='px-3 py-2'>Status</th>
                        <th className='px-3 py-2'>Sent</th>
                        <th className='px-3 py-2'>Expires</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invitations.map((invite) => (
                        <tr key={invite.id} className='border-t border-border/70'>
                          <td className='px-3 py-2.5 font-medium text-foreground'>{invite.email}</td>
                          <td className='px-3 py-2.5 capitalize text-muted-foreground'>{invite.role}</td>
                          <td className='px-3 py-2.5'>
                            <Badge variant='outline' className={invitationStatusClass(invite.status)}>
                              {invite.status}
                            </Badge>
                          </td>
                          <td className='px-3 py-2.5 text-muted-foreground'>{formatInvitationDate(invite.created_at)}</td>
                          <td className='px-3 py-2.5 text-muted-foreground'>{formatInvitationDate(invite.expires_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}

        {activeSection === 'audit-logs' ? (
          <Card>
            <CardHeader><CardTitle>Audit Logs</CardTitle></CardHeader>
            <CardContent className='space-y-2'>
              {timelineEvents.length === 0 ? <p className='rounded-md border bg-muted/10 px-3 py-4 text-sm text-muted-foreground'>No audit events in the current window.</p> : timelineEvents.map((event) => (
                <div key={event.id} className='rounded-md border bg-muted/10 px-3 py-2.5'>
                  <p className='text-sm font-medium'>{event.title}</p>
                  <p className='text-xs text-muted-foreground'>{event.event_type} • {formatTimelineTime(event.starts_at)}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        {activeSection === 'notification-settings' ? (
          <Card>
            <CardHeader><CardTitle>Notification Settings</CardTitle></CardHeader>
            <CardContent className='grid gap-3 md:grid-cols-2'>
              <div className='rounded-md border bg-muted/10 p-3'><p className='text-sm font-medium'>Organization Alerts</p><p className='text-xs text-muted-foreground mt-1'>Control defaults for task, mention, and update notifications.</p></div>
              <div className='rounded-md border bg-muted/10 p-3'><p className='text-sm font-medium'>Delivery Channels</p><p className='text-xs text-muted-foreground mt-1'>Email, in-app, and escalation preferences will be managed here.</p></div>
            </CardContent>
          </Card>
        ) : null}

        {!V1_LIVE_SECTIONS.has(activeSection) ? (
          <Card>
            <CardHeader><CardTitle>{selectedSectionMeta.label}</CardTitle></CardHeader>
            <CardContent>
              <div className='rounded-md border border-dashed bg-muted/10 p-4'>
                <p className='text-sm font-medium'>Coming soon</p>
                <p className='mt-1 text-xs text-muted-foreground'>This section is part of the organization architecture and will be implemented in the next steps.</p>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <MemberDetailsDialog
        member={selectedMember}
        isAdmin={isAdmin}
        isOnline={selectedMember ? isMemberOnline(selectedMember, presenceSessions, clockMs) : false}
        isAvailable={selectedMember ? isMemberAvailable(selectedMember) : false}
        availabilityBlocks={selectedMember ? normalizeAvailabilitySchedule(selectedMember.availability_schedule) : []}
        open={Boolean(selectedMember)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setSelectedMemberId(null)
        }}
        onSave={handleSaveMember}
        onChangeAccountStatus={handleChangeMemberAccountStatus}
        departmentOptions={departmentOptions}
        jobsByDepartment={jobsByDepartment}
        onRequestCreateDepartment={() => setCreateDepartmentModalOpen(true)}
        onRequestCreateJob={(departmentName) => {
          if (departmentName) {
            const match = activeDepartmentRows.find((department) => department.name === departmentName)
            setNewJobDepartmentId(match?.id ?? '')
          } else {
            setNewJobDepartmentId('')
          }
          setCreateJobModalOpen(true)
        }}
      />

      <Dialog open={createDepartmentModalOpen} onOpenChange={setCreateDepartmentModalOpen}>
        <DialogContent className='max-w-md'>
          <DialogHeader>
            <DialogTitle>Create department</DialogTitle>
            <DialogDescription>Add a department for this organization.</DialogDescription>
          </DialogHeader>
          <div className='space-y-2 pb-5'>
            <label className='text-sm font-medium'>Department name</label>
            <Input
              value={newDepartmentName}
              onChange={(event) => setNewDepartmentName(event.target.value)}
              placeholder='e.g. Finance'
              disabled={creatingDepartment}
            />
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setCreateDepartmentModalOpen(false)} disabled={creatingDepartment}>Cancel</Button>
            <Button onClick={() => void handleCreateDepartment()} disabled={creatingDepartment || !newDepartmentName.trim()}>
              {creatingDepartment ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editDepartmentModalOpen} onOpenChange={setEditDepartmentModalOpen}>
        <DialogContent className='max-w-md'>
          <DialogHeader>
            <DialogTitle>Rename department</DialogTitle>
            <DialogDescription>Update the department name.</DialogDescription>
          </DialogHeader>
          <div className='space-y-2 pb-5'>
            <label className='text-sm font-medium'>Department name</label>
            <Input
              value={editingDepartmentName}
              onChange={(event) => setEditingDepartmentName(event.target.value)}
              disabled={Boolean(departmentSavingId)}
            />
          </div>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => {
                setEditDepartmentModalOpen(false)
                setEditingDepartmentId(null)
                setEditingDepartmentName('')
              }}
              disabled={Boolean(departmentSavingId)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => editingDepartmentId && void handleRenameDepartment(editingDepartmentId)}
              disabled={Boolean(departmentSavingId) || !editingDepartmentId || !editingDepartmentName.trim()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createJobModalOpen} onOpenChange={setCreateJobModalOpen}>
        <DialogContent className='max-w-md'>
          <DialogHeader>
            <DialogTitle>Create job</DialogTitle>
            <DialogDescription>Add a job linked to a department.</DialogDescription>
          </DialogHeader>
          <div className='space-y-3 pb-5'>
            <div className='space-y-2'>
              <label className='text-sm font-medium'>Department</label>
              <DepartmentSelectPopover
                value={newJobDepartmentId}
                disabled={creatingJob}
                departments={activeDepartmentRows}
                onChange={setNewJobDepartmentId}
                onAddDepartment={() => setCreateDepartmentModalOpen(true)}
              />
            </div>
            <div className='space-y-2'>
              <label className='text-sm font-medium'>Job name</label>
              <Input value={newJobName} onChange={(event) => setNewJobName(event.target.value)} disabled={creatingJob} />
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setCreateJobModalOpen(false)} disabled={creatingJob}>Cancel</Button>
            <Button onClick={() => void handleCreateJob()} disabled={creatingJob || !newJobName.trim() || !newJobDepartmentId}>
              {creatingJob ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editJobModalOpen} onOpenChange={setEditJobModalOpen}>
        <DialogContent className='max-w-md'>
          <DialogHeader>
            <DialogTitle>Edit job</DialogTitle>
            <DialogDescription>Update job name and department.</DialogDescription>
          </DialogHeader>
          <div className='space-y-3 pb-5'>
            <div className='space-y-2'>
              <label className='text-sm font-medium'>Department</label>
              <DepartmentSelectPopover
                value={editingJobDepartmentId}
                disabled={Boolean(jobSavingId)}
                departments={activeDepartmentRows}
                onChange={setEditingJobDepartmentId}
                onAddDepartment={() => setCreateDepartmentModalOpen(true)}
              />
            </div>
            <div className='space-y-2'>
              <label className='text-sm font-medium'>Job name</label>
              <Input value={editingJobName} onChange={(event) => setEditingJobName(event.target.value)} disabled={Boolean(jobSavingId)} />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => {
                setEditJobModalOpen(false)
                setEditingJobId(null)
                setEditingJobName('')
                setEditingJobDepartmentId('')
              }}
              disabled={Boolean(jobSavingId)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => editingJobId && void handleUpdateJob(editingJobId)}
              disabled={Boolean(jobSavingId) || !editingJobId || !editingJobName.trim() || !editingJobDepartmentId}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
