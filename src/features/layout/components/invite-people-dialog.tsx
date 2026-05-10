import { ChevronDown, CirclePlus, Info, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useAuth } from '@/features/auth/context/auth-context'
import { useOrganization } from '@/features/organization/context/organization-context'
import {
  checkInviteEmailAvailability,
  inviteOrganizationMember,
  isValidEmail,
  type InvitationRole,
} from '@/features/organization/lib/invitations'
import { normalizeProjectColor, projectDotStyle } from '@/features/projects/lib/project-colors'
import { notify } from '@/lib/notify'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

type ProjectOption = {
  id: string
  name: string
  color: string | null
}

type DepartmentOption = {
  id: string
  name: string
}

type JobOption = {
  id: string
  department_id: string
  name: string
}

type InviteDraft = {
  id: string
  email: string
  fullName: string
  role: InvitationRole
  departmentId: string
  jobId: string
  projectIds: string[]
}

type EmailAvailabilityState = {
  email: string
  status: 'checking' | 'available' | 'unavailable' | 'error'
  message: string
}

function createLocalId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `invite-${Math.random().toString(36).slice(2, 10)}`
}

function createInviteDraft(): InviteDraft {
  return {
    id: createLocalId(),
    email: '',
    fullName: '',
    role: 'member',
    departmentId: '',
    jobId: '',
    projectIds: [],
  }
}

function stopScrollPropagation(event: React.WheelEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) {
  event.stopPropagation()
}

function DepartmentPicker({
  value,
  departments,
  disabled,
  creating,
  onChange,
  onCreate,
}: {
  value: string
  departments: DepartmentOption[]
  disabled?: boolean
  creating: boolean
  onChange: (departmentId: string) => void
  onCreate: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const selectedDepartment = departments.find((department) => department.id === value) ?? null
  const filteredDepartments = departments.filter((department) => department.name.toLowerCase().includes(query.trim().toLowerCase()))

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type='button' variant='outline' className='h-10 w-full justify-between px-3 font-normal' disabled={disabled}>
          <span className={selectedDepartment ? 'text-foreground' : 'text-muted-foreground'}>
            {selectedDepartment?.name ?? 'Select department'}
          </span>
          <ChevronDown className='h-4 w-4 text-muted-foreground' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[var(--radix-popover-trigger-width)] p-2' align='start'>
        <div className='space-y-2'>
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder='Search departments' className='h-9' />
          <div
            className='max-h-44 overscroll-contain overflow-y-auto rounded-md border'
            onWheel={stopScrollPropagation}
            onTouchMove={stopScrollPropagation}
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
              onCreate(query.trim())
              setOpen(false)
              setQuery('')
            }}
            disabled={creating}
          >
            <CirclePlus className='h-4 w-4' />
            {creating ? 'Adding...' : 'Add department'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function JobPicker({
  value,
  departmentId,
  jobs,
  disabled,
  creating,
  onChange,
  onCreate,
}: {
  value: string
  departmentId: string
  jobs: JobOption[]
  disabled?: boolean
  creating: boolean
  onChange: (jobId: string) => void
  onCreate: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const departmentJobs = jobs.filter((job) => job.department_id === departmentId)
  const selectedJob = departmentJobs.find((job) => job.id === value) ?? null
  const filteredJobs = departmentJobs.filter((job) => job.name.toLowerCase().includes(query.trim().toLowerCase()))

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type='button' variant='outline' className='h-10 w-full justify-between px-3 font-normal' disabled={disabled || !departmentId}>
          <span className={selectedJob ? 'text-foreground' : 'text-muted-foreground'}>
            {selectedJob?.name ?? (departmentId ? 'Select job title' : 'Select department first')}
          </span>
          <ChevronDown className='h-4 w-4 text-muted-foreground' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[var(--radix-popover-trigger-width)] p-2' align='start'>
        <div className='space-y-2'>
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder='Search jobs' className='h-9' />
          <div
            className='max-h-44 overscroll-contain overflow-y-auto rounded-md border'
            onWheel={stopScrollPropagation}
            onTouchMove={stopScrollPropagation}
          >
            {filteredJobs.length === 0 ? (
              <p className='px-3 py-2 text-xs text-muted-foreground'>No jobs found for this department.</p>
            ) : (
              filteredJobs.map((job) => (
                <button
                  key={job.id}
                  type='button'
                  className='block w-full border-b border-border/60 px-3 py-2 text-left text-sm transition-colors last:border-b-0 hover:bg-muted/40'
                  onClick={() => {
                    onChange(job.id)
                    setOpen(false)
                    setQuery('')
                  }}
                >
                  {job.name}
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
              onCreate(query.trim())
              setOpen(false)
              setQuery('')
            }}
            disabled={!departmentId || creating}
          >
            <CirclePlus className='h-4 w-4' />
            {creating ? 'Adding...' : 'Add job'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function InvitePeopleDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { currentUser, session } = useAuth()
  const { currentOrganization } = useOrganization()
  const [drafts, setDrafts] = useState<InviteDraft[]>(() => [createInviteDraft()])
  const [expandedDraftId, setExpandedDraftId] = useState(() => drafts[0]?.id ?? '')
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [departments, setDepartments] = useState<DepartmentOption[]>([])
  const [jobs, setJobs] = useState<JobOption[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [creatingDepartment, setCreatingDepartment] = useState(false)
  const [creatingJob, setCreatingJob] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [emailAvailability, setEmailAvailability] = useState<Record<string, EmailAvailabilityState>>({})

  useEffect(() => {
    let cancelled = false

    const loadInviteOptions = async () => {
      const [projectsResult, departmentsResult, jobsResult] = await Promise.all([
        supabase
          .from('projects')
          .select('id, name, color')
          .eq('organization_id', currentOrganization.id)
          .order('name', { ascending: true }),
        supabase
          .from('departments')
          .select('id, name')
          .eq('organization_id', currentOrganization.id)
          .eq('is_active', true)
          .is('archived_at', null)
          .order('name', { ascending: true }),
        supabase
          .from('jobs')
          .select('id, department_id, name')
          .eq('organization_id', currentOrganization.id)
          .eq('is_active', true)
          .is('archived_at', null)
          .order('name', { ascending: true }),
      ])

      if (cancelled) return

      setProjects(
        (projectsResult.data ?? []).map((project) => ({
          id: project.id,
          name: project.name ?? 'Untitled project',
          color: normalizeProjectColor(project.color),
        })),
      )
      setDepartments((departmentsResult.data ?? []).map((department) => ({ id: department.id, name: department.name ?? 'Untitled department' })))
      setJobs((jobsResult.data ?? []).map((job) => ({ id: job.id, department_id: job.department_id, name: job.name ?? 'Untitled job' })))
    }

    void loadInviteOptions()

    return () => {
      cancelled = true
    }
  }, [currentOrganization.id])

  const isAdmin = (currentUser?.roleLabel ?? '').toLowerCase() === 'admin' || (currentUser?.roleLabel ?? '').toLowerCase() === 'owner'
  const duplicateDraftEmails = useMemo(() => {
    const counts = new Map<string, number>()
    drafts.forEach((draft) => {
      const email = draft.email.trim().toLowerCase()
      if (email) counts.set(email, (counts.get(email) ?? 0) + 1)
    })
    return new Set(Array.from(counts.entries()).filter(([, count]) => count > 1).map(([email]) => email))
  }, [drafts])

  const canSend = useMemo(() => {
    if (!isAdmin || submitting || drafts.length === 0) return false
    return drafts.every((draft) => {
      const email = draft.email.trim()
      const normalizedEmail = email.toLowerCase()
      const job = jobs.find((item) => item.id === draft.jobId && item.department_id === draft.departmentId)
      const department = departments.find((item) => item.id === draft.departmentId)
      const availability = emailAvailability[draft.id]
      return (
        isValidEmail(email) &&
        !duplicateDraftEmails.has(normalizedEmail) &&
        availability?.email === normalizedEmail &&
        availability.status === 'available' &&
        draft.fullName.trim().length > 0 &&
        Boolean(department) &&
        Boolean(job)
      )
    })
  }, [departments, drafts, duplicateDraftEmails, emailAvailability, isAdmin, jobs, submitting])

  useEffect(() => {
    if (!isAdmin || !open) {
      setEmailAvailability({})
      return
    }

    const validDraftEmails = drafts
      .map((draft) => ({
        draftId: draft.id,
        email: draft.email.trim().toLowerCase(),
      }))
      .filter((item) => item.email && isValidEmail(item.email) && !duplicateDraftEmails.has(item.email))

    const validDraftIds = new Set(validDraftEmails.map((item) => item.draftId))
    setEmailAvailability((current) => {
      const next: Record<string, EmailAvailabilityState> = {}
      let changed = false

      validDraftEmails.forEach(({ draftId, email }) => {
        const currentCheck = current[draftId]
        if (currentCheck?.email === email && currentCheck.status !== 'error') {
          next[draftId] = currentCheck
          return
        }

        next[draftId] = {
          email,
          status: 'checking',
          message: 'Checking email availability...',
        }
        changed = true
      })

      Object.keys(current).forEach((draftId) => {
        if (!validDraftIds.has(draftId)) changed = true
      })

      return changed ? next : current
    })

    if (validDraftEmails.length === 0) return

    const checkTimer = window.setTimeout(() => {
      validDraftEmails.forEach(({ draftId, email }) => {
        void checkInviteEmailAvailability(email, currentOrganization.id).then((result) => {
          setEmailAvailability((current) => {
            const currentCheck = current[draftId]
            if (!currentCheck || currentCheck.email !== email) return current

            return {
              ...current,
              [draftId]: {
                email,
                status: result.available ? 'available' : result.status === 'error' ? 'error' : 'unavailable',
                message: result.message,
              },
            }
          })
        })
      })
    }, 450)

    return () => window.clearTimeout(checkTimer)
  }, [currentOrganization.id, drafts, duplicateDraftEmails, isAdmin, open])

  const updateDraft = (draftId: string, updates: Partial<InviteDraft>) => {
    setDrafts((current) => current.map((draft) => (draft.id === draftId ? { ...draft, ...updates } : draft)))
  }

  const addDraft = () => {
    const nextDraft = createInviteDraft()
    setDrafts((current) => [...current, nextDraft])
    setExpandedDraftId(nextDraft.id)
  }

  const removeDraft = (draftId: string) => {
    if (drafts.length === 1) return
    const nextDrafts = drafts.filter((draft) => draft.id !== draftId)
    setDrafts(nextDrafts)
    if (expandedDraftId === draftId) {
      setExpandedDraftId(nextDrafts[0]?.id ?? '')
    }
  }

  const toggleProject = (draftId: string, projectId: string) => {
    setDrafts((current) =>
      current.map((draft) => {
        if (draft.id !== draftId) return draft
        const projectIds = draft.projectIds.includes(projectId)
          ? draft.projectIds.filter((id) => id !== projectId)
          : [...draft.projectIds, projectId]
        return { ...draft, projectIds }
      }),
    )
  }

  const reset = () => {
    const nextDraft = createInviteDraft()
    setDrafts([nextDraft])
    setExpandedDraftId(nextDraft.id)
    setSubmitting(false)
    setCreatingDepartment(false)
    setCreatingJob(false)
    setMessage(null)
    setEmailAvailability({})
  }

  const handleCreateDepartment = async (draftId: string, name: string) => {
    if (!name) {
      setMessage('Enter a department name first.')
      return
    }

    const existing = departments.find((department) => department.name.toLowerCase() === name.toLowerCase())
    if (existing) {
      updateDraft(draftId, { departmentId: existing.id, jobId: '' })
      return
    }

    setCreatingDepartment(true)
    setMessage(null)
    const { data, error } = await supabase
      .from('departments')
      .insert({
        organization_id: currentOrganization.id,
        name,
        created_by: currentUser?.id ?? null,
        is_active: true,
      })
      .select('id, name')
      .maybeSingle()

    setCreatingDepartment(false)
    if (error || !data) {
      setMessage(error?.message ?? 'Unable to create department.')
      return
    }

    const nextDepartment = { id: data.id, name: data.name ?? name }
    setDepartments((current) => [...current, nextDepartment].sort((left, right) => left.name.localeCompare(right.name)))
    updateDraft(draftId, { departmentId: nextDepartment.id, jobId: '' })
    window.dispatchEvent(new CustomEvent('cloudnine:realtime-change', { detail: { table: 'departments' } }))
  }

  const handleCreateJob = async (draftId: string, name: string) => {
    const draft = drafts.find((item) => item.id === draftId)
    if (!draft?.departmentId) {
      setMessage('Select a department before adding a job.')
      return
    }
    if (!name) {
      setMessage('Enter a job title first.')
      return
    }

    const departmentJobs = jobs.filter((job) => job.department_id === draft.departmentId)
    const existing = departmentJobs.find((job) => job.name.toLowerCase() === name.toLowerCase())
    if (existing) {
      updateDraft(draftId, { jobId: existing.id })
      return
    }

    setCreatingJob(true)
    setMessage(null)
    const { data, error } = await supabase
      .from('jobs')
      .insert({
        organization_id: currentOrganization.id,
        department_id: draft.departmentId,
        name,
        created_by: currentUser?.id ?? null,
        is_active: true,
      })
      .select('id, department_id, name')
      .maybeSingle()

    setCreatingJob(false)
    if (error || !data) {
      setMessage(error?.message ?? 'Unable to create job.')
      return
    }

    const nextJob = { id: data.id, department_id: data.department_id, name: data.name ?? name }
    setJobs((current) => [...current, nextJob].sort((left, right) => left.name.localeCompare(right.name)))
    updateDraft(draftId, { jobId: nextJob.id })
    window.dispatchEvent(new CustomEvent('cloudnine:realtime-change', { detail: { table: 'jobs' } }))
  }

  const handleSendInvites = async () => {
    if (!isAdmin) {
      setMessage('Only organization admins can invite teammates.')
      return
    }

    if (!currentOrganization.id) {
      setMessage('Select an organization before inviting teammates.')
      return
    }

    const invalidDraft = drafts.find((draft) => {
      const department = departments.find((item) => item.id === draft.departmentId)
      const job = jobs.find((item) => item.id === draft.jobId && item.department_id === draft.departmentId)
      return !isValidEmail(draft.email.trim()) || !draft.fullName.trim() || !department || !job
    })

    if (invalidDraft) {
      setMessage('Every invited user needs one valid email, full name, department, and job title.')
      return
    }

    const normalizedEmails = drafts.map((draft) => draft.email.trim().toLowerCase())
    const duplicateEmail = normalizedEmails.find((email, index) => normalizedEmails.indexOf(email) !== index)
    if (duplicateEmail) {
      setMessage(`${duplicateEmail} is entered more than once.`)
      return
    }

    setSubmitting(true)
    setMessage(null)

    const results = await Promise.all(
      drafts.map((draft) => {
        const department = departments.find((item) => item.id === draft.departmentId)
        const job = jobs.find((item) => item.id === draft.jobId && item.department_id === draft.departmentId)
        if (!department || !job) {
          return Promise.resolve({
            email: draft.email,
            ok: false,
            status: 'error' as const,
            message: 'Invalid department or job title.',
          })
        }

        return inviteOrganizationMember(
          {
            organizationId: currentOrganization.id,
            email: draft.email.trim(),
            fullName: draft.fullName.trim(),
            jobTitle: job.name,
            department: department.name,
            role: draft.role,
            projectIds: draft.projectIds,
          },
          session?.token,
        )
      }),
    )

    const failures = results.filter((result) => !result.ok)
    if (failures.length > 0) {
      const nextMessage = `${results.length - failures.length}/${results.length} invite(s) sent. ${failures[0]?.message ?? 'Some invites failed.'}`
      setMessage(nextMessage)
      notify.error('Some invites failed', { description: nextMessage })
      setSubmitting(false)
      return
    }

    const alreadyInvited = results.filter((result) => result.status === 'already_invited').length
    const successMessage =
      alreadyInvited > 0
        ? `${results.length - alreadyInvited} invite(s) sent. ${alreadyInvited} already existed or were already invited.`
        : `Invite sent to ${results.length} teammate(s).`
    notify.success('Invitation sent', { description: successMessage })
    window.dispatchEvent(new CustomEvent('cloudnine:realtime-change', { detail: { table: 'profiles' } }))
    window.dispatchEvent(new CustomEvent('cloudnine:realtime-change', { detail: { table: 'organization_invitations' } }))
    reset()
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) reset()
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent className='max-h-[90vh] max-w-3xl overflow-hidden p-0'>
        <DialogHeader className='border-b px-6 py-5'>
          <DialogTitle className='text-2xl leading-tight'>Invite people to your organization</DialogTitle>
          <DialogDescription className='text-sm'>Add one invitation per person so every user has complete profile and access information.</DialogDescription>
        </DialogHeader>

        <div className='max-h-[calc(90vh-10rem)] space-y-4 overflow-y-auto px-6 py-5'>
          {!isAdmin ? (
            <div className='rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
              Only organization admins can invite teammates.
            </div>
          ) : null}

          {drafts.map((draft, index) => {
            const selectedProjectNames = draft.projectIds
              .map((projectId) => projects.find((project) => project.id === projectId)?.name)
              .filter((name): name is string => Boolean(name))
            const isExpanded = drafts.length === 1 || draft.id === expandedDraftId
            const summaryName = draft.fullName.trim() || `User invitation ${index + 1}`
            const summaryEmail = draft.email.trim() || 'No email added'
            const normalizedEmail = draft.email.trim().toLowerCase()
            const emailCheck = emailAvailability[draft.id]
            const isDuplicateEmail = Boolean(normalizedEmail && duplicateDraftEmails.has(normalizedEmail))

            return (
              <section key={draft.id} className='rounded-xl border bg-muted/10 p-4'>
                <div className={cn('flex items-center justify-between gap-3', isExpanded ? 'mb-4' : '')}>
                  <div>
                    <p className='text-sm font-semibold text-foreground'>User invitation {index + 1}</p>
                    <p className='text-xs text-muted-foreground'>
                      {isExpanded ? 'One email address with its own profile, role, department, and job.' : `${summaryName} • ${summaryEmail}`}
                    </p>
                  </div>
                  <div className='flex items-center gap-1.5'>
                    {!isExpanded ? (
                      <Button type='button' size='sm' variant='outline' onClick={() => setExpandedDraftId(draft.id)} disabled={submitting}>
                        Edit
                      </Button>
                    ) : null}
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      onClick={() => removeDraft(draft.id)}
                      disabled={drafts.length === 1 || submitting}
                      aria-label={`Remove invitation ${index + 1}`}
                    >
                      <X className='h-4 w-4' />
                    </Button>
                  </div>
                </div>

                {!isExpanded ? null : (
                  <>
                <div className='grid gap-4 md:grid-cols-2'>
                  <div className='space-y-2'>
                    <label className='text-sm font-medium text-foreground'>Full name</label>
                    <Input
                      value={draft.fullName}
                      onChange={(event) => updateDraft(draft.id, { fullName: event.target.value })}
                      placeholder='Enter teammate full name'
                    />
                  </div>

                  <div className='space-y-2'>
                    <label className='text-sm font-medium text-foreground'>Default role</label>
                    <select
                      value={draft.role}
                      onChange={(event) => updateDraft(draft.id, { role: event.target.value as InvitationRole })}
                      className='h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
                    >
                      <option value='member'>Member</option>
                      <option value='viewer'>Viewer</option>
                      <option value='admin'>Admin</option>
                      <option value='owner'>Owner</option>
                    </select>
                  </div>

                  <div className='space-y-2'>
                    <label className='text-sm font-medium text-foreground'>Department</label>
                    <DepartmentPicker
                      value={draft.departmentId}
                      departments={departments}
                      creating={creatingDepartment}
                      disabled={submitting}
                      onChange={(departmentId) => updateDraft(draft.id, { departmentId, jobId: '' })}
                      onCreate={(name) => void handleCreateDepartment(draft.id, name)}
                    />
                  </div>

                  <div className='space-y-2'>
                    <label className='text-sm font-medium text-foreground'>Job title</label>
                    <JobPicker
                      value={draft.jobId}
                      departmentId={draft.departmentId}
                      jobs={jobs}
                      creating={creatingJob}
                      disabled={submitting}
                      onChange={(jobId) => updateDraft(draft.id, { jobId })}
                      onCreate={(name) => void handleCreateJob(draft.id, name)}
                    />
                  </div>

                  <div className='space-y-2 md:col-span-2'>
                    <label className='text-sm font-medium text-foreground'>Email address</label>
                    <Input
                      value={draft.email}
                      onChange={(event) => updateDraft(draft.id, { email: event.target.value })}
                      placeholder='name@company.com'
                      inputMode='email'
                    />
                    {draft.email.trim() && !isValidEmail(draft.email.trim()) ? (
                      <p className='text-xs text-destructive'>Enter a valid email address.</p>
                    ) : isDuplicateEmail ? (
                      <p className='text-xs text-destructive'>This email is entered more than once.</p>
                    ) : emailCheck?.email === normalizedEmail ? (
                      <p
                        className={cn(
                          'text-xs',
                          emailCheck.status === 'available' ? 'text-emerald-500' : emailCheck.status === 'checking' ? 'text-muted-foreground' : 'text-destructive',
                        )}
                      >
                        {emailCheck.message}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className='mt-4 space-y-3'>
                  <div className='flex items-center gap-1.5'>
                    <label className='text-sm font-medium text-foreground'>Project access</label>
                    <Info className='h-4 w-4 text-muted-foreground' aria-hidden='true' />
                  </div>

                  <div className='min-h-11 rounded-md border bg-background p-2'>
                    <div className='flex flex-wrap gap-2'>
                      {draft.projectIds.length === 0 ? (
                        <p className='px-1 py-1 text-sm text-muted-foreground'>No project selected</p>
                      ) : (
                        selectedProjectNames.map((projectName) => (
                          <span key={projectName} className='inline-flex items-center gap-2 rounded-md border bg-muted/50 px-2 py-1 text-sm'>
                            {projectName}
                          </span>
                        ))
                      )}
                    </div>
                  </div>

                  <div className='flex flex-wrap gap-2'>
                    {projects.map((project) => {
                      const selected = draft.projectIds.includes(project.id)
                      return (
                        <button
                          key={project.id}
                          type='button'
                          onClick={() => toggleProject(draft.id, project.id)}
                          className={cn(
                            'inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors',
                            selected ? 'border-primary/50 bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-accent',
                          )}
                        >
                          <span className='h-2.5 w-2.5 rounded-full' style={projectDotStyle(project.color)} />
                          {project.name}
                        </button>
                      )
                    })}
                    {projects.length === 0 ? <p className='text-sm text-muted-foreground'>No projects available yet.</p> : null}
                  </div>
                </div>
                  </>
                )}
              </section>
            )
          })}

          <Button type='button' variant='outline' className='w-full gap-1.5' onClick={addDraft} disabled={submitting}>
            <CirclePlus className='h-4 w-4' />
            Add another user
          </Button>

          {message ? <p className='rounded-md border bg-muted/20 px-3 py-2 text-sm text-muted-foreground'>{message}</p> : null}
        </div>

        <DialogFooter className='border-t px-6 py-4'>
          <Button
            type='button'
            variant='outline'
            onClick={() => {
              reset()
              onOpenChange(false)
            }}
          >
            Cancel
          </Button>
          <Button type='button' disabled={!canSend} onClick={() => void handleSendInvites()}>
            {submitting ? 'Sending...' : `Send ${drafts.length} invite${drafts.length === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
