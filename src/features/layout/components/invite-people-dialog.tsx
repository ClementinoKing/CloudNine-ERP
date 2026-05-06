import { ChevronDown, CirclePlus, Info, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useAuth } from '@/features/auth/context/auth-context'
import {
  inviteOrganizationMember,
  isValidEmail,
  splitEmails,
  type InvitationRole,
} from '@/features/organization/lib/invitations'
import { useOrganization } from '@/features/organization/context/organization-context'
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

export function InvitePeopleDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { currentUser, session } = useAuth()
  const { currentOrganization } = useOrganization()
  const [emailInput, setEmailInput] = useState('')
  const [fullName, setFullName] = useState('')
  const [selectedDepartmentId, setSelectedDepartmentId] = useState('')
  const [selectedJobId, setSelectedJobId] = useState('')
  const [role, setRole] = useState<InvitationRole>('member')
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [departments, setDepartments] = useState<DepartmentOption[]>([])
  const [jobs, setJobs] = useState<JobOption[]>([])
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [creatingDepartment, setCreatingDepartment] = useState(false)
  const [creatingJob, setCreatingJob] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [departmentOpen, setDepartmentOpen] = useState(false)
  const [departmentQuery, setDepartmentQuery] = useState('')
  const [jobOpen, setJobOpen] = useState(false)
  const [jobQuery, setJobQuery] = useState('')

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

  const parsedEmails = useMemo(() => splitEmails(emailInput), [emailInput])
  const invalidEmails = useMemo(() => parsedEmails.filter((email) => !isValidEmail(email)), [parsedEmails])
  const isAdmin = (currentUser?.roleLabel ?? '').toLowerCase() === 'admin' || (currentUser?.roleLabel ?? '').toLowerCase() === 'owner'
  const selectedDepartment = departments.find((department) => department.id === selectedDepartmentId) ?? null
  const selectedJob = jobs.find((job) => job.id === selectedJobId && job.department_id === selectedDepartmentId) ?? null
  const departmentJobs = jobs.filter((job) => job.department_id === selectedDepartmentId)
  const filteredDepartments = departments.filter((department) => department.name.toLowerCase().includes(departmentQuery.trim().toLowerCase()))
  const filteredJobs = departmentJobs.filter((job) => job.name.toLowerCase().includes(jobQuery.trim().toLowerCase()))
  const canSend =
    isAdmin &&
    !submitting &&
    parsedEmails.length > 0 &&
    invalidEmails.length === 0 &&
    fullName.trim().length > 0 &&
    Boolean(selectedDepartment) &&
    Boolean(selectedJob)

  const toggleProject = (projectId: string) => {
    setSelectedProjectIds((current) =>
      current.includes(projectId) ? current.filter((id) => id !== projectId) : [...current, projectId],
    )
  }

  const removeProject = (projectId: string) => {
    setSelectedProjectIds((current) => current.filter((id) => id !== projectId))
  }

  const reset = () => {
    setEmailInput('')
    setFullName('')
    setSelectedDepartmentId('')
    setSelectedJobId('')
    setRole('member')
    setSelectedProjectIds([])
    setSubmitting(false)
    setCreatingDepartment(false)
    setCreatingJob(false)
    setMessage(null)
    setDepartmentOpen(false)
    setDepartmentQuery('')
    setJobOpen(false)
    setJobQuery('')
  }

  const handleCreateDepartment = async () => {
    const name = departmentQuery.trim()
    if (!name) {
      setMessage('Enter a department name first.')
      return
    }

    const existing = departments.find((department) => department.name.toLowerCase() === name.toLowerCase())
    if (existing) {
      setSelectedDepartmentId(existing.id)
      setSelectedJobId('')
      setDepartmentOpen(false)
      setDepartmentQuery('')
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
    setSelectedDepartmentId(nextDepartment.id)
    setSelectedJobId('')
    setDepartmentOpen(false)
    setDepartmentQuery('')
    window.dispatchEvent(new CustomEvent('contas:realtime-change', { detail: { table: 'departments' } }))
  }

  const handleCreateJob = async () => {
    const name = jobQuery.trim()
    if (!selectedDepartmentId) {
      setMessage('Select a department before adding a job.')
      return
    }
    if (!name) {
      setMessage('Enter a job title first.')
      return
    }

    const existing = departmentJobs.find((job) => job.name.toLowerCase() === name.toLowerCase())
    if (existing) {
      setSelectedJobId(existing.id)
      setJobOpen(false)
      setJobQuery('')
      return
    }

    setCreatingJob(true)
    setMessage(null)
    const { data, error } = await supabase
      .from('jobs')
      .insert({
        organization_id: currentOrganization.id,
        department_id: selectedDepartmentId,
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
    setSelectedJobId(nextJob.id)
    setJobOpen(false)
    setJobQuery('')
    window.dispatchEvent(new CustomEvent('contas:realtime-change', { detail: { table: 'jobs' } }))
  }

  const handleSendInvites = async () => {
    if (!isAdmin) {
      setMessage('Only organization admins can invite teammates.')
      return
    }
    if (parsedEmails.length === 0) {
      setMessage('Enter at least one email address.')
      return
    }
    if (invalidEmails.length > 0) {
      setMessage(`Invalid emails: ${invalidEmails.join(', ')}`)
      return
    }
    if (!fullName.trim()) {
      setMessage('Full name is required.')
      return
    }
    if (!selectedJob) {
      setMessage('Job title is required.')
      return
    }
    if (!selectedDepartment) {
      setMessage('Department is required.')
      return
    }

    setSubmitting(true)
    setMessage(null)

    const results = await Promise.all(
      parsedEmails.map((email) =>
        inviteOrganizationMember(
          {
            email,
            fullName: fullName.trim(),
            jobTitle: selectedJob.name,
            department: selectedDepartment.name,
            role,
            projectIds: selectedProjectIds,
          },
          session?.token,
        ),
      ),
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
    window.dispatchEvent(new CustomEvent('contas:realtime-change', { detail: { table: 'profiles' } }))
    window.dispatchEvent(new CustomEvent('contas:realtime-change', { detail: { table: 'organization_invitations' } }))
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
      <DialogContent className='max-h-[90vh] max-w-4xl overflow-hidden p-0'>
        <DialogHeader className='border-b px-6 py-5'>
          <DialogTitle className='text-2xl leading-tight'>Invite people to your organization</DialogTitle>
          <DialogDescription className='text-sm'>Create an organization account, assign the role, department, job title, and optional project access.</DialogDescription>
        </DialogHeader>

        <div className='max-h-[calc(90vh-10rem)] space-y-6 overflow-y-auto px-6 py-5'>
          {!isAdmin ? (
            <div className='rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
              Only organization admins can invite teammates.
            </div>
          ) : null}

          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <label className='text-sm font-medium text-foreground'>Full name</label>
              <Input
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                placeholder='Enter teammate full name'
              />
            </div>

            <div className='space-y-2'>
              <label className='text-sm font-medium text-foreground'>Default role</label>
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as InvitationRole)}
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
              <Popover open={departmentOpen} onOpenChange={setDepartmentOpen}>
                <PopoverTrigger asChild>
                  <Button type='button' variant='outline' className='h-10 w-full justify-between px-3 font-normal'>
                    <span className={selectedDepartment ? 'text-foreground' : 'text-muted-foreground'}>
                      {selectedDepartment?.name ?? 'Select department'}
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
                    <div className='max-h-44 overflow-y-auto rounded-md border'>
                      {filteredDepartments.length === 0 ? (
                        <p className='px-3 py-2 text-xs text-muted-foreground'>No departments found.</p>
                      ) : (
                        filteredDepartments.map((item) => (
                          <button
                            key={item.id}
                            type='button'
                            className='block w-full border-b border-border/60 px-3 py-2 text-left text-sm transition-colors last:border-b-0 hover:bg-muted/40'
                            onClick={() => {
                              setSelectedDepartmentId(item.id)
                              setSelectedJobId('')
                              setDepartmentOpen(false)
                              setDepartmentQuery('')
                              setJobQuery('')
                            }}
                          >
                            {item.name}
                          </button>
                        ))
                      )}
                    </div>
                    <Button
                      type='button'
                      size='sm'
                      variant='outline'
                      className='w-full justify-center gap-1.5'
                      onClick={() => void handleCreateDepartment()}
                      disabled={creatingDepartment}
                    >
                      <CirclePlus className='h-4 w-4' />
                      {creatingDepartment ? 'Adding...' : 'Add department'}
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
                    disabled={!selectedDepartmentId}
                  >
                    <span className={selectedJob ? 'text-foreground' : 'text-muted-foreground'}>
                      {selectedJob?.name ?? (selectedDepartmentId ? 'Select job title' : 'Select department first')}
                    </span>
                    <ChevronDown className='h-4 w-4 text-muted-foreground' />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className='w-[var(--radix-popover-trigger-width)] p-2' align='start'>
                  <div className='space-y-2'>
                    <Input
                      value={jobQuery}
                      onChange={(event) => setJobQuery(event.target.value)}
                      placeholder='Search jobs'
                      className='h-9'
                    />
                    <div className='max-h-44 overflow-y-auto rounded-md border'>
                      {filteredJobs.length === 0 ? (
                        <p className='px-3 py-2 text-xs text-muted-foreground'>No jobs found for this department.</p>
                      ) : (
                        filteredJobs.map((item) => (
                          <button
                            key={item.id}
                            type='button'
                            className='block w-full border-b border-border/60 px-3 py-2 text-left text-sm transition-colors last:border-b-0 hover:bg-muted/40'
                            onClick={() => {
                              setSelectedJobId(item.id)
                              setJobOpen(false)
                              setJobQuery('')
                            }}
                          >
                            {item.name}
                          </button>
                        ))
                      )}
                    </div>
                    <Button
                      type='button'
                      size='sm'
                      variant='outline'
                      className='w-full justify-center gap-1.5'
                      onClick={() => void handleCreateJob()}
                      disabled={!selectedDepartmentId || creatingJob}
                    >
                      <CirclePlus className='h-4 w-4' />
                      {creatingJob ? 'Adding...' : 'Add job'}
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className='space-y-2'>
            <label className='text-sm font-medium text-foreground'>Email addresses</label>
            <textarea
              rows={3}
              value={emailInput}
              onChange={(event) => setEmailInput(event.target.value)}
              placeholder='name@company.com, teammate@company.com'
              className='flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
            />
            <div className='flex items-center justify-between text-xs text-muted-foreground'>
              <span>{parsedEmails.length} recipient(s)</span>
              {invalidEmails.length > 0 ? <span className='text-destructive'>Invalid: {invalidEmails.join(', ')}</span> : <span>All emails valid</span>}
            </div>
          </div>

          <div className='space-y-3'>
            <div className='flex items-center gap-1.5'>
              <label className='text-sm font-medium text-foreground'>Project access</label>
              <Info className='h-4 w-4 text-muted-foreground' aria-hidden='true' />
            </div>

            <div className='min-h-11 rounded-md border bg-background p-2'>
              <div className='flex flex-wrap gap-2'>
                {selectedProjectIds.length === 0 ? (
                  <p className='px-1 py-1 text-sm text-muted-foreground'>No project selected</p>
                ) : (
                  selectedProjectIds.map((id) => {
                    const project = projects.find((item) => item.id === id)
                    if (!project) return null
                    return (
                      <span key={project.id} className='inline-flex items-center gap-2 rounded-md border bg-muted/50 px-2 py-1 text-sm'>
                        <span className='h-2.5 w-2.5 rounded-full' style={projectDotStyle(project.color)} />
                        {project.name}
                        <button
                          type='button'
                          onClick={() => removeProject(project.id)}
                          className='inline-flex h-4 w-4 items-center justify-center text-muted-foreground hover:text-foreground'
                          aria-label={`Remove ${project.name}`}
                        >
                          <X className='h-3 w-3' />
                        </button>
                      </span>
                    )
                  })
                )}
              </div>
            </div>

            <div className='flex flex-wrap gap-2'>
              {projects.map((project) => {
                const selected = selectedProjectIds.includes(project.id)
                return (
                  <button
                    key={project.id}
                    type='button'
                    onClick={() => toggleProject(project.id)}
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
          <Button
            type='button'
            disabled={!canSend}
            onClick={() => void handleSendInvites()}
          >
            {submitting ? 'Sending...' : 'Send invite'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
