import { CalendarDays, ChevronRight, FileText, Mail, Trash2, UserX, Users2, Workflow } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/features/auth/context/auth-context'
import { notify } from '@/lib/notify'
import { supabase } from '@/lib/supabase'
import { useSearchParams } from 'react-router-dom'

const WORKSPACE_MEMBERS_CACHE_KEY = 'contas.workspace.members.v1'
const WORKSPACE_PRESENCE_CACHE_KEY = 'contas.workspace.presence.v1'
const WORKSPACE_TIMELINE_CACHE_KEY = 'contas.workspace.timeline.v1'
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

const WEEKDAY_LABELS: Record<WeekdayKey, string> = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
  sunday: 'Sun',
}

const MEMBER_JOB_TITLES = [
  'Managing Director',
  'HR & Compliance Manager',
  'Accounting Manager',
  'Senior Accountant',
  'Junior Accountant',
  'Payroll and Regulatory Support Officer',
  'Junior Business Executive Officer',
] as const

const MEMBER_DEPARTMENTS = [
  'Executive Leadership',
  'Accounting & Financial Services',
  'Payroll & Regulatory Services',
  'Human Resources & Compliance',
  'Business Development & Client Services',
] as const

const MEMBER_ROLE_LABELS = [
  { value: 'member', label: 'Member' },
  { value: 'viewer', label: 'Viewer' },
  { value: 'admin', label: 'Admin' },
  { value: 'owner', label: 'Owner' },
] as const

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
                    <select
                      value={draft.department}
                      onChange={(event) => setDraft((current) => ({ ...current, department: event.target.value }))}
                      className='h-10 w-full rounded-md border border-input bg-background px-3 text-sm'
                    >
                      <option value=''>Select department</option>
                      {MEMBER_DEPARTMENTS.map((department) => (
                        <option key={department} value={department}>
                          {department}
                        </option>
                      ))}
                      {draft.department.trim() && !MEMBER_DEPARTMENTS.includes(draft.department as (typeof MEMBER_DEPARTMENTS)[number]) ? (
                        <option value={draft.department}>{draft.department}</option>
                      ) : null}
                    </select>
                  </div>
                  <div className='space-y-2'>
                    <label className='text-sm font-medium text-foreground'>Job title</label>
                    <select
                      value={draft.jobTitle}
                      onChange={(event) => setDraft((current) => ({ ...current, jobTitle: event.target.value }))}
                      className='h-10 w-full rounded-md border border-input bg-background px-3 text-sm'
                    >
                      <option value=''>Select job title</option>
                      {MEMBER_JOB_TITLES.map((title) => (
                        <option key={title} value={title}>
                          {title}
                        </option>
                      ))}
                      {draft.jobTitle.trim() && !MEMBER_JOB_TITLES.includes(draft.jobTitle as (typeof MEMBER_JOB_TITLES)[number]) ? (
                        <option value={draft.jobTitle}>{draft.jobTitle}</option>
                      ) : null}
                    </select>
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
  const [initialWorkspaceCache] = useState(() => readWorkspaceCacheSnapshot())
  const { currentUser, updateCurrentUser, logout } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [members, setMembers] = useState<TeamMember[]>(() => initialWorkspaceCache.members)
  const [presenceSessions, setPresenceSessions] = useState<PresenceSession[]>(() => initialWorkspaceCache.presenceSessions)
  const [timelineEvents, setTimelineEvents] = useState<OrganizationTimelineEvent[]>(() => initialWorkspaceCache.timelineEvents)
  const [clockMs, setClockMs] = useState(() => Date.now())
  const [loadingWorkspace, setLoadingWorkspace] = useState(() => !initialWorkspaceCache.hasCache)
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null)

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

    const loadMembersAndPresence = async () => {
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
      if (!cancelled) {
        setLoadingWorkspace(false)
      }
    }

    void loadMembersAndPresence()

    const channel = supabase
      .channel('workspace-profiles-presence')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
        if (refreshTimer !== null) {
          window.clearTimeout(refreshTimer)
        }
        refreshTimer = window.setTimeout(() => {
          void loadMembersAndPresence()
          refreshTimer = null
        }, 200)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_presence_sessions' }, () => {
        if (refreshTimer !== null) {
          window.clearTimeout(refreshTimer)
        }
        refreshTimer = window.setTimeout(() => {
          void loadMembersAndPresence()
          refreshTimer = null
        }, 200)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'organization_timeline_events' }, () => {
        if (refreshTimer !== null) {
          window.clearTimeout(refreshTimer)
        }
        refreshTimer = window.setTimeout(() => {
          void loadMembersAndPresence()
          refreshTimer = null
        }, 200)
      })
      .subscribe()

    pollTimer = window.setInterval(() => {
      void loadMembersAndPresence()
    }, 45000)

    return () => {
      cancelled = true
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer)
      }
      if (pollTimer !== null) {
        window.clearInterval(pollTimer)
      }
      void supabase.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClockMs(Date.now())
    }, 15000)

    return () => {
      window.clearInterval(timer)
    }
  }, [])

  const activeCollaborators = members.filter((member) => member.account_status === 'active').length
  const onlineCollaborators = useMemo(
    () => members.filter((member) => isMemberOnline(member, presenceSessions, clockMs)).length,
    [clockMs, members, presenceSessions],
  )
  const isAdmin = (currentUser?.roleLabel ?? '').toLowerCase() === 'admin'
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

  if (loadingWorkspace) {
    return <WorkspacePageSkeleton />
  }

  return (
    <div className='space-y-4'>
      <Card>
        <CardContent className='flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5'>
          <div>
            <p className='text-sm font-semibold text-foreground'>Organization Hub</p>
            <p className='text-xs text-muted-foreground'>Shared context, team visibility, and operating signals.</p>
          </div>
          <Button size='sm' className='gap-1.5'>
            <Workflow className='h-4 w-4' />
            Manage organization
          </Button>
        </CardContent>
      </Card>

      <section className='grid gap-4 xl:grid-cols-[1.35fr_1fr]'>
        <Card>
          <CardHeader className='pb-3'>
            <CardTitle>Team Members</CardTitle>
          </CardHeader>
          <CardContent className='space-y-2'>
            {members.length === 0 ? (
              <p className='rounded-md border bg-muted/10 px-3 py-4 text-sm text-muted-foreground'>
                No team profiles found yet.
              </p>
            ) : (
              members.map((member) => {
                const displayName = member.full_name ?? member.email ?? 'Unnamed user'
                const online = isMemberOnline(member, presenceSessions, clockMs)
                const available = isMemberAvailable(member)
                return (
                  <button
                    key={member.id}
                    type='button'
                    onClick={() => setSelectedMemberId(member.id)}
                    className='flex w-full items-center justify-between rounded-md border bg-muted/10 px-3 py-2.5 text-left transition-colors hover:border-primary/30 hover:bg-muted/20'
                  >
                    <div className='flex items-center gap-3'>
                      <div className='relative'>
                        <Avatar className='h-9 w-9 border'>
                          {member.avatar_url ? <AvatarImage src={member.avatar_url} alt={displayName} /> : null}
                          <AvatarFallback className='text-xs font-semibold'>{initials(displayName)}</AvatarFallback>
                        </Avatar>
                        <span
                          className={
                            online
                              ? 'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-background bg-emerald-400'
                              : 'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-background bg-rose-400'
                          }
                          aria-label={online ? 'Online' : 'Offline'}
                          title={online ? 'Online' : 'Offline'}
                        />
                      </div>
                      <div>
                        <p className='text-sm font-medium text-foreground'>{displayName}</p>
                        <p className='text-xs text-muted-foreground'>{memberRole(member)}</p>
                        <p className='text-[11px] text-muted-foreground/80'>{member.department ?? 'No department'}</p>
                        {member.account_status !== 'active' ? (
                          <Badge variant='outline' className={`mt-2 ${memberStatusBadgeClass(member.account_status)} text-[10px] uppercase tracking-wide`}>
                            {memberStatusLabel(member.account_status)}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    <div className='flex items-center gap-3'>
                      <Badge
                        variant='outline'
                        className={
                          available
                            ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                            : 'border-rose-500/40 bg-rose-500/15 text-rose-300'
                        }
                      >
                        {available ? 'Available' : 'Unavailable'}
                      </Badge>
                      <ChevronRight className='h-4 w-4 text-muted-foreground' />
                    </div>
                  </button>
                )
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='pb-3'>
            <CardTitle>Organization Signals</CardTitle>
          </CardHeader>
          <CardContent className='space-y-3'>
            <div className='rounded-md border bg-muted/10 p-3'>
              <p className='inline-flex items-center gap-2 text-sm font-medium'>
                <Users2 className='h-4 w-4 text-blue-400' />
                {activeCollaborators} active collaborators
              </p>
              <p className='mt-1 text-xs text-muted-foreground'>{onlineCollaborators} currently online.</p>
            </div>
            <div className='rounded-md border bg-muted/10 p-3'>
              <p className='inline-flex items-center gap-2 text-sm font-medium'>
                <FileText className='h-4 w-4 text-emerald-400' />
                6 shared docs updated
              </p>
              <p className='mt-1 text-xs text-muted-foreground'>Knowledge base and project docs changed today.</p>
            </div>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader className='pb-3'>
          <CardTitle>Upcoming Organization Timeline</CardTitle>
        </CardHeader>
        <CardContent className='space-y-2'>
          {timelineEvents.length === 0 ? (
            <p className='rounded-md border bg-muted/10 px-3 py-4 text-sm text-muted-foreground'>No upcoming events.</p>
          ) : (
            timelineEvents.map((event) => (
              <article key={event.id} className='flex items-center justify-between rounded-md border bg-muted/10 px-3 py-2.5'>
                <div>
                  <p className='text-sm font-medium text-foreground'>{event.title}</p>
                  <p className='text-xs text-muted-foreground'>{event.event_type}</p>
                </div>
                <span className='inline-flex items-center gap-1.5 text-xs text-muted-foreground'>
                  <CalendarDays className='h-3.5 w-3.5' />
                  {formatTimelineTime(event.starts_at)}
                </span>
              </article>
            ))
          )}
        </CardContent>
      </Card>

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
      />
    </div>
  )
}
