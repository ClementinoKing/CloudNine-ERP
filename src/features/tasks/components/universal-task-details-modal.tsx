import {
  Activity,
  Check,
  Heart,
  Lock,
  MessageCircle,
  MessageSquare,
  Mic,
  Play,
  PlusCircle,
  Repeat2,
  Send,
  Smile,
  Square,
  UserPlus,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { GlobalSaveStatus } from '@/components/ui/global-save-status'
import { Input } from '@/components/ui/input'
import { MentionRichTextEditor } from '@/components/ui/mention-rich-text-editor'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useAuth } from '@/features/auth/context/auth-context'
import { dispatchNotificationEmails } from '@/features/notifications/lib/email-delivery'
import { CreateTaskDialog, type CreatedTaskPayload } from '@/features/tasks/components/create-task-dialog'
import { consumePendingTaskDetailsModalId, peekPendingTaskDetailsModalId } from '@/features/tasks/lib/open-task-details-modal'
import {
  legacyBoardColumnForStatusKey,
  mapStatusRowsToOptions,
  resolveProjectStatusOptions,
  statusLabelFromKey,
  type StatusOption,
} from '@/features/tasks/lib/status-catalog'
import { resolveR2ObjectUrl, uploadTaskCommentVoiceToR2 } from '@/lib/r2'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

type OpenTaskModalEventDetail = { taskId: string }

type TaskRow = {
  id: string
  title: string
  description: string | null
  status: string | null
  status_id: string | null
  board_column: string | null
  recurrence_id?: string | null
  priority: string | null
  project_id: string | null
  start_at: string | null
  due_at: string | null
  completed_at: string | null
  created_by: string | null
}

type TaskRecurrenceRow = {
  id: string
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual'
  interval_count: number
  end_on: string | null
  next_run_at: string
  last_generated_at: string | null
  is_active: boolean
}

type Member = { id: string; name: string; username?: string | null; email?: string | null; avatarUrl?: string }
type Project = { id: string; name: string }
type CommentRow = {
  id: string
  content: string | null
  created_at: string | null
  author: string
  authorId: string
  authorAvatarUrl?: string
  voiceDataUrl?: string
  voiceStorageKey?: string
  voiceDurationMs?: number
  likes: number
  likedByMe: boolean
  replies: Array<{
    id: string
    authorId: string
    author: string
    authorAvatarUrl?: string
    content: string
    createdAt: string
  }>
}
type VoicePayload = { file: File; previewUrl: string; durationMs: number }

const COMMENT_PAYLOAD_PREFIX = '__contas_comment_v1__:'
const RECORDING_VISUALIZER_BARS = 20
const PLAYBACK_VISUALIZER_BARS = 22
const TASK_MODAL_CACHE_TTL_MS = 60_000
const COMMENT_EMOJIS = ['👍', '🔥', '🎉', '✅', '💯', '👏']

function initials(value: string) {
  return (
    value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'U'
  )
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

function extractMentionedMemberIds(text: string, members: Array<{ id: string; name: string; username?: string | null }>) {
  const handleToId = new Map<string, string>()
  for (const member of members) {
    const primaryHandle = mentionHandleForMember(member).toLowerCase()
    const normalizedName = member.name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^a-z0-9._\s-]/g, '')
    const nameHandle = normalizedName.replace(/\s+/g, '_')
    const compactName = normalizedName.replace(/[^a-z0-9]/g, '')
    ;[primaryHandle, normalizedName, nameHandle, compactName].filter(Boolean).forEach((handle) => {
      if (!handleToId.has(handle)) handleToId.set(handle, member.id)
    })
  }

  const mentioned = new Set<string>()
  const regex = /@([a-zA-Z0-9._-]+(?:\s+[a-zA-Z0-9._-]+){0,2})/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    const raw = match[1]?.trim().toLowerCase()
    if (!raw) continue
    const cleaned = raw.replace(/[.,!?:;]+$/g, '')
    const variants = [
      cleaned,
      cleaned.replace(/\s+/g, '_'),
      cleaned.replace(/\s+/g, ''),
      cleaned.replace(/[^a-z0-9._-]/g, ''),
    ]
    for (const variant of variants) {
      const memberId = handleToId.get(variant)
      if (memberId) {
        mentioned.add(memberId)
        break
      }
    }
  }
  return Array.from(mentioned)
}

function createBaseWaveLevels(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const curve = Math.sin(index * 0.68) * 0.22
    const wobble = Math.cos(index * 1.17) * 0.12
    return Math.max(0.22, Math.min(0.9, 0.46 + curve + wobble))
  })
}

function serializeCommentContent(text: string, voice?: { voiceDataUrl?: string; voiceStorageKey?: string; durationMs?: number } | null) {
  if (!voice) return text
  const payload = JSON.stringify({
    text,
    voiceDataUrl: voice.voiceDataUrl,
    voiceStorageKey: voice.voiceStorageKey,
    voiceDurationMs: voice.durationMs,
  })
  const encoded = window.btoa(unescape(encodeURIComponent(payload)))
  return `${COMMENT_PAYLOAD_PREFIX}${encoded}`
}

function parseCommentContent(content: string) {
  if (!content.startsWith(COMMENT_PAYLOAD_PREFIX)) {
    return {
      text: content,
      voiceDataUrl: undefined as string | undefined,
      voiceStorageKey: undefined as string | undefined,
      voiceDurationMs: undefined as number | undefined,
    }
  }
  try {
    const encoded = content.slice(COMMENT_PAYLOAD_PREFIX.length)
    const decoded = decodeURIComponent(escape(window.atob(encoded)))
    const payload = JSON.parse(decoded) as {
      text?: string
      voiceDataUrl?: string
      voiceStorageKey?: string
      voiceDurationMs?: number
    }
    return {
      text: payload.text ?? '',
      voiceDataUrl: payload.voiceDataUrl,
      voiceStorageKey: payload.voiceStorageKey,
      voiceDurationMs: payload.voiceDurationMs,
    }
  } catch {
    return {
      text: content,
      voiceDataUrl: undefined as string | undefined,
      voiceStorageKey: undefined as string | undefined,
      voiceDurationMs: undefined as number | undefined,
    }
  }
}

function formatVoiceDuration(durationMs?: number) {
  if (!durationMs) return '0:00'
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function formatDateOnly(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
}

function formatDateTimeOnly(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function recurrenceCadenceLabel(recurrence: TaskRecurrenceRow) {
  const intervalCount = Math.max(1, recurrence.interval_count || 1)
  const unit =
    recurrence.frequency === 'daily'
      ? 'day'
      : recurrence.frequency === 'weekly'
        ? 'week'
        : recurrence.frequency === 'monthly'
          ? 'month'
          : recurrence.frequency === 'quarterly'
            ? 'quarter'
            : 'year'
  return intervalCount === 1 ? `Repeats every ${unit}` : `Repeats every ${intervalCount} ${unit}s`
}

function TaskDetailsLoadingIndicator() {
  return (
    <div className='flex min-h-[220px] items-center justify-center'>
      <div className='task-details-loader' aria-hidden='true'>
        <svg id='pegtopone' width='100' height='100' viewBox='0 0 100 100' fill='none' xmlns='http://www.w3.org/2000/svg'>
          <g>
            <path d='M50 8C52.5 8 54.6 9.8 55.1 12.2L58.1 26.3C58.5 28.3 60.1 29.9 62.1 30.3L76.2 33.3C78.6 33.8 80.4 35.9 80.4 38.4C80.4 40.9 78.6 43 76.2 43.5L62.1 46.5C60.1 46.9 58.5 48.5 58.1 50.5L55.1 64.6C54.6 67 52.5 68.8 50 68.8C47.5 68.8 45.4 67 44.9 64.6L41.9 50.5C41.5 48.5 39.9 46.9 37.9 46.5L23.8 43.5C21.4 43 19.6 40.9 19.6 38.4C19.6 35.9 21.4 33.8 23.8 33.3L37.9 30.3C39.9 29.9 41.5 28.3 41.9 26.3L44.9 12.2C45.4 9.8 47.5 8 50 8Z' />
          </g>
        </svg>
        <svg id='pegtoptwo' width='100' height='100' viewBox='0 0 100 100' fill='none' xmlns='http://www.w3.org/2000/svg'>
          <g>
            <path d='M50 8C52.5 8 54.6 9.8 55.1 12.2L58.1 26.3C58.5 28.3 60.1 29.9 62.1 30.3L76.2 33.3C78.6 33.8 80.4 35.9 80.4 38.4C80.4 40.9 78.6 43 76.2 43.5L62.1 46.5C60.1 46.9 58.5 48.5 58.1 50.5L55.1 64.6C54.6 67 52.5 68.8 50 68.8C47.5 68.8 45.4 67 44.9 64.6L41.9 50.5C41.5 48.5 39.9 46.9 37.9 46.5L23.8 43.5C21.4 43 19.6 40.9 19.6 38.4C19.6 35.9 21.4 33.8 23.8 33.3L37.9 30.3C39.9 29.9 41.5 28.3 41.9 26.3L44.9 12.2C45.4 9.8 47.5 8 50 8Z' />
          </g>
        </svg>
        <svg id='pegtopthree' width='100' height='100' viewBox='0 0 100 100' fill='none' xmlns='http://www.w3.org/2000/svg'>
          <g>
            <path d='M50 8C52.5 8 54.6 9.8 55.1 12.2L58.1 26.3C58.5 28.3 60.1 29.9 62.1 30.3L76.2 33.3C78.6 33.8 80.4 35.9 80.4 38.4C80.4 40.9 78.6 43 76.2 43.5L62.1 46.5C60.1 46.9 58.5 48.5 58.1 50.5L55.1 64.6C54.6 67 52.5 68.8 50 68.8C47.5 68.8 45.4 67 44.9 64.6L41.9 50.5C41.5 48.5 39.9 46.9 37.9 46.5L23.8 43.5C21.4 43 19.6 40.9 19.6 38.4C19.6 35.9 21.4 33.8 23.8 33.3L37.9 30.3C39.9 29.9 41.5 28.3 41.9 26.3L44.9 12.2C45.4 9.8 47.5 8 50 8Z' />
          </g>
        </svg>
      </div>
    </div>
  )
}

function VoicePlayback({ src, durationMs }: { src: string; durationMs?: number }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTimeSeconds, setCurrentTimeSeconds] = useState(0)
  const [durationSeconds, setDurationSeconds] = useState(0)
  const [levels, setLevels] = useState<number[]>(() => createBaseWaveLevels(PLAYBACK_VISUALIZER_BARS))

  const stopAnimation = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    setIsPlaying(false)
    setLevels(createBaseWaveLevels(PLAYBACK_VISUALIZER_BARS))
  }, [])

  const stopPlayback = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.pause()
    audio.currentTime = 0
    setCurrentTimeSeconds(0)
    stopAnimation()
  }, [stopAnimation])

  const runAnimation = useCallback(() => {
    const audio = audioRef.current
    if (!audio || audio.paused || audio.ended) {
      stopAnimation()
      return
    }
    const t = audio.currentTime
    setLevels(
      Array.from({ length: PLAYBACK_VISUALIZER_BARS }, (_, index) => {
        const wave = Math.sin(t * 9 + index * 0.8)
        const shimmer = Math.sin(t * 5.5 + index * 1.2)
        return Math.max(0.16, Math.min(1, 0.46 + wave * 0.3 + shimmer * 0.2))
      }),
    )
    rafRef.current = requestAnimationFrame(runAnimation)
  }, [stopAnimation])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onPlay = () => {
      setIsPlaying(true)
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(runAnimation)
    }
    const onPause = () => stopAnimation()
    const onEnded = () => stopPlayback()
    const onTimeUpdate = () => setCurrentTimeSeconds(audio.currentTime || 0)
    const onLoadedMetadata = () => setDurationSeconds(Number.isFinite(audio.duration) ? audio.duration : 0)

    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('loadedmetadata', onLoadedMetadata)

    return () => {
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
      stopAnimation()
    }
  }, [runAnimation, stopAnimation, stopPlayback])

  const togglePlayback = async () => {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) {
      stopPlayback()
      return
    }
    try {
      await audio.play()
    } catch {
      setIsPlaying(false)
    }
  }

  const shownSeconds = isPlaying ? currentTimeSeconds : durationSeconds > 0 ? durationSeconds : (durationMs ?? 0) / 1000
  const effectiveDuration = durationSeconds > 0 ? durationSeconds : (durationMs ?? 0) / 1000
  const progressRatio = effectiveDuration > 0 ? Math.min(1, currentTimeSeconds / effectiveDuration) : 0
  const playedIndex = Math.floor(progressRatio * levels.length)

  return (
    <div className='flex items-center gap-3 rounded-full border border-border/70 bg-background/70 px-3 py-1.5'>
      <audio ref={audioRef} src={src} preload='metadata' className='hidden' />
      <div className='relative grid h-6 min-w-0 flex-1 items-center gap-[2px]' style={{ gridTemplateColumns: `repeat(${levels.length}, minmax(0, 1fr))` }}>
        {levels.map((level, index) => (
          <span
            key={index}
            className={cn(
              'z-[1] w-[2px] justify-self-center rounded-full transition-all duration-100',
              index <= playedIndex ? 'bg-foreground/85' : isPlaying ? 'bg-foreground/45' : 'bg-muted-foreground/55',
            )}
            style={{ height: `${Math.max(4, Math.round(level * 11)) * 2}px` }}
          />
        ))}
      </div>
      <span className='text-sm font-medium tabular-nums text-muted-foreground'>{formatVoiceDuration(shownSeconds * 1000)}</span>
      <button
        type='button'
        onClick={() => void togglePlayback()}
        className='inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/70 bg-muted/25 text-foreground transition-colors hover:bg-muted/40'
        aria-label={isPlaying ? 'Stop playback' : 'Play voice message'}
      >
        {isPlaying ? <Square className='h-3.5 w-3.5' /> : <Play className='h-3.5 w-3.5' />}
      </button>
    </div>
  )
}

export function UniversalTaskDetailsModal() {
  const { currentUser } = useAuth()
  const [open, setOpen] = useState(false)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [task, setTask] = useState<TaskRow | null>(null)
  const [recurrence, setRecurrence] = useState<TaskRecurrenceRow | null>(null)
  const [loadingTask, setLoadingTask] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [assigneeIds, setAssigneeIds] = useState<string[]>([])
  const [subtasks, setSubtasks] = useState<Array<{ id: string; title: string; status: string | null }>>([])
  const [statusOptions, setStatusOptions] = useState<StatusOption[]>([])
  const [comments, setComments] = useState<CommentRow[]>([])
  const [loadingComments, setLoadingComments] = useState(false)
  const [commentDraft, setCommentDraft] = useState('')
  const [replyDraftByCommentId, setReplyDraftByCommentId] = useState<Record<string, string>>({})
  const [activeReplyCommentId, setActiveReplyCommentId] = useState<string | null>(null)
  const [commentEmojiOpen, setCommentEmojiOpen] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'syncing' | 'saved' | 'error'>('idle')
  const [assigneeOpen, setAssigneeOpen] = useState(false)
  const [pendingVoiceComment, setPendingVoiceComment] = useState<VoicePayload | null>(null)
  const [isRecordingVoiceComment, setIsRecordingVoiceComment] = useState(false)
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0)
  const [recordingLevels, setRecordingLevels] = useState<number[]>(() => Array.from({ length: RECORDING_VISUALIZER_BARS }, () => 0.12))
  const [voiceCommentError, setVoiceCommentError] = useState<string | null>(null)
  const [createSubtaskOpen, setCreateSubtaskOpen] = useState(false)

  const commentMediaRecorderRef = useRef<MediaRecorder | null>(null)
  const commentVoiceChunksRef = useRef<Blob[]>([])
  const commentVoiceStartAtRef = useRef<number>(0)
  const pendingLikeCommentIdsRef = useRef<Set<string>>(new Set())
  const commentMicStreamRef = useRef<MediaStream | null>(null)
  const commentAudioContextRef = useRef<AudioContext | null>(null)
  const commentAnimationFrameRef = useRef<number | null>(null)
  const saveStateResetTimerRef = useRef<number | null>(null)
  const mentionSessionTaskIdRef = useRef<string | null>(null)
  const mentionSessionInitialDescriptionRef = useRef<string>('')
  const latestTaskRef = useRef<TaskRow | null>(null)
  const taskCacheRef = useRef<
    Map<
      string,
      {
        updatedAt: number
        task: TaskRow
        recurrence: TaskRecurrenceRow | null
        assigneeIds: string[]
        subtasks: Array<{ id: string; title: string; status: string | null }>
        comments: CommentRow[]
      }
    >
  >(new Map())

  const canEdit = useMemo(() => {
    if (!task || !currentUser?.id) return false
    return task.created_by === currentUser.id || assigneeIds.includes(currentUser.id)
  }, [assigneeIds, currentUser?.id, task])

  useEffect(() => {
    latestTaskRef.current = task
  }, [task])

  const stopRecordingVisualizer = useCallback(() => {
    if (commentAnimationFrameRef.current !== null) {
      cancelAnimationFrame(commentAnimationFrameRef.current)
      commentAnimationFrameRef.current = null
    }
    if (commentAudioContextRef.current) {
      void commentAudioContextRef.current.close().catch(() => undefined)
      commentAudioContextRef.current = null
    }
    if (commentMicStreamRef.current) {
      commentMicStreamRef.current.getTracks().forEach((track) => track.stop())
      commentMicStreamRef.current = null
    }
    setRecordingLevels(Array.from({ length: RECORDING_VISUALIZER_BARS }, () => 0.12))
  }, [])

  const loadTask = async (id: string) => {
    const cached = taskCacheRef.current.get(id)
    if (cached && Date.now() - cached.updatedAt < TASK_MODAL_CACHE_TTL_MS) {
      setTask(cached.task)
      setRecurrence(cached.recurrence)
      setAssigneeIds(cached.assigneeIds)
      setSubtasks(cached.subtasks)
      setComments(cached.comments)
      setLoadingTask(false)
      setLoadError(null)
    } else {
      setLoadingTask(true)
      setLoadError(null)
      setLoadingComments(true)
      setRecurrence(null)
    }

    // Stage 1: fetch core task data first so modal renders immediately
    const [taskResult, assigneesResult] = await Promise.all([
      supabase
        .from('tasks')
        .select('id, title, description, status, status_id, board_column, recurrence_id, priority, project_id, start_at, due_at, completed_at, created_by')
        .eq('id', id)
        .maybeSingle(),
      supabase.from('task_assignees').select('assignee_id').eq('task_id', id),
    ])

    if (taskResult.error || !taskResult.data) {
      setTask(null)
      setLoadError(taskResult.error?.message ?? 'Task could not be loaded.')
      setLoadingTask(false)
      return
    }

    setTask(taskResult.data)
    if (mentionSessionTaskIdRef.current !== id) {
      mentionSessionTaskIdRef.current = id
      mentionSessionInitialDescriptionRef.current = taskResult.data.description ?? ''
    }
    setAssigneeIds((assigneesResult.data ?? []).map((row) => row.assignee_id))
    setLoadingTask(false)

    // Stage 2: fetch heavy sections and reference data in the background
    setLoadingComments(true)
    const shouldFetchProjects = projects.length === 0
    const shouldFetchMembers = members.length === 0
    const recurrenceQuery = taskResult.data.recurrence_id
      ? supabase
          .from('task_recurrences')
          .select('id, frequency, interval_count, end_on, next_run_at, last_generated_at, is_active')
          .eq('id', taskResult.data.recurrence_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null })
    const statusQuery = taskResult.data.project_id
      ? supabase
          .from('status')
          .select('id,key,label,sort_order,project_id,is_default')
          .or(`project_id.is.null,project_id.eq.${taskResult.data.project_id}`)
          .order('sort_order', { ascending: true })
      : supabase.from('status').select('id,key,label,sort_order,project_id,is_default').is('project_id', null).order('sort_order', { ascending: true })
    const [subtasksResult, commentsResult, reactionsResult, projectsResult, profilesResult, statusResult, recurrenceResult] = await Promise.all([
      supabase.from('tasks').select('id, title, status').eq('parent_task_id', id).order('created_at', { ascending: false }),
      supabase
        .from('task_comments')
        .select('id, content, created_at, author_id, parent_comment_id')
        .eq('task_id', id)
        .order('created_at', { ascending: false })
        .limit(80),
      supabase.from('task_comment_reactions').select('comment_id, user_id, reaction'),
      shouldFetchProjects ? supabase.from('projects').select('id, name').order('name', { ascending: true }) : Promise.resolve({ data: null, error: null }),
      shouldFetchMembers
        ? supabase.from('profiles').select('id, full_name, username, email, avatar_url').order('full_name', { ascending: true })
        : Promise.resolve({ data: null, error: null }),
      statusQuery,
      recurrenceQuery,
    ])
    if (recurrenceResult.data) {
      setRecurrence(recurrenceResult.data)
    } else {
      setRecurrence(null)
    }
    setSubtasks(subtasksResult.data ?? [])
    if (projectsResult.data) {
      setProjects((projectsResult.data ?? []).map((project) => ({ id: project.id, name: project.name ?? 'Untitled project' })))
    }
    if (profilesResult.data) {
      setMembers(
        (profilesResult.data ?? []).map((profile) => ({
          id: profile.id,
          name: profile.full_name ?? profile.email ?? 'Unknown user',
          username: profile.username ?? undefined,
          email: profile.email ?? undefined,
          avatarUrl: profile.avatar_url ?? undefined,
        })),
      )
    }
    const nextStatusOptions = resolveProjectStatusOptions(mapStatusRowsToOptions(statusResult.data ?? []), taskResult.data.project_id)
    setStatusOptions(nextStatusOptions)

    const profileSource = profilesResult.data ?? []
    const profileMap = new Map(profileSource.map((row) => [row.id, { name: row.full_name ?? row.email ?? 'Unknown user', avatarUrl: row.avatar_url ?? undefined }]))
    const fallbackProfileMap = new Map(members.map((member) => [member.id, { name: member.name, avatarUrl: member.avatarUrl }]))

    const likeCountByCommentId = new Map<string, number>()
    const likedByMeCommentIds = new Set<string>()
    for (const reaction of reactionsResult.data ?? []) {
      if (reaction.reaction !== 'like') continue
      likeCountByCommentId.set(reaction.comment_id, (likeCountByCommentId.get(reaction.comment_id) ?? 0) + 1)
      if (reaction.user_id === currentUser?.id) likedByMeCommentIds.add(reaction.comment_id)
    }

    const rootsById = new Map<string, CommentRow>()
    const parsedRows = commentsResult.data ?? []
    for (const row of parsedRows) {
      if (row.parent_comment_id) continue
      const profile = profileMap.get(row.author_id ?? '') ?? fallbackProfileMap.get(row.author_id ?? '')
      const parsed = parseCommentContent(row.content ?? '')
      rootsById.set(row.id, {
        id: row.id,
        content: parsed.text,
        created_at: row.created_at,
        authorId: row.author_id ?? '',
        author: profile?.name ?? 'Unknown user',
        authorAvatarUrl: profile?.avatarUrl,
        voiceDataUrl: parsed.voiceDataUrl,
        voiceStorageKey: parsed.voiceStorageKey,
        voiceDurationMs: parsed.voiceDurationMs,
        likes: likeCountByCommentId.get(row.id) ?? 0,
        likedByMe: likedByMeCommentIds.has(row.id),
        replies: [],
      })
    }
    for (const row of parsedRows) {
      if (!row.parent_comment_id) continue
      const parent = rootsById.get(row.parent_comment_id)
      if (!parent) continue
      const profile = profileMap.get(row.author_id ?? '') ?? fallbackProfileMap.get(row.author_id ?? '')
      const parsed = parseCommentContent(row.content ?? '')
      parent.replies.push({
        id: row.id,
        authorId: row.author_id ?? '',
        author: profile?.name ?? 'Unknown user',
        authorAvatarUrl: profile?.avatarUrl,
        content: parsed.text ?? '',
        createdAt: formatCommentTime(row.created_at),
      })
    }
    const parsedComments = Array.from(rootsById.values())
    setComments(parsedComments)
    taskCacheRef.current.set(id, {
      updatedAt: Date.now(),
      task: taskResult.data,
      recurrence: recurrenceResult.data ?? null,
      assigneeIds: (assigneesResult.data ?? []).map((row) => row.assignee_id),
      subtasks: subtasksResult.data ?? [],
      comments: parsedComments,
    })

    const unresolved = parsedComments.filter((comment) => comment.voiceStorageKey && !comment.voiceDataUrl)
    if (unresolved.length > 0) {
      void Promise.all(
        unresolved.map(async (comment) => {
          if (!comment.voiceStorageKey) return null
          try {
            const url = await resolveR2ObjectUrl(comment.voiceStorageKey)
            return { id: comment.id, url }
          } catch {
            return null
          }
        }),
      ).then((resolved) => {
        const map = new Map(
          resolved
            .filter((item): item is { id: string; url: string } => Boolean(item?.id && item.url))
            .map((item) => [item.id, item.url]),
        )
        if (map.size > 0) {
          setComments((current) => current.map((comment) => ({ ...comment, voiceDataUrl: map.get(comment.id) ?? comment.voiceDataUrl })))
        }
        setLoadingComments(false)
      })
    } else {
      setLoadingComments(false)
    }

    setLoadingTask(false)
  }

  useEffect(() => {
    const pendingTaskId = consumePendingTaskDetailsModalId()
    if (pendingTaskId) {
      setTaskId(pendingTaskId)
      setOpen(true)
    }
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<OpenTaskModalEventDetail>).detail
      const consumedTaskId = consumePendingTaskDetailsModalId()
      const nextTaskId = consumedTaskId ?? detail?.taskId
      if (!nextTaskId) return
      setTaskId(nextTaskId)
      setOpen(true)
    }
    window.addEventListener('contas:open-task-modal', handler as EventListener)
    return () => window.removeEventListener('contas:open-task-modal', handler as EventListener)
  }, [])

  useEffect(() => {
    if (open || taskId) return
    const pendingTaskId = peekPendingTaskDetailsModalId()
    if (!pendingTaskId) return
    const nextTaskId = consumePendingTaskDetailsModalId()
    if (!nextTaskId) return
    setTaskId(nextTaskId)
    setOpen(true)
  }, [open, taskId])

  useEffect(() => {
    if (!open || !taskId) return
    void loadTask(taskId)
  }, [open, taskId])

  useEffect(
    () => () => {
      if (pendingVoiceComment) URL.revokeObjectURL(pendingVoiceComment.previewUrl)
      stopRecordingVisualizer()
      if (saveStateResetTimerRef.current !== null) {
        window.clearTimeout(saveStateResetTimerRef.current)
      }
    },
    [pendingVoiceComment, stopRecordingVisualizer],
  )

  const saveTask = async (next: TaskRow, nextAssigneeIds: string[], persistAssignees = false) => {
    if (!taskId || !canEdit) return
    const previousTask = task
    const previousAssigneeIds = assigneeIds
    setSaveState('syncing')
    if (saveStateResetTimerRef.current !== null) {
      window.clearTimeout(saveStateResetTimerRef.current)
      saveStateResetTimerRef.current = null
    }
    const { error: taskError } = await supabase
      .from('tasks')
      .update({
        title: next.title.trim() || 'Untitled task',
        description: next.description?.trim() || null,
        status_id: next.status_id ?? null,
        status: next.status ?? 'planned',
        priority: next.priority ?? 'low',
        project_id: next.project_id || null,
        start_at: next.start_at,
        due_at: next.due_at,
        board_column: next.board_column,
        completed_at: next.completed_at,
      })
      .eq('id', taskId)

    if (!taskError) {
      if (persistAssignees) {
        await supabase.from('task_assignees').delete().eq('task_id', taskId)
        if (nextAssigneeIds.length > 0) {
          await supabase.from('task_assignees').insert(nextAssigneeIds.map((assigneeId) => ({ task_id: taskId, assignee_id: assigneeId })))
        }
      }

      if (currentUser?.id) {
        if (persistAssignees) {
          const addedAssigneeIds = nextAssigneeIds.filter((assigneeId) => !previousAssigneeIds.includes(assigneeId) && assigneeId !== currentUser.id)
          if (addedAssigneeIds.length > 0) {
            const notifications = addedAssigneeIds.map((recipientId) => ({
              id: crypto.randomUUID(),
              recipient_id: recipientId,
              actor_id: currentUser.id,
              task_id: taskId,
              type: 'task' as const,
              title: 'Task assigned to you',
              message: `You were assigned "${next.title || previousTask?.title || 'a task'}".`,
              metadata: { event: 'task_assigned', source: 'global_task_modal_assignment' },
            }))
            const { error: notificationsError } = await supabase.from('notifications').insert(notifications)
            if (notificationsError) {
              console.error('Failed to create assignment notifications from global task modal', notificationsError)
            } else {
              void dispatchNotificationEmails(
                notifications.map((item) => ({
                    notificationId: item.id,
                    recipientId: item.recipient_id,
                    recipientEmail: members.find((member) => member.id === item.recipient_id)?.email ?? undefined,
                    type: 'task_assigned' as const,
                    taskId: item.task_id as string,
                    taskTitle: next.title || previousTask?.title || 'a task',
                    actorName: currentUser.name ?? currentUser.email ?? 'A teammate',
                  })),
              )
            }
          }
        }

      }

      setTask(next)
      setAssigneeIds(nextAssigneeIds)
      setSaveState('saved')
      saveStateResetTimerRef.current = window.setTimeout(() => {
        setSaveState('idle')
        saveStateResetTimerRef.current = null
      }, 1400)
    } else {
      setSaveState('error')
    }
  }

  const handleSubtaskCreated = (created: CreatedTaskPayload) => {
    if (!taskId) return
    if (created.parentTaskId !== taskId) return
    setSubtasks((current) => [{ id: created.id, title: created.title, status: created.status ?? created.statusKey ?? null }, ...current])
    void loadTask(taskId)
  }

  const startVoiceCommentRecording = async () => {
    if (isRecordingVoiceComment) return
    setVoiceCommentError(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceCommentError('Voice recording is not supported in this browser.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      commentMicStreamRef.current = stream
      commentVoiceChunksRef.current = []
      commentVoiceStartAtRef.current = Date.now()
      setRecordingElapsedMs(0)

      const audioContext = new AudioContext()
      commentAudioContextRef.current = audioContext
      const source = audioContext.createMediaStreamSource(stream)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 128
      analyser.smoothingTimeConstant = 0.85
      source.connect(analyser)
      const frequencyData = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        analyser.getByteFrequencyData(frequencyData)
        const bucketSize = Math.max(1, Math.floor(frequencyData.length / RECORDING_VISUALIZER_BARS))
        const nextLevels = Array.from({ length: RECORDING_VISUALIZER_BARS }, (_, barIndex) => {
          const start = barIndex * bucketSize
          const end = Math.min(frequencyData.length, start + bucketSize)
          let sum = 0
          for (let i = start; i < end; i += 1) sum += frequencyData[i]
          const avg = sum / Math.max(1, end - start)
          return Math.max(0.12, avg / 255)
        })
        setRecordingLevels(nextLevels)
        setRecordingElapsedMs(Date.now() - commentVoiceStartAtRef.current)
        commentAnimationFrameRef.current = requestAnimationFrame(tick)
      }
      commentAnimationFrameRef.current = requestAnimationFrame(tick)

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) commentVoiceChunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        const durationMs = Date.now() - commentVoiceStartAtRef.current
        const mimeType = recorder.mimeType || 'audio/webm'
        const fileExt = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('wav') ? 'wav' : mimeType.includes('mp4') ? 'm4a' : 'webm'
        const file = new File([new Blob(commentVoiceChunksRef.current, { type: mimeType })], `voice-${Date.now()}.${fileExt}`, { type: mimeType })
        const previewUrl = URL.createObjectURL(file)
        setPendingVoiceComment((current) => {
          if (current) URL.revokeObjectURL(current.previewUrl)
          return { file, previewUrl, durationMs }
        })
        stopRecordingVisualizer()
        commentMediaRecorderRef.current = null
        setIsRecordingVoiceComment(false)
      }

      commentMediaRecorderRef.current = recorder
      recorder.start()
      setIsRecordingVoiceComment(true)
    } catch {
      setVoiceCommentError('Microphone permission is required to record voice.')
      setIsRecordingVoiceComment(false)
      commentMediaRecorderRef.current = null
      stopRecordingVisualizer()
      setRecordingElapsedMs(0)
    }
  }

  const stopVoiceCommentRecording = () => {
    const recorder = commentMediaRecorderRef.current
    if (!recorder) return
    if (recorder.state !== 'inactive') recorder.stop()
  }

  const submitComment = async () => {
    if (!taskId || !currentUser?.id) return
    const contentText = commentDraft.trim()
    if (!contentText && !pendingVoiceComment) return

    let uploadedVoice: { key: string; url: string } | null = null
    if (pendingVoiceComment) {
      try {
        uploadedVoice = await uploadTaskCommentVoiceToR2(pendingVoiceComment.file)
      } catch (error) {
        setVoiceCommentError(error instanceof Error ? error.message : 'Voice upload failed.')
        return
      }
    }

    const content =
      uploadedVoice || pendingVoiceComment
        ? serializeCommentContent(contentText, {
            voiceDataUrl: uploadedVoice?.url,
            voiceStorageKey: uploadedVoice?.key,
            durationMs: pendingVoiceComment?.durationMs,
          })
        : contentText

    const { error } = await supabase.from('task_comments').insert({
      task_id: taskId,
      author_id: currentUser.id,
      content,
      parent_comment_id: null,
    })

    if (!error) {
      if (contentText) {
        const mentionedMemberIds = extractMentionedMemberIds(contentText, members).filter((memberId) => memberId !== currentUser.id)
        if (mentionedMemberIds.length > 0) {
          const mentionNotifications = mentionedMemberIds.map((recipientId) => ({
            id: crypto.randomUUID(),
            recipient_id: recipientId,
            actor_id: currentUser.id,
            task_id: taskId,
            type: 'mention' as const,
            title: 'You were mentioned',
            message: `You were mentioned in "${task?.title ?? 'a task'}".`,
            metadata: { event: 'task_mentioned', source: 'global_task_modal_comment' },
          }))
          const { error: mentionNotificationsError } = await supabase.from('notifications').insert(mentionNotifications)
          if (mentionNotificationsError) {
            console.error('Failed to create mention notifications from global task modal', mentionNotificationsError)
          } else {
            void dispatchNotificationEmails(
          mentionNotifications.map((item) => ({
                  notificationId: item.id,
                  recipientId: item.recipient_id,
                  recipientEmail: members.find((member) => member.id === item.recipient_id)?.email ?? undefined,
                  type: 'mention' as const,
                  taskId: item.task_id as string,
                  taskTitle: task?.title ?? 'a task',
                  messagePreview: contentText,
                  actorName: currentUser.name ?? currentUser.email ?? 'A teammate',
                })),
            )
          }
        }
      }
      setCommentDraft('')
      setPendingVoiceComment((current) => {
        if (current) URL.revokeObjectURL(current.previewUrl)
        return null
      })
      await loadTask(taskId)
    }
  }

  const toggleCommentLike = async (commentId: string) => {
    if (!currentUser?.id || !taskId) return
    if (pendingLikeCommentIdsRef.current.has(commentId)) return

    pendingLikeCommentIdsRef.current.add(commentId)

    let wasLikedByMe = false
    setComments((current) =>
      current.map((comment) => {
        if (comment.id !== commentId) return comment
        wasLikedByMe = comment.likedByMe
        const likedByMe = !comment.likedByMe
        const likes = Math.max(0, comment.likes + (likedByMe ? 1 : -1))
        return { ...comment, likedByMe, likes }
      }),
    )

    if (wasLikedByMe) {
      const { error } = await supabase
        .from('task_comment_reactions')
        .delete()
        .eq('comment_id', commentId)
        .eq('user_id', currentUser.id)
        .eq('reaction', 'like')
      if (!error) {
        pendingLikeCommentIdsRef.current.delete(commentId)
        return
      }
      console.error('Failed to remove like', error)
    } else {
      const { error } = await supabase.from('task_comment_reactions').insert({
        comment_id: commentId,
        user_id: currentUser.id,
        reaction: 'like',
      })
      if (!error) {
        pendingLikeCommentIdsRef.current.delete(commentId)
        return
      }
      console.error('Failed to add like', error)
    }

    setComments((current) =>
      current.map((comment) => {
        if (comment.id !== commentId) return comment
        const likedByMe = !comment.likedByMe
        const likes = Math.max(0, comment.likes + (likedByMe ? 1 : -1))
        return { ...comment, likedByMe, likes }
      }),
    )
    pendingLikeCommentIdsRef.current.delete(commentId)
  }

  const addReplyToComment = async (commentId: string) => {
    if (!taskId || !currentUser?.id) return
    const content = (replyDraftByCommentId[commentId] ?? '').trim()
    if (!content) return

    const { data, error } = await supabase
      .from('task_comments')
      .insert({
        task_id: taskId,
        author_id: currentUser.id,
        content,
        parent_comment_id: commentId,
      })
      .select('id, author_id, content, created_at')
      .single()

    if (error || !data) {
      console.error('Failed to add reply', error)
      return
    }

    const author = currentUserMember?.name ?? 'You'
    const authorAvatarUrl = currentUserMember?.avatarUrl
    setComments((current) =>
      current.map((comment) =>
        comment.id === commentId
          ? {
              ...comment,
              replies: [
                {
                  id: data.id,
                  authorId: data.author_id ?? currentUser.id,
                  author,
                  authorAvatarUrl,
                  content: data.content ?? '',
                  createdAt: formatCommentTime(data.created_at),
                },
                ...comment.replies,
              ],
            }
          : comment,
      ),
    )
    setReplyDraftByCommentId((drafts) => ({ ...drafts, [commentId]: '' }))
    setActiveReplyCommentId(null)
    void loadTask(taskId)

    const mentionedMemberIds = extractMentionedMemberIds(content, members).filter((memberId) => memberId !== currentUser.id)
    if (mentionedMemberIds.length > 0) {
      const mentionNotifications = mentionedMemberIds.map((recipientId) => ({
        id: crypto.randomUUID(),
        recipient_id: recipientId,
        actor_id: currentUser.id,
        task_id: taskId,
        type: 'mention' as const,
        title: 'You were mentioned in a reply',
        message: `You were mentioned in \"${task?.title ?? 'a task'}\".`,
        metadata: { event: 'task_mentioned', source: 'task_reply' },
      }))
      const { error: mentionNotificationsError } = await supabase.from('notifications').insert(mentionNotifications)
      if (mentionNotificationsError) {
        console.error('Failed to create reply mention notifications', mentionNotificationsError)
      } else {
        void dispatchNotificationEmails(
          mentionNotifications.map((item) => ({
              notificationId: item.id,
              recipientId: item.recipient_id,
              recipientEmail: members.find((member) => member.id === item.recipient_id)?.email ?? undefined,
              type: 'mention' as const,
              taskId: item.task_id as string,
              taskTitle: task?.title ?? 'a task',
              messagePreview: content,
              actorName: currentUser.name ?? currentUser.email ?? 'A teammate',
            })),
        )
      }
    }
  }

  const formatCommentTime = (value: string | null) => {
    if (!value) return 'Just now'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return 'Just now'
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date)
  }

  const currentUserMember = members.find((member) => member.id === currentUser?.id)
  const teammateMembers = useMemo(() => members.filter((member) => member.id !== currentUser?.id), [currentUser?.id, members])
  const commentMentionOptions = useMemo(
    () => teammateMembers.map((member) => ({ id: member.id, name: member.name, username: member.username ?? undefined })),
    [teammateMembers],
  )
  const selectedAssignees = assigneeIds
    .map((id) => members.find((member) => member.id === id))
    .filter((member): member is Member => Boolean(member))
  const missingMentionEmails = useMemo(() => {
    if (!task?.description) return []
    if (members.length === 0) return []
    const mentionedIds = extractMentionedMemberIds(task.description, members)
    if (mentionedIds.length === 0) return []
    return mentionedIds
      .map((id) => members.find((member) => member.id === id))
      .filter((member): member is Member => Boolean(member && !member.email))
      .map((member) => member.name)
  }, [members, task?.description])
  const flushDescriptionMentionNotificationsOnClose = useCallback(async () => {
    const latestTask = latestTaskRef.current
    if (!latestTask || !taskId || !currentUser?.id) return

    const memberDirectory =
      members.length > 0
        ? members
        : (
            (await supabase
              .from('profiles')
              .select('id, full_name, username, email, avatar_url')
              .order('full_name', { ascending: true })).data ?? []
          ).map((profile) => ({
            id: profile.id,
            name: profile.full_name ?? profile.email ?? 'Unknown user',
            username: profile.username ?? undefined,
            email: profile.email ?? undefined,
            avatarUrl: profile.avatar_url ?? undefined,
          }))

    const initialMentionedMemberIds = extractMentionedMemberIds(mentionSessionInitialDescriptionRef.current, memberDirectory).filter(
      (memberId) => memberId !== currentUser.id,
    )
    const finalMentionedMemberIds = extractMentionedMemberIds(latestTask.description ?? '', memberDirectory).filter(
      (memberId) => memberId !== currentUser.id,
    )
    const addedMentionIds = finalMentionedMemberIds.filter((memberId) => !initialMentionedMemberIds.includes(memberId))
    if (addedMentionIds.length === 0) return

    const mentionNotifications = addedMentionIds.map((recipientId) => ({
      id: crypto.randomUUID(),
      recipient_id: recipientId,
      actor_id: currentUser.id,
      task_id: taskId,
      type: 'mention' as const,
      title: 'You were mentioned',
      message: `You were mentioned in "${latestTask.title || 'a task'}".`,
      metadata: { event: 'task_mentioned', source: 'global_task_modal_description_close' },
    }))
    const { data: createdNotifications, error } = await supabase
      .from('notifications')
      .insert(mentionNotifications)
      .select('id, recipient_id, task_id')
    if (error) {
      console.error('Failed to create mention notifications on task modal close', error)
      return
    }
    const created = createdNotifications ?? []
    if (created.length === 0) return
    void dispatchNotificationEmails(
      created.map((item) => ({
        notificationId: item.id,
        recipientId: item.recipient_id,
        recipientEmail: memberDirectory.find((member) => member.id === item.recipient_id)?.email ?? undefined,
        type: 'mention' as const,
        taskId: item.task_id,
        taskTitle: latestTask.title || 'a task',
        actorName: currentUser.name ?? currentUser.email ?? 'A teammate',
      })),
    )
  }, [currentUser?.email, currentUser?.id, currentUser?.name, members, taskId])
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        void flushDescriptionMentionNotificationsOnClose()
      }

      if (!nextOpen) {
        mentionSessionTaskIdRef.current = null
        mentionSessionInitialDescriptionRef.current = ''
      }
      setOpen(nextOpen)
    },
    [flushDescriptionMentionNotificationsOnClose],
  )

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showClose={!loadingTask}
        disableAnimations
        className={cn('max-h-[90vh] max-w-4xl overflow-hidden p-0', loadingTask && 'border-0 bg-transparent shadow-none')}
      >
        <DialogTitle className='sr-only'>Task details dialog</DialogTitle>
        <DialogDescription className='sr-only'>
          View and update task details, assignees, subtasks, and comments.
        </DialogDescription>
        {loadingTask ? <TaskDetailsLoadingIndicator /> : null}
        {!loadingTask && loadError ? <div className='p-6 text-sm text-destructive'>{loadError}</div> : null}
        {!loadingTask && !loadError && task ? (
          <div className='flex max-h-[90vh] min-h-0 flex-col'>
            <DialogHeader className='border-b border-border/35 px-4 py-3'>
              <div className='flex items-center gap-3'>
                <div className='flex min-w-0 items-center gap-2'>
                  <DialogTitle className='shrink-0'>Task Details</DialogTitle>
                  <div className='flex h-6 w-[110px] shrink-0 items-center'>
                    <GlobalSaveStatus state={saveState} className='h-6 w-full justify-center whitespace-nowrap px-2 text-xs' />
                  </div>
                </div>
              </div>
              <div className='mt-0.5'>
                  <DialogDescription>{statusLabelFromKey(task.status)}</DialogDescription>
              </div>
            </DialogHeader>

            <div className='grid min-h-0 flex-1 lg:grid-cols-[minmax(0,2.1fr)_360px]'>
              <div className='flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain border-r border-border/35 p-4'>
                <div className='flex flex-1 flex-col gap-4'>
                <div className='relative'>
                  <Input
                    value={task.title}
                    onChange={(event) => setTask((current) => (current ? { ...current, title: event.target.value } : current))}
                    onBlur={() => task && void saveTask(task, assigneeIds)}
                    placeholder='Task title'
                    readOnly={!canEdit}
                    className={cn('h-11 text-lg font-semibold', !canEdit && 'pr-10')}
                  />
                  {!canEdit ? (
                    <span className='pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground' title='Only task creator can edit details'>
                      <Lock className='h-4 w-4' aria-hidden='true' />
                    </span>
                  ) : null}
                </div>

                <div className='grid gap-3 md:grid-cols-2'>
                  <div>
                    <p className='mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>Start Date</p>
                    <DatePicker
                      value={task.start_at ? new Date(task.start_at) : undefined}
                      onChange={(date) => setTask((current) => (current ? { ...current, start_at: date ? date.toISOString() : null } : current))}
                      className='h-10'
                      disabled={!canEdit}
                    />
                  </div>
                  <div>
                    <p className='mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>Due Date</p>
                    <DatePicker
                      value={task.due_at ? new Date(task.due_at) : undefined}
                      onChange={(date) => setTask((current) => (current ? { ...current, due_at: date ? date.toISOString() : null } : current))}
                      className='h-10'
                      disabled={!canEdit}
                    />
                  </div>
                </div>

                {task.recurrence_id ? (
                  <div className='rounded-md border border-dashed border-border/70 bg-muted/20 px-3 py-3'>
                    <div className='flex items-center gap-2'>
                      <Repeat2 className='h-4 w-4 text-muted-foreground' aria-hidden='true' />
                      <div className='text-sm font-semibold text-foreground'>Recurring task</div>
                    </div>
                    <div className='mt-2 space-y-1 text-xs text-muted-foreground'>
                      <p>{recurrence ? recurrenceCadenceLabel(recurrence) : 'Repeats on a saved schedule.'}</p>
                      {recurrence?.end_on ? <p>Ends on {formatDateOnly(recurrence.end_on)}</p> : <p>No end date set.</p>}
                      {recurrence?.next_run_at ? <p>Next occurrence {formatDateTimeOnly(recurrence.next_run_at)}</p> : null}
                      {recurrence && !recurrence.is_active ? <p>This series is currently inactive.</p> : null}
                    </div>
                  </div>
                ) : null}

                <div className='grid gap-3 md:grid-cols-2'>
                  <div>
                    <p className='mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>Project</p>
                    <select
                      value={task.project_id ?? ''}
                      onChange={(event) => setTask((current) => (current ? { ...current, project_id: event.target.value || null } : current))}
                      onBlur={() => task && void saveTask(task, assigneeIds)}
                      disabled={!canEdit}
                      className='h-10 w-full rounded-md bg-muted/40 px-3 text-sm shadow-[inset_0_0_0_1px_hsl(var(--foreground)/0.04)]'
                    >
                      <option value=''>Unassigned project</option>
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <p className='mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>Status</p>
                    <select
                      value={task.status_id ?? ''}
                      onChange={(event) =>
                        setTask((current) => {
                          if (!current) return current
                          const nextStatus = statusOptions.find((option) => option.id === event.target.value)
                          return {
                            ...current,
                            status_id: nextStatus?.id ?? null,
                            status: nextStatus?.key ?? current.status,
                            board_column: legacyBoardColumnForStatusKey(nextStatus?.key),
                          }
                        })
                      }
                      onBlur={() => task && void saveTask(task, assigneeIds)}
                      disabled={!canEdit}
                      className='h-10 w-full rounded-md bg-muted/40 px-3 text-sm shadow-[inset_0_0_0_1px_hsl(var(--foreground)/0.04)]'
                    >
                      {statusOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className='grid gap-3 md:grid-cols-2'>
                  <div>
                    <p className='mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>Priority</p>
                    <select
                      value={task.priority ?? 'low'}
                      onChange={(event) => setTask((current) => (current ? { ...current, priority: event.target.value } : current))}
                      onBlur={() => task && void saveTask(task, assigneeIds)}
                      disabled={!canEdit}
                      className='h-10 w-full rounded-md bg-muted/40 px-3 text-sm shadow-[inset_0_0_0_1px_hsl(var(--foreground)/0.04)]'
                    >
                      <option value='low'>Low priority</option>
                      <option value='medium'>Medium priority</option>
                      <option value='high'>High priority</option>
                      <option value='urgent'>Urgent priority</option>
                    </select>
                  </div>
                  <div>
                    <p className='mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>Completion</p>
                    <Button
                      type='button'
                      variant='outline'
                      className={cn('h-10 justify-start gap-2', task.completed_at ? 'border-emerald-400 bg-emerald-500/10 text-emerald-500' : '')}
                      disabled={!canEdit}
                      onClick={() => {
                        const markingComplete = !task.completed_at
                        const doneStatus = statusOptions.find((option) => option.key === 'done')
                        const next = {
                          ...task,
                          completed_at: markingComplete ? new Date().toISOString() : null,
                          status_id: markingComplete ? (doneStatus?.id ?? task.status_id) : task.status_id,
                          status: markingComplete ? (doneStatus?.key ?? task.status) : task.status,
                          board_column: markingComplete ? legacyBoardColumnForStatusKey(doneStatus?.key) : task.board_column,
                        }
                        setTask(next)
                        void saveTask(next, assigneeIds)
                      }}
                    >
                      <Check className='h-4 w-4' />
                      {task.completed_at ? 'Completed' : 'Open'}
                    </Button>
                  </div>
                </div>

                <div className='rounded-md bg-muted/30 p-2 shadow-[inset_0_0_0_1px_hsl(var(--foreground)/0.04)]'>
                  <div className='flex min-h-11 items-center justify-between gap-2'>
                    <div className='flex min-w-0 flex-1 flex-wrap items-center gap-1.5'>
                      {selectedAssignees.length === 0 ? (
                        <p className='px-1 text-sm text-muted-foreground'>No assignees selected.</p>
                      ) : (
                        selectedAssignees.map((member) => (
                          <span key={member.id} className='inline-flex items-center gap-2 rounded-full border bg-background px-2.5 py-1 text-xs'>
                            <Avatar className='h-5 w-5 border'>
                              {member.avatarUrl ? <AvatarImage src={member.avatarUrl} alt={member.name} /> : null}
                              <AvatarFallback className='text-[9px] font-semibold'>{initials(member.name)}</AvatarFallback>
                            </Avatar>
                            <span className='max-w-28 truncate'>{member.name}</span>
                            <button
                              type='button'
                              disabled={!canEdit}
                              onClick={() => {
                                const nextIds = assigneeIds.filter((id) => id !== member.id)
                                setAssigneeIds(nextIds)
                                void saveTask(task, nextIds, true)
                              }}
                              className='inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:bg-accent'
                            >
                              <X className='h-3 w-3' />
                            </button>
                          </span>
                        ))
                      )}
                    </div>
                    <Popover open={assigneeOpen} onOpenChange={setAssigneeOpen}>
                      <PopoverTrigger asChild>
                        <Button type='button' size='sm' variant='outline' className='h-8 w-8 rounded-full px-0' disabled={!canEdit}>
                          <UserPlus className='h-4 w-4' />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className='w-72 p-2' align='end'>
                        <div className='max-h-48 space-y-1 overflow-y-auto'>
                          {teammateMembers.map((member) => {
                            const selected = assigneeIds.includes(member.id)
                            return (
                              <button
                                key={member.id}
                                type='button'
                                onClick={() => {
                                  const nextIds = selected ? assigneeIds.filter((id) => id !== member.id) : [...assigneeIds, member.id]
                                  setAssigneeIds(nextIds)
                                  void saveTask(task, nextIds, true)
                                }}
                                className={cn('flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent', selected ? 'bg-accent' : '')}
                              >
                                <span>{member.name}</span>
                                {selected ? <Check className='h-4 w-4' /> : null}
                              </button>
                            )
                          })}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>

                <div className='rounded-md bg-muted/20 p-2.5 shadow-[inset_0_0_0_1px_hsl(var(--foreground)/0.04)]'>
                  <p className='mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>Subtasks ({subtasks.length})</p>
                  {subtasks.length === 0 ? (
                    <p className='text-sm text-muted-foreground'>No subtasks yet.</p>
                  ) : (
                    <div className='space-y-1.5'>
                      {subtasks.map((subtask) => (
                        <div key={subtask.id} className='rounded-md border bg-background px-2 py-1.5 text-sm'>
                          {subtask.title}
                        </div>
                      ))}
                    </div>
                  )}
                  <Button
                    type='button'
                    size='sm'
                    variant='outline'
                    className='mt-2 gap-1.5'
                    onClick={() => setCreateSubtaskOpen(true)}
                    disabled={!task}
                  >
                    <PlusCircle className='h-3.5 w-3.5' />
                    Add subtask
                  </Button>
                </div>

                <div className='mt-auto flex min-h-[220px] flex-1 flex-col space-y-1.5'>
                  <p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>Description</p>
                  <div className='relative flex min-h-0 flex-1'>
                    <MentionRichTextEditor
                      value={task.description ?? ''}
                      onChange={(nextDescription) => {
                        setAssigneeOpen(false)
                        setTask((current) => (current ? { ...current, description: nextDescription } : current))
                      }}
                      onBlur={() => task && void saveTask(task, assigneeIds)}
                      mentionOptions={teammateMembers.map((member) => ({ id: member.id, name: member.name, username: member.username ?? undefined }))}
                      placeholder='Describe the task...'
                      disabled={!canEdit}
                      minHeightClassName='min-h-[180px]'
                      className='h-full'
                    />
                  </div>
                  {missingMentionEmails.length > 0 ? (
                    <p className='text-xs text-amber-300'>
                      Email missing for: {missingMentionEmails.join(', ')}.
                    </p>
                  ) : null}
                </div>
                </div>
              </div>

              <aside className='flex min-h-0 flex-col bg-muted/15'>
                <div className='border-b border-border/35 px-3 py-3'>
                  <div className='inline-flex items-center gap-1 text-sm font-semibold'>
                    <MessageSquare className='h-4 w-4' />
                    Comments
                  </div>
                </div>
                <div className='min-h-0 flex-1'>
                  <div className='h-full space-y-3 overflow-y-auto px-3 py-3'>
                    {loadingComments && comments.length === 0 ? (
                      <>
                        <div className='animate-pulse space-y-2 rounded-md border bg-background/70 p-2.5'>
                          <div className='h-3 w-28 rounded bg-muted/70' />
                          <div className='h-3 w-full rounded bg-muted/70' />
                          <div className='h-3 w-2/3 rounded bg-muted/70' />
                        </div>
                        <div className='animate-pulse space-y-2 rounded-md border bg-background/70 p-2.5'>
                          <div className='h-3 w-32 rounded bg-muted/70' />
                          <div className='h-3 w-5/6 rounded bg-muted/70' />
                          <div className='h-3 w-1/2 rounded bg-muted/70' />
                        </div>
                      </>
                    ) : comments.length === 0 ? (
                      <p className='text-xs text-muted-foreground'>No comments yet.</p>
                    ) : (
                      comments.map((comment) => (
                        <article key={comment.id} className='rounded-md px-1 py-1.5'>
                          <div className='flex gap-2'>
                            <Avatar className='mt-0.5 h-7 w-7 border'>
                              {comment.authorAvatarUrl ? <AvatarImage src={comment.authorAvatarUrl} alt={comment.author} /> : null}
                              <AvatarFallback className='text-[10px] font-semibold'>{initials(comment.author)}</AvatarFallback>
                            </Avatar>
                            <div className='min-w-0 flex-1'>
                              <div className='flex items-center gap-1 text-xs'>
                                <span className='font-semibold text-foreground'>{comment.author}</span>
                                <span className='text-muted-foreground'>· {formatCommentTime(comment.created_at)}</span>
                              </div>
                              {comment.content ? <p className='mt-1 whitespace-pre-wrap text-sm leading-5 text-foreground'>{comment.content}</p> : null}
                              {comment.voiceDataUrl ? (
                                <div className='mt-2 space-y-1'>
                                  <VoicePlayback src={comment.voiceDataUrl} durationMs={comment.voiceDurationMs} />
                                  <p className='text-[11px] text-muted-foreground'>Voice message · {formatVoiceDuration(comment.voiceDurationMs)}</p>
                                </div>
                              ) : null}
                              <div className='mt-2 flex items-center gap-1'>
                                <button
                                  type='button'
                                  onClick={() => void toggleCommentLike(comment.id)}
                                  className={cn(
                                    'inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-300',
                                    comment.likedByMe ? 'text-rose-300' : '',
                                  )}
                                >
                                  <Heart className={cn('h-3.5 w-3.5', comment.likedByMe ? 'fill-current' : '')} />
                                  <span>{comment.likes > 0 ? comment.likes : 'Like'}</span>
                                </button>
                                <button
                                  type='button'
                                  onClick={() => setActiveReplyCommentId((current) => (current === comment.id ? null : comment.id))}
                                  className='inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-sky-500/10 hover:text-sky-300'
                                >
                                  <MessageCircle className='h-3.5 w-3.5' />
                                  <span>{comment.replies.length > 0 ? `Reply ${comment.replies.length}` : 'Reply'}</span>
                                </button>
                              </div>
                              {comment.replies.length > 0 ? (
                                <div className='mt-2 space-y-2 border-l border-border/70 pl-2.5'>
                                  {comment.replies.map((reply) => (
                                    <div key={reply.id} className='rounded-md bg-background/40 px-2 py-1.5'>
                                      <div className='flex items-center gap-1 text-[11px]'>
                                        <span className='font-medium text-foreground'>{reply.author}</span>
                                        <span className='text-muted-foreground'>· {reply.createdAt}</span>
                                      </div>
                                      <p className='mt-0.5 whitespace-pre-wrap text-xs text-foreground'>{reply.content}</p>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                              {activeReplyCommentId === comment.id ? (
                                <div className='mt-2 flex items-start gap-2'>
                                  <div className='relative min-w-0 flex-1'>
                                    <MentionRichTextEditor
                                      value={replyDraftByCommentId[comment.id] ?? ''}
                                      onChange={(nextReply) =>
                                        setReplyDraftByCommentId((drafts) => ({ ...drafts, [comment.id]: nextReply }))
                                      }
                                      onKeyDown={(event) => {
                                        if (event.key === 'Enter' && !event.shiftKey) {
                                          event.preventDefault()
                                          void addReplyToComment(comment.id)
                                        }
                                      }}
                                      mentionOptions={commentMentionOptions}
                                      placeholder='Write a reply...'
                                      minHeightClassName='min-h-[2.75rem]'
                                      className='h-auto max-h-32 rounded-md text-sm leading-5'
                                    />
                                  </div>
                                  <Button
                                    type='button'
                                    size='sm'
                                    variant='outline'
                                    className='h-8 w-8 shrink-0 px-0'
                                    onClick={() => void addReplyToComment(comment.id)}
                                    aria-label='Send reply'
                                  >
                                    <Send className='h-3.5 w-3.5' />
                                  </Button>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </article>
                      ))
                    )}

                    <div className='border-t border-border/35 pt-3'>
                      <div className='inline-flex items-center gap-1 text-sm font-semibold'>
                        <Activity className='h-4 w-4' />
                        Activity
                      </div>
                      <div className='mt-2 space-y-2'>
                        <div className='relative border-l pl-3 text-xs'>
                          <span className='absolute -left-[4px] top-1.5 h-1.5 w-1.5 rounded-full bg-muted-foreground/70' />
                          <p className='text-foreground'>Loaded from task database</p>
                          <p className='text-[11px] text-muted-foreground'>{formatCommentTime(new Date().toISOString())}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className='border-t border-border/35 px-3 py-3'>
                  <div className='space-y-2'>
                    {pendingVoiceComment ? (
                      <div className='rounded-md border bg-background/70 p-2'>
                        <div className='flex items-center justify-between gap-2'>
                          <p className='text-xs text-muted-foreground'>Voice message ready · {formatVoiceDuration(pendingVoiceComment.durationMs)}</p>
                          <button
                            type='button'
                            onClick={() =>
                              setPendingVoiceComment((current) => {
                                if (current) URL.revokeObjectURL(current.previewUrl)
                                return null
                              })
                            }
                            className='inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground'
                            aria-label='Remove voice message'
                          >
                            <X className='h-3.5 w-3.5' />
                          </button>
                        </div>
                        <div className='mt-1'>
                          <VoicePlayback src={pendingVoiceComment.previewUrl} durationMs={pendingVoiceComment.durationMs} />
                        </div>
                      </div>
                    ) : null}
                    {voiceCommentError ? <p className='text-xs text-rose-300'>{voiceCommentError}</p> : null}
                    <div className='flex items-end gap-2'>
                      <Avatar className='h-9 w-9 border'>
                        {currentUserMember?.avatarUrl ? <AvatarImage src={currentUserMember.avatarUrl} alt={currentUserMember.name} /> : null}
                        <AvatarFallback className='text-[10px] font-semibold'>{initials(currentUserMember?.name ?? 'Me')}</AvatarFallback>
                      </Avatar>
                      <div className='min-w-0 flex-1 overflow-visible rounded-2xl border border-border/70 bg-background/80 shadow-sm'>
                        {isRecordingVoiceComment ? (
                          <div className='flex min-h-[3.25rem] items-center gap-3 px-3 py-2.5'>
                            <div className='grid h-6 min-w-0 flex-1 items-center gap-[2px]' style={{ gridTemplateColumns: `repeat(${recordingLevels.length}, minmax(0, 1fr))` }}>
                              {recordingLevels.map((level, index) => (
                                <span key={index} className='w-[2px] justify-self-center rounded-full bg-foreground/85' style={{ height: `${Math.max(4, Math.round(level * 11)) * 2}px` }} />
                              ))}
                            </div>
                            <span className='text-sm font-medium tabular-nums text-muted-foreground'>{formatVoiceDuration(recordingElapsedMs)}</span>
                            <button
                              type='button'
                              className='inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border/70 bg-muted/25 text-foreground transition-colors hover:bg-muted/40'
                              onClick={stopVoiceCommentRecording}
                              aria-label='Stop recording'
                            >
                              <Square className='h-3 w-3' />
                            </button>
                          </div>
                        ) : (
                          <div>
                            <MentionRichTextEditor
                              value={commentDraft}
                              onChange={setCommentDraft}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' && !event.shiftKey) {
                                  event.preventDefault()
                                  void submitComment()
                                }
                              }}
                              mentionOptions={commentMentionOptions}
                              placeholder='Add a comment...'
                              minHeightClassName='min-h-[3.25rem]'
                              className='h-auto max-h-36 border-0 bg-transparent px-3 py-2.5 text-sm leading-5 shadow-none focus:border-transparent focus:ring-0 focus:ring-offset-0'
                            />
                            <div className='flex items-center justify-between gap-2 border-t border-border/50 px-2.5 py-2'>
                              <div className='flex items-center gap-1'>
                                <Popover open={commentEmojiOpen} onOpenChange={setCommentEmojiOpen}>
                                  <PopoverTrigger asChild>
                                    <button
                                      type='button'
                                      className='inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
                                      aria-label='Add emoji'
                                    >
                                      <Smile className='h-4 w-4' />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent className='w-auto p-1.5' align='start'>
                                    <div className='flex items-center gap-1'>
                                      {COMMENT_EMOJIS.map((emoji) => (
                                        <button
                                          key={emoji}
                                          type='button'
                                          onClick={() => {
                                            setCommentDraft((value) => `${value}${emoji}`)
                                            setCommentEmojiOpen(false)
                                          }}
                                          className='inline-flex h-8 w-8 items-center justify-center rounded-md text-base hover:bg-accent'
                                          aria-label={`Insert ${emoji}`}
                                        >
                                          {emoji}
                                        </button>
                                      ))}
                                    </div>
                                  </PopoverContent>
                                </Popover>
                                <button
                                  type='button'
                                  className='inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
                                  onClick={() => void startVoiceCommentRecording()}
                                  aria-label='Record voice message'
                                >
                                  <Mic className='h-4 w-4' />
                                </button>
                              </div>
                              <Button
                                type='button'
                                size='sm'
                                className='h-8 rounded-full px-3'
                                onClick={() => void submitComment()}
                                disabled={isRecordingVoiceComment || (!commentDraft.trim() && !pendingVoiceComment)}
                                aria-label='Send comment'
                              >
                                <Send className='h-4 w-4' />
                                <span className='ml-1.5 text-sm'>Send</span>
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        ) : null}
        </DialogContent>
      </Dialog>
      <CreateTaskDialog
        open={createSubtaskOpen}
        onOpenChange={setCreateSubtaskOpen}
        onTaskCreated={handleSubtaskCreated}
        initialParentTaskId={task?.id}
        initialTaskType='subtask'
        initialBoardColumn={task?.board_column ?? 'planned'}
        initialProjectId={task?.project_id ?? undefined}
        lockProjectSelection
      />
    </>
  )
}
