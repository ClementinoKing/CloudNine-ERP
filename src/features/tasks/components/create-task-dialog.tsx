import { AtSign, Check, Paperclip, Repeat2, Search, UserPlus, X } from 'lucide-react'
import { max, startOfDay } from 'date-fns'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { MentionRichTextEditor, type MentionRichTextEditorHandle } from '@/components/ui/mention-rich-text-editor'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useAuth } from '@/features/auth/context/auth-context'
import { dispatchNotificationEmails } from '@/features/notifications/lib/email-delivery'
import {
  FALLBACK_STATUS_OPTIONS,
  legacyBoardColumnForStatusKey,
  mapStatusRowsToOptions,
  resolveProjectStatusOptions,
  type StatusOption,
} from '@/features/tasks/lib/status-catalog'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

type ProjectOption = { id: string; name: string }
type MemberOption = { id: string; name: string; username?: string; email?: string; avatarUrl?: string }
type TaskOption = { id: string; title: string }
type TaskType = 'task' | 'subtask'
type ScheduleMode = 'due_date' | 'range'
type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual'

function extractMentionedMemberIds(text: string, members: Array<{ id: string; name: string }>) {
  const normalized = text.toLowerCase()
  const mentioned = new Set<string>()
  for (const member of members) {
    const handleToken = `@${mentionHandleForMember(member).toLowerCase()}`
    const normalizedNameHandle = `@${member.name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9._-]/g, '')}`
    const nameToken = `@${member.name.toLowerCase()}`
    if (normalized.includes(handleToken) || normalized.includes(normalizedNameHandle) || normalized.includes(nameToken)) {
      mentioned.add(member.id)
    }
  }
  return Array.from(mentioned)
}

function mentionHandleForMember(member: { name: string; username?: string | null }) {
  const explicit = member.username?.trim()
  if (explicit) return explicit
  return member.name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9._-]/g, '')
}

function formatLocalDate(value: Date) {
  const year = value.getFullYear()
  const month = `${value.getMonth() + 1}`.padStart(2, '0')
  const day = `${value.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

export type CreatedTaskPayload = {
  id: string
  parentTaskId?: string
  recurrenceId?: string | null
  title: string
  status: string | null
  statusId: string | null
  statusKey: string | null
  priority: string | null
  boardColumn: string | null
  createdById: string
  projectId: string
  projectName: string
  assigneeIds: string[]
  assigneeNames: string[]
  assigneeId: string
  assigneeName: string
  dueAt: string | null
  startAt: string
  createdAt: string
  description: string
}

export function CreateTaskDialog({
  open,
  onOpenChange,
  onTaskCreated,
  initialBoardColumn = 'planned',
  initialStatusId,
  initialParentTaskId,
  initialTaskType,
  initialProjectId,
  lockProjectSelection = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onTaskCreated?: (task: CreatedTaskPayload) => void
  initialBoardColumn?: string
  initialStatusId?: string
  initialParentTaskId?: string
  initialTaskType?: TaskType
  initialProjectId?: string
  lockProjectSelection?: boolean
}) {
  const { currentUser } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const descriptionEditorRef = useRef<MentionRichTextEditorHandle | null>(null)

  const [projectOptions, setProjectOptions] = useState<ProjectOption[]>([])
  const [statusOptions, setStatusOptions] = useState<StatusOption[]>(FALLBACK_STATUS_OPTIONS)
  const [memberOptions, setMemberOptions] = useState<MemberOption[]>([])
  const [taskOptions, setTaskOptions] = useState<TaskOption[]>([])
  const defaultTaskType: TaskType = initialTaskType ?? (initialParentTaskId ? 'subtask' : 'task')
  const [taskType, setTaskType] = useState<TaskType>(defaultTaskType)
  const [parentTaskId, setParentTaskId] = useState(initialParentTaskId ?? '')
  const [selectedStatusId, setSelectedStatusId] = useState(initialStatusId ?? '')
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState('')
  const [assigneeIds, setAssigneeIds] = useState<string[]>([])
  const [assigneeSearch, setAssigneeSearch] = useState('')
  const [assigneeOpen, setAssigneeOpen] = useState(false)
  const [description, setDescription] = useState('')
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('due_date')
  const [isRecurring, setIsRecurring] = useState(false)
  const [recurrenceFrequency, setRecurrenceFrequency] = useState<RecurrenceFrequency>('daily')
  const [recurrenceEndAt, setRecurrenceEndAt] = useState<Date | undefined>()
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('low')
  const [singleDueAt, setSingleDueAt] = useState<Date | undefined>()
  const [rangeStartAt, setRangeStartAt] = useState<Date | undefined>()
  const [rangeEndAt, setRangeEndAt] = useState<Date | undefined>()
  const [selectedAttachment, setSelectedAttachment] = useState('')
  const [creating, setCreating] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const today = startOfDay(new Date())
  const minimumEndDate = rangeStartAt ? max([today, startOfDay(rangeStartAt)]) : today

  useEffect(() => {
    let cancelled = false

    void Promise.all([
      supabase.from('projects').select('id, name').order('name', { ascending: true }),
      supabase.from('profiles').select('id, full_name, username, email, avatar_url').order('full_name', { ascending: true }),
      supabase.from('tasks').select('id, title').order('created_at', { ascending: false }).limit(300),
      supabase.from('status').select('id, project_id, key, label, sort_order, is_default').order('sort_order', { ascending: true }),
    ]).then(([projectsResult, profilesResult, tasksResult, statusesResult]) => {
      if (cancelled) return

      const projects = (projectsResult.data ?? []).map((project) => ({ id: project.id, name: project.name ?? 'Untitled project' }))
      const members = (profilesResult.data ?? []).map((profile) => ({
        id: profile.id,
        name: profile.full_name ?? profile.email ?? 'Unknown member',
        username: profile.username ?? undefined,
        email: profile.email ?? undefined,
        avatarUrl: profile.avatar_url ?? undefined,
      }))

      setProjectOptions(projects)
      setMemberOptions(members)
      setTaskOptions((tasksResult.data ?? []).map((task) => ({ id: task.id, title: task.title })))
      const fetchedStatuses = mapStatusRowsToOptions(statusesResult.data ?? [])
      const nextStatuses = fetchedStatuses.length > 0 ? fetchedStatuses : FALLBACK_STATUS_OPTIONS
      setStatusOptions(nextStatuses)
      const nextProjectId = initialProjectId || projectId || projects[0]?.id || ''
      const preferredById = initialStatusId ? nextStatuses.find((status) => status.id === initialStatusId) : undefined
      const projectAwareStatuses = resolveProjectStatusOptions(nextStatuses, nextProjectId)
      const preferredByLegacyKey = nextStatuses.find((status) => status.key === initialBoardColumn && (status.projectId === nextProjectId || status.projectId === null))
      const defaultStatus =
        preferredById ??
        preferredByLegacyKey ??
        projectAwareStatuses[0] ??
        nextStatuses[0]
      setSelectedStatusId(defaultStatus?.id ?? '')
      setProjectId((current) => initialProjectId || current || projects[0]?.id || '')
    })

    return () => {
      cancelled = true
    }
  }, [])

  const reset = () => {
    setTaskType(defaultTaskType)
    setParentTaskId(initialParentTaskId ?? '')
    setSelectedStatusId(initialStatusId ?? '')
    setTitle('')
    setProjectId(initialProjectId || projectOptions[0]?.id || '')
    setAssigneeIds([])
    setAssigneeSearch('')
    setAssigneeOpen(false)
    setDescription('')
    setScheduleMode('due_date')
    setIsRecurring(false)
    setRecurrenceFrequency('daily')
    setRecurrenceEndAt(undefined)
    setPriority('low')
    setSingleDueAt(undefined)
    setRangeStartAt(undefined)
    setRangeEndAt(undefined)
    setSelectedAttachment('')
    setErrorMessage(null)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  useEffect(() => {
    if (!open) return
    setTaskType(defaultTaskType)
    setParentTaskId(initialParentTaskId ?? '')
    setSelectedStatusId(initialStatusId ?? '')
    setProjectId((current) => initialProjectId || current)
    setIsRecurring(false)
    setRecurrenceFrequency('daily')
    setRecurrenceEndAt(undefined)
  }, [open, defaultTaskType, initialParentTaskId, initialProjectId, initialStatusId])

  useEffect(() => {
    if (taskType !== 'task' || scheduleMode !== 'due_date') {
      setIsRecurring(false)
    }
  }, [scheduleMode, taskType])

  const availableStatuses = useMemo(() => {
    return resolveProjectStatusOptions(statusOptions, projectId)
  }, [projectId, statusOptions])

  useEffect(() => {
    if (!open) return
    if (availableStatuses.some((status) => status.id === selectedStatusId)) return
    setSelectedStatusId(availableStatuses[0]?.id ?? '')
  }, [availableStatuses, open, selectedStatusId])

  const handleSubmit = async () => {
    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      setErrorMessage('Task title is required.')
      return
    }
    const nextParentTaskId = taskType === 'subtask' ? parentTaskId || initialParentTaskId || '' : ''
    if (taskType === 'subtask' && !nextParentTaskId) {
      setErrorMessage('Please select a parent task.')
      return
    }

    setCreating(true)
    setErrorMessage(null)

    try {
      let startAtIso: string | null = null
      let dueAtIso: string | null = null
      const mentionedMemberIds =
        currentUser?.id && description.trim()
          ? extractMentionedMemberIds(description, memberOptions).filter((memberId) => memberId !== currentUser.id)
          : []

      if (isRecurring && taskType !== 'task') {
        setErrorMessage('Recurring tasks are only available for top-level tasks.')
        setCreating(false)
        return
      }

      if (isRecurring && scheduleMode !== 'due_date') {
        setErrorMessage('Recurring tasks require a due date.')
        setCreating(false)
        return
      }

      if (scheduleMode === 'due_date') {
        if (singleDueAt && startOfDay(singleDueAt).getTime() < today.getTime()) {
          setErrorMessage('Due date cannot be in the past.')
          setCreating(false)
          return
        }
        startAtIso = singleDueAt ? singleDueAt.toISOString() : new Date().toISOString()
        dueAtIso = singleDueAt ? singleDueAt.toISOString() : null
      } else {
        if (!rangeStartAt || !rangeEndAt) {
          setErrorMessage('Start and end date are required for range mode.')
          setCreating(false)
          return
        }
        if (rangeStartAt.getTime() > rangeEndAt.getTime()) {
          setErrorMessage('Start date must be before or equal to end date.')
          setCreating(false)
          return
        }
        if (startOfDay(rangeEndAt).getTime() < today.getTime()) {
          setErrorMessage('End date cannot be in the past.')
          setCreating(false)
          return
        }
        startAtIso = rangeStartAt.toISOString()
        dueAtIso = rangeEndAt.toISOString()
      }

      const recurrenceAnchorDate = singleDueAt ?? new Date()

      if (isRecurring && recurrenceEndAt && startOfDay(recurrenceEndAt).getTime() < startOfDay(recurrenceAnchorDate).getTime()) {
        setErrorMessage('The recurrence end date must be on or after the task start date.')
        setCreating(false)
        return
      }

      const effectiveAssigneeIds = assigneeIds.length > 0 ? assigneeIds : currentUser?.id ? [currentUser.id] : []
      const primaryAssigneeId = effectiveAssigneeIds[0] ?? null
      const selectedStatus = availableStatuses.find((status) => status.id === selectedStatusId) ?? availableStatuses[0] ?? FALLBACK_STATUS_OPTIONS[0]
      const legacyBoardColumn = legacyBoardColumnForStatusKey(selectedStatus?.key)
      const { data, error } = await supabase.rpc('create_task_with_recurrence', {
        p_title: trimmedTitle,
        p_parent_task_id: taskType === 'subtask' ? nextParentTaskId : null,
        p_description: description.trim() || null,
        p_status_id: selectedStatus?.id ?? null,
        p_status: selectedStatus?.key ?? 'planned',
        p_board_column: legacyBoardColumn,
        p_project_id: projectId || null,
        p_assignee_ids: effectiveAssigneeIds,
        p_due_at: dueAtIso,
        p_start_at: startAtIso,
        p_priority: priority,
        p_mentioned_member_ids: mentionedMemberIds,
        p_recurrence_frequency: isRecurring ? recurrenceFrequency : null,
        p_recurrence_end_on: isRecurring && recurrenceEndAt ? formatLocalDate(recurrenceEndAt) : null,
      })

      if (error || !data) {
        throw error ?? new Error('Task could not be created.')
      }

      if (currentUser?.id) {
        const { data: notificationRows, error: notificationError } = await supabase
          .from('notifications')
          .select('id, recipient_id, metadata')
          .eq('task_id', data.id)
          .eq('actor_id', currentUser.id)
          .order('created_at', { ascending: true })

        if (notificationError) {
          console.error('Failed to load task notifications', notificationError)
        } else if (notificationRows?.length) {
          void dispatchNotificationEmails(
            notificationRows.map((item) => ({
              notificationId: item.id,
              recipientId: item.recipient_id,
              recipientEmail: memberOptions.find((member) => member.id === item.recipient_id)?.email,
              type: item.metadata?.event === 'task_mentioned' ? ('mention' as const) : ('task_assigned' as const),
              taskId: data.id,
              taskTitle: data.title,
              actorName: currentUser.name ?? currentUser.email ?? 'A teammate',
            })),
          )
        }
      }

      const selectedAssigneeNames = effectiveAssigneeIds
        .map((id) => assigneeOptions.find((member) => member.id === id)?.name)
        .filter((name): name is string => Boolean(name))

      onTaskCreated?.({
        id: data.id,
        parentTaskId: data.parent_task_id ?? undefined,
        recurrenceId: data.recurrence_id ?? null,
        title: data.title,
        status: data.status,
        statusId: data.status_id ?? null,
        statusKey: selectedStatus?.key ?? data.status ?? null,
        priority: data.priority,
        boardColumn: data.board_column ?? null,
        createdById: data.created_by ?? currentUser?.id ?? '',
        projectId: data.project_id ?? '',
        projectName: projectOptions.find((project) => project.id === data.project_id)?.name ?? 'Unassigned project',
        assigneeIds: effectiveAssigneeIds,
        assigneeNames: selectedAssigneeNames,
        assigneeId: data.assigned_to ?? primaryAssigneeId ?? '',
        assigneeName: assigneeOptions.find((member) => member.id === (data.assigned_to ?? primaryAssigneeId))?.name ?? 'Unassigned',
        dueAt: data.due_at ?? null,
        startAt: data.start_at ?? data.created_at ?? new Date().toISOString(),
        createdAt: data.created_at ?? new Date().toISOString(),
        description: data.description ?? '',
      })

      handleOpenChange(false)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Task could not be created.')
    } finally {
      setCreating(false)
    }
  }

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void handleSubmit()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    open,
    title,
    projectId,
    assigneeIds,
    description,
    priority,
    singleDueAt,
    rangeStartAt,
    rangeEndAt,
    scheduleMode,
    selectedStatusId,
    taskType,
    parentTaskId,
    availableStatuses,
    isRecurring,
    recurrenceFrequency,
    recurrenceEndAt,
  ])

  const assigneeOptions = useMemo(() => {
    const options = memberOptions.slice()
    if (currentUser && !options.some((member) => member.id === currentUser.id)) {
      options.unshift({
        id: currentUser.id,
        name: currentUser.name ?? currentUser.email ?? 'Me',
        username: currentUser.username ?? undefined,
        email: currentUser.email ?? undefined,
        avatarUrl: currentUser.avatarUrl ?? undefined,
      })
    }
    return options
  }, [currentUser, memberOptions])
  const mentionOptions = useMemo(
    () => memberOptions.filter((member) => member.id !== currentUser?.id),
    [currentUser?.id, memberOptions],
  )
  const filteredMembers = assigneeOptions.filter((member) => member.name.toLowerCase().includes(assigneeSearch.trim().toLowerCase()))
  const selectedAssignees = assigneeIds
    .map((id) => assigneeOptions.find((member) => member.id === id) ?? memberOptions.find((member) => member.id === id))
    .filter((member): member is MemberOption => Boolean(member))
  const initials = (value: string) =>
    value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'U'

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className='flex h-[90vh] max-h-[90vh] max-w-3xl flex-col overflow-hidden p-0'>
        <DialogHeader className='border-b bg-muted/20 px-6 py-4'>
          <DialogTitle>{taskType === 'subtask' ? 'Create Subtask' : 'Create Task'}</DialogTitle>
          <DialogDescription>
            Add a {taskType === 'subtask' ? 'subtask' : 'task'} and link it to the right project and assignee.
          </DialogDescription>
        </DialogHeader>

        <div className='flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-5'>
          <div className='flex items-center justify-between gap-3'>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder='Enter task title...'
              className='h-11 flex-1 text-[18px] font-semibold'
            />
            <div className='inline-flex shrink-0 gap-1 rounded-xl bg-muted/45 p-1'>
              <button
                type='button'
                onClick={() => setTaskType('task')}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  taskType === 'task'
                    ? 'border bg-card text-foreground shadow-[inset_0_0_0_1px_hsl(var(--border))]'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                Task
              </button>
              <button
                type='button'
                onClick={() => setTaskType('subtask')}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  taskType === 'subtask'
                    ? 'border bg-card text-foreground shadow-[inset_0_0_0_1px_hsl(var(--border))]'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                Subtask
              </button>
            </div>
          </div>

          {taskType === 'subtask' ? (
            <div className='space-y-2'>
              <select
                value={parentTaskId}
                onChange={(event) => setParentTaskId(event.target.value)}
                className='flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
              >
                <option value=''>Select parent task</option>
                {taskOptions.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className='space-y-2'>
            <div className='space-y-2'>
              <label className='text-sm font-medium text-foreground'>Assigned to</label>
              <Popover open={assigneeOpen} onOpenChange={setAssigneeOpen}>
                <PopoverTrigger asChild>
                  <div
                    role='button'
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setAssigneeOpen((value) => !value)
                      }
                    }}
                    className='flex min-h-11 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-2 py-1.5 text-sm ring-offset-background transition-colors hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
                  >
                    <div className='flex min-w-0 flex-1 flex-wrap items-center gap-1.5'>
                      {selectedAssignees.length > 0 ? (
                        selectedAssignees.map((member) => (
                          <span key={member.id} className='inline-flex items-center gap-2 rounded-full border bg-background px-2 py-1 text-xs'>
                            <Avatar className='h-5 w-5 border'>
                              {member.avatarUrl ? <AvatarImage src={member.avatarUrl} alt={member.name} /> : null}
                              <AvatarFallback className='text-[9px] font-semibold'>{initials(member.name)}</AvatarFallback>
                            </Avatar>
                            <span className='max-w-28 truncate'>{member.name}</span>
                            <span
                              role='button'
                              tabIndex={0}
                              onMouseDown={(event) => event.stopPropagation()}
                              onClick={(event) => {
                                event.stopPropagation()
                                setAssigneeIds((ids) => ids.filter((id) => id !== member.id))
                              }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault()
                                  event.stopPropagation()
                                  setAssigneeIds((ids) => ids.filter((id) => id !== member.id))
                                }
                              }}
                              className='inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground'
                              aria-label={`Remove ${member.name}`}
                            >
                              <X className='h-3 w-3' />
                            </span>
                          </span>
                        ))
                      ) : (
                        <span className='px-1 text-muted-foreground'>Select teammate</span>
                      )}
                    </div>
                    <span className='inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border/70 bg-muted/25 text-foreground'>
                      <UserPlus className='h-4 w-4' />
                    </span>
                  </div>
                </PopoverTrigger>
                <PopoverContent className='w-[360px] p-0' align='start'>
                  <div className='border-b p-3'>
                    <div className='flex items-center gap-2 rounded-md border bg-background px-3'>
                      <Search className='h-4 w-4 text-muted-foreground' />
                      <input
                        value={assigneeSearch}
                        onChange={(event) => setAssigneeSearch(event.target.value)}
                        placeholder='Search teammates'
                        className='h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground'
                      />
                    </div>
                  </div>

                  <div className='max-h-72 overflow-y-auto p-2'>
                    <button
                      type='button'
                      onClick={() => {
                        setAssigneeIds([])
                        setAssigneeSearch('')
                      }}
                      className='flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent'
                    >
                      <span className='text-muted-foreground'>Unassigned</span>
                      {assigneeIds.length === 0 ? <Check className='h-4 w-4 text-primary' /> : null}
                    </button>

                    {filteredMembers.length === 0 ? (
                      <div className='px-3 py-8 text-center text-sm text-muted-foreground'>No teammates found.</div>
                    ) : (
                      filteredMembers.map((member) => (
                        <button
                          key={member.id}
                          type='button'
                          onClick={() => {
                            setAssigneeIds((ids) => (ids.includes(member.id) ? ids.filter((id) => id !== member.id) : [...ids, member.id]))
                            setAssigneeSearch('')
                          }}
                          className='flex w-full items-center justify-between rounded-md px-3 py-2 text-left transition-colors hover:bg-accent'
                        >
                          <span className='flex min-w-0 items-center gap-3'>
                            <Avatar className='h-8 w-8 border'>
                              {member.avatarUrl ? <AvatarImage src={member.avatarUrl} alt={member.name} /> : null}
                              <AvatarFallback className='text-[10px] font-semibold'>{initials(member.name)}</AvatarFallback>
                            </Avatar>
                            <span className='truncate text-sm font-medium text-foreground'>{member.name}</span>
                          </span>
                          <Check className={cn('h-4 w-4 text-primary', assigneeIds.includes(member.id) ? 'opacity-100' : 'opacity-0')} />
                        </button>
                      ))
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className='grid gap-3 md:grid-cols-3'>
            <div className='space-y-2'>
              <select
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                disabled={lockProjectSelection}
                className='flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
                aria-label='Project'
              >
                <option value=''>No project</option>
                {projectOptions.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              {lockProjectSelection ? <p className='text-[11px] text-muted-foreground'>Project is inherited from the parent task.</p> : null}
            </div>
            <div className='space-y-2'>
              <select
                value={priority}
                onChange={(event) => setPriority(event.target.value as 'low' | 'medium' | 'high' | 'urgent')}
                className='flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
                aria-label='Priority'
              >
                <option value='low'>Low</option>
                <option value='medium'>Medium</option>
                <option value='high'>High</option>
                <option value='urgent'>Urgent</option>
              </select>
            </div>
            <div className='space-y-2'>
              <select
                value={selectedStatusId}
                onChange={(event) => setSelectedStatusId(event.target.value)}
                className='flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
                aria-label='Status'
              >
                {availableStatuses.map((status) => (
                  <option key={status.id} value={status.id}>
                    {status.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className='space-y-2'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <label className='text-sm font-medium text-foreground'>Schedule</label>
              <div className='inline-flex gap-1 rounded-xl bg-muted/45 p-1'>
                <button
                  type='button'
                  onClick={() => setScheduleMode('due_date')}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                    scheduleMode === 'due_date'
                      ? 'border bg-card text-foreground shadow-[inset_0_0_0_1px_hsl(var(--border))]'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  Due Date
                </button>
                <button
                  type='button'
                  onClick={() => setScheduleMode('range')}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                    scheduleMode === 'range'
                      ? 'border bg-card text-foreground shadow-[inset_0_0_0_1px_hsl(var(--border))]'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  Range
                </button>
              </div>
            </div>
            <p className='text-xs text-muted-foreground'>Select a due date or schedule a date range.</p>
            <div className='transition-all duration-200'>
              {scheduleMode === 'due_date' ? (
                <div className='grid gap-3 md:grid-cols-2'>
                  <DatePicker
                    value={singleDueAt}
                    onChange={setSingleDueAt}
                    placeholder='Due date'
                    className='h-10 w-full text-sm'
                    disabledDays={{ before: today }}
                  />
                  <div className='hidden md:block' />
                </div>
              ) : (
                <div className='grid gap-3 md:grid-cols-2'>
                  <DatePicker
                    value={rangeStartAt}
                    onChange={(nextStart) => {
                      setRangeStartAt(nextStart)
                      if (rangeEndAt && nextStart && rangeEndAt.getTime() < max([today, startOfDay(nextStart)]).getTime()) {
                        setRangeEndAt(undefined)
                      }
                    }}
                    placeholder='Start date'
                    className='h-10 w-full text-sm'
                  />
                  <DatePicker
                    value={rangeEndAt}
                    onChange={setRangeEndAt}
                    placeholder='End date'
                    className='h-10 w-full text-sm'
                    disabledDays={{ before: minimumEndDate }}
                  />
                </div>
              )}
            </div>
          </div>

          {taskType === 'task' && scheduleMode === 'due_date' ? (
            <div className='space-y-3 rounded-xl border bg-muted/10 p-4'>
              <div className='flex items-center justify-between gap-3'>
                <div className='space-y-1'>
                  <div className='flex items-center gap-2'>
                    <Repeat2 className='h-4 w-4 text-muted-foreground' aria-hidden='true' />
                    <label className='text-sm font-medium text-foreground'>Recurring task</label>
                  </div>
                  <p className='text-xs text-muted-foreground'>Create a new task instance on a repeating schedule.</p>
                  <p className='text-[11px] text-muted-foreground'>Due date is optional for recurring tasks.</p>
                </div>
                <button
                  type='button'
                  onClick={() => {
                    setIsRecurring((current) => {
                      const next = !current
                      if (next) setScheduleMode('due_date')
                      if (!next) setRecurrenceEndAt(undefined)
                      return next
                    })
                  }}
                  className={cn(
                    'inline-flex h-8 items-center rounded-full px-3 text-xs font-medium transition-colors',
                    isRecurring ? 'bg-primary text-primary-foreground' : 'border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  {isRecurring ? 'On' : 'Off'}
                </button>
              </div>
              {isRecurring ? (
                <div className='grid gap-3 md:grid-cols-2'>
                  <div className='space-y-2'>
                    <label className='text-xs font-medium text-muted-foreground'>Repeat every</label>
                    <select
                      value={recurrenceFrequency}
                      onChange={(event) => setRecurrenceFrequency(event.target.value as RecurrenceFrequency)}
                      className='flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
                    >
                      <option value='daily'>Daily</option>
                      <option value='weekly'>Weekly</option>
                      <option value='monthly'>Monthly</option>
                      <option value='quarterly'>Quarterly</option>
                      <option value='annual'>Annual</option>
                    </select>
                  </div>
                  <div className='space-y-2'>
                    <label className='text-xs font-medium text-muted-foreground'>End date</label>
                    <DatePicker
                      value={recurrenceEndAt}
                      onChange={setRecurrenceEndAt}
                      placeholder='Optional end date'
                      className='h-10 w-full text-sm'
                      disabledDays={{ before: singleDueAt ? startOfDay(singleDueAt) : today }}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className='mt-auto flex min-h-[220px] flex-1 flex-col space-y-2'>
            <div className='flex items-center justify-between'>
              <span className='sr-only'>Description</span>
            </div>
            <div className='relative flex min-h-0 flex-1 rounded-md border border-input bg-background'>
              <div className='pointer-events-none absolute inset-x-0 top-0 h-10 rounded-t-md bg-gradient-to-b from-muted/20 to-transparent' />
              <div className='absolute right-2 top-2 z-10 flex items-center gap-1'>
                <button
                  type='button'
                  onClick={() => fileInputRef.current?.click()}
                  className='inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
                  aria-label='Add attachment'
                >
                  <Paperclip className='h-4 w-4' aria-hidden='true' />
                </button>
                <button
                  type='button'
                  onClick={() => {
                    descriptionEditorRef.current?.insertText('@')
                    descriptionEditorRef.current?.focus()
                  }}
                  className='inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
                  aria-label='Mention teammate'
                >
                  <AtSign className='h-4 w-4' aria-hidden='true' />
                </button>
              </div>
              <MentionRichTextEditor
                ref={descriptionEditorRef}
                value={description}
                onChange={setDescription}
                mentionOptions={mentionOptions}
                placeholder='Describe the task...'
                minHeightClassName='min-h-[140px]'
                className='h-full border-0 bg-transparent pr-20'
              />
            </div>
            <input
              ref={fileInputRef}
              type='file'
              className='hidden'
              onChange={(event) => setSelectedAttachment(event.target.files?.[0]?.name ?? '')}
            />
            <div className='flex items-center justify-between text-xs text-muted-foreground'>
              <span>{selectedAttachment ? `Attachment: ${selectedAttachment}` : 'No attachment selected'}</span>
              {scheduleMode === 'due_date' ? (
                <span>{singleDueAt ? `Due: ${singleDueAt.toLocaleDateString()}` : 'No due date selected'}</span>
              ) : (
                <span>
                  {rangeStartAt && rangeEndAt
                    ? `Range: ${rangeStartAt.toLocaleDateString()} - ${rangeEndAt.toLocaleDateString()}`
                    : 'No date range selected'}
                </span>
              )}
            </div>
          </div>

        </div>

        <div className='border-t bg-background px-6 py-4 shadow-[0_-1px_0_hsl(var(--border))]'>
          {errorMessage ? (
            <p className='mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
              {errorMessage}
            </p>
          ) : null}
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <p className='text-[11px] text-muted-foreground'>Press {navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl'} + Enter to create</p>
            <DialogFooter className='gap-2 sm:justify-end'>
              <Button type='button' variant='outline' onClick={() => handleOpenChange(false)} disabled={creating}>
                Cancel
              </Button>
              <Button type='button' onClick={() => void handleSubmit()} disabled={creating} className='min-w-[132px]'>
                {creating ? 'Creating...' : taskType === 'subtask' ? 'Create Subtask' : 'Create Task'}
              </Button>
            </DialogFooter>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
