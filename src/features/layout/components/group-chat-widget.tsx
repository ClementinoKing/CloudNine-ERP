import {
  Check,
  FileText,
  Download,
  ExternalLink,
  MessageSquareText,
  Mic,
  Maximize2,
  Minimize2,
  Paperclip,
  PencilLine,
  Play,
  Send,
  Square,
  Trash2,
  Users2,
  X,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useLocation } from 'react-router-dom'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { DocumentViewerModal } from '@/components/document-viewer-modal'
import { useAuth } from '@/features/auth/context/auth-context'
import { dispatchNotificationEmails } from '@/features/notifications/lib/email-delivery'
import {
  getAttachmentExtension,
  getDocumentStyle,
  getDocumentTypeLabel,
  getDocumentViewerMode as getAttachmentViewerMode,
  parseCsvText,
  type DocumentViewerMode,
} from '@/lib/document-preview'
import { notify } from '@/lib/notify'
import { optimizeImageFileForUpload, resolveR2ObjectUrl, uploadChatAttachmentToR2, uploadChatVoiceToR2 } from '@/lib/r2'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

type ChatMessage = {
  id: string
  authorId?: string | null
  author: string
  authorHandle?: string
  authorAvatarUrl?: string | null
  role: string
  initials: string
  message: string
  time: string
  createdAt: string
  replyToId?: string | null
  mine?: boolean
  pending?: boolean
  editedAt?: string | null
  deletedAt?: string | null
  clientMessageId?: string | null
  voiceDataUrl?: string | null
  voiceStorageKey?: string | null
  voiceDurationMs?: number | null
  attachments?: Array<ChatAttachmentRow & { publicUrl: string | null; displaySize: string }>
}

type MentionOption = {
  id: string
  name: string
  role: string
  username: string
  avatarUrl?: string | null
}

type ChatRoomRow = {
  id: string
  slug: string
  name: string
  description: string | null
  last_message_at: string | null
}

type ChatProfileRow = {
  id: string
  full_name: string | null
  username: string | null
  avatar_url: string | null
  email: string | null
  role_label: string | null
  job_title: string | null
}

type ChatRoomMemberRow = {
  id: string
  room_id: string
  user_id: string
  member_role: string
  last_read_at: string | null
  created_at: string
}

type ChatRoomTypingStateRow = {
  id: string
  room_id: string
  user_id: string
  is_typing: boolean
  created_at: string
  updated_at: string
}

type ChatMessageRow = {
  id: string
  room_id: string
  author_id: string | null
  body: string
  reply_to_id: string | null
  metadata: Record<string, unknown> | null
  edited_at: string | null
  deleted_at: string | null
  created_at: string
}

type ChatMentionRow = {
  id: string
  message_id: string
  mentioned_user_id: string
  created_at: string
}

type ChatAttachmentRow = {
  id: string
  message_id: string
  storage_bucket: string
  storage_path: string
  file_name: string
  mime_type: string | null
  file_size_bytes: number | null
  attachment_kind: 'image' | 'file'
  metadata: Record<string, unknown> | null
  created_at: string
}

type ChatAttachmentPreviewRow = ChatAttachmentRow & { publicUrl: string | null; displaySize: string }

type ChatComposerAttachment = {
  id: string
  file: File
  name: string
  size: string
  kind: 'image' | 'file'
  preview?: string
}

type ChatComposerVoice = {
  file: File
  previewUrl: string
  durationMs: number
}

type AttachmentViewerState = {
  fileName: string
  displaySize: string
  publicUrl: string | null
  mimeType: string | null
  viewerMode: DocumentViewerMode
}

type ReplyPreviewMessage = {
  id: string
  author: string
  message: string
  voiceDataUrl?: string | null
  attachments?: Array<ChatAttachmentPreviewRow>
}

const GENERAL_CHAT_ROOM_SLUG = 'general'
const MAX_COMPOSER_ATTACHMENTS = 6
const CHAT_ATTACHMENT_ACCEPT =
  'image/*,application/pdf,.pdf,application/msword,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,application/vnd.oasis.opendocument.text,.odt,application/rtf,.rtf,text/rtf,.rtf,application/vnd.ms-excel,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx,text/csv,.csv,application/vnd.oasis.opendocument.spreadsheet,.ods,application/vnd.ms-powerpoint,.ppt,application/vnd.openxmlformats-officedocument.presentationml.presentation,.pptx,application/vnd.oasis.opendocument.presentation,.odp'
const CHAT_ATTACHMENT_ALLOWED_EXTENSIONS = new Set([
  'pdf',
  'doc',
  'docx',
  'odt',
  'rtf',
  'xls',
  'xlsx',
  'csv',
  'ods',
  'ppt',
  'pptx',
  'odp',
])
const CHAT_ATTACHMENT_ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.oasis.opendocument.text',
  'application/rtf',
  'text/rtf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.presentation',
])
const CHAT_CACHE_KEY = 'contas.group-chat.cache.v1'
const CHAT_CACHE_MAX_AGE_MS = 10 * 60 * 1000
const CHAT_TYPING_STATE_TTL_MS = 12_000
const CHAT_TYPING_START_DELAY_MS = 350
const CHAT_TYPING_HEARTBEAT_MS = 5_000
const EMPTY_COMPOSER_ATTACHMENTS: ChatComposerAttachment[] = []

type ChatCachePayload = {
  updatedAt: number
  userId: string
  roomSlug: string
  room: ChatRoomRow | null
  profiles: ChatProfileRow[]
  roomMembers: ChatRoomMemberRow[]
  messages: ChatMessage[]
}

function createLocalId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `chat-${Math.random().toString(36).slice(2, 10)}`
}

function isImageFile(file: File) {
  return file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif)$/i.test(file.name)
}

function isAllowedChatAttachment(file: File) {
  if (isImageFile(file)) return true

  const extension = getAttachmentExtension(file.name)
  if (CHAT_ATTACHMENT_ALLOWED_EXTENSIONS.has(extension)) return true

  const mimeType = file.type.toLowerCase()
  return CHAT_ATTACHMENT_ALLOWED_MIME_TYPES.has(mimeType)
}

function createComposerAttachment(file: File): ChatComposerAttachment {
  const kind = isImageFile(file) ? 'image' : 'file'
  return {
    id: createLocalId(),
    file,
    name: file.name,
    size: displayAttachmentSize(file.size),
    kind,
    preview: kind === 'image' ? URL.createObjectURL(file) : undefined,
  }
}

function filterAllowedChatAttachments(files: File[]) {
  const allowed: File[] = []
  let rejectedCount = 0

  for (const file of files) {
    if (isAllowedChatAttachment(file)) {
      allowed.push(file)
    } else {
      rejectedCount += 1
    }
  }

  return { allowed, rejectedCount }
}

function revokeComposerAttachmentPreview(attachment: ChatComposerAttachment) {
  if (attachment.preview) {
    URL.revokeObjectURL(attachment.preview)
  }
}

function formatMessageTimestampLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Just now'
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Africa/Blantyre',
  }).format(date)
}

function getMessageDayKey(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'invalid'
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function createOptimisticAttachmentPreview(
  attachment: ChatComposerAttachment,
  messageId: string,
): ChatAttachmentRow & { publicUrl: string | null; displaySize: string } {
  const previewUrl = attachment.kind === 'image' ? URL.createObjectURL(attachment.file) : null
  return {
    id: `${messageId}-${attachment.id}`,
    message_id: messageId,
    storage_bucket: 'chat-attachments',
    storage_path: `pending/${attachment.id}`,
    file_name: attachment.name,
    mime_type: attachment.file.type || null,
    file_size_bytes: attachment.file.size,
    attachment_kind: attachment.kind,
    metadata: {
      original_name: attachment.file.name,
      pending: true,
    },
    created_at: new Date().toISOString(),
    publicUrl: previewUrl,
    displaySize: attachment.size,
  }
}

function revokeAttachmentPreviewUrl(attachment: Pick<ChatAttachmentPreviewRow, 'publicUrl'>) {
  const { publicUrl } = attachment
  if (typeof publicUrl === 'string' && publicUrl.startsWith('blob:')) {
    URL.revokeObjectURL(publicUrl)
  }
}

function formatVoiceDuration(durationMs?: number) {
  if (!durationMs) return '0:00'
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function createBaseWaveLevels(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const curve = Math.sin(index * 0.68) * 0.22
    const wobble = Math.cos(index * 1.17) * 0.12
    return Math.max(0.22, Math.min(0.9, 0.46 + curve + wobble))
  })
}

function VoicePlayback({
  src,
  durationMs,
}: {
  src: string
  durationMs?: number
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTimeSeconds, setCurrentTimeSeconds] = useState(0)
  const [durationSeconds, setDurationSeconds] = useState(0)
  const [levels, setLevels] = useState<number[]>(() => createBaseWaveLevels(22))

  const stopAnimation = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    setIsPlaying(false)
    setLevels(createBaseWaveLevels(22))
  }, [])

  const stopPlayback = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.pause()
    audio.currentTime = 0
    setCurrentTimeSeconds(0)
    stopAnimation()
  }, [stopAnimation])

  const runAnimation = useCallback(function runAnimationFrame() {
    const audio = audioRef.current
    if (!audio || audio.paused || audio.ended) {
      stopAnimation()
      return
    }

    const t = audio.currentTime
    setLevels(
      Array.from({ length: 22 }, (_, index) => {
        const wave = Math.sin(t * 9 + index * 0.8)
        const shimmer = Math.sin(t * 5.5 + index * 1.2)
        return Math.max(0.16, Math.min(1, 0.46 + wave * 0.3 + shimmer * 0.2))
      }),
    )
    rafRef.current = requestAnimationFrame(runAnimationFrame)
  }, [stopAnimation])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onPlay = () => {
      setIsPlaying(true)
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(runAnimation)
      }
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

  const shownSeconds = isPlaying
    ? currentTimeSeconds
    : durationSeconds > 0
      ? durationSeconds
      : (durationMs ?? 0) / 1000
  const effectiveDuration = durationSeconds > 0 ? durationSeconds : (durationMs ?? 0) / 1000
  const progressRatio = effectiveDuration > 0 ? Math.min(1, currentTimeSeconds / effectiveDuration) : 0
  const playedIndex = Math.floor(progressRatio * levels.length)

  return (
    <div className='flex items-center gap-3 rounded-full border border-border/70 bg-background/70 px-3 py-1.5'>
      <audio ref={audioRef} src={src} preload='metadata' className='hidden' />
      <div
        className='relative grid h-6 min-w-0 flex-1 items-center gap-[2px]'
        style={{ gridTemplateColumns: `repeat(${levels.length}, minmax(0, 1fr))` }}
      >
        {levels.map((level, index) => (
          <span
            key={index}
            className={cn(
              'z-[1] w-[2px] justify-self-center rounded-full transition-all duration-100',
              index <= playedIndex
                ? 'bg-foreground/85'
                : isPlaying
                  ? 'bg-foreground/45'
                  : 'bg-muted-foreground/55',
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

function formatMessageDaySeparator(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Today'

  const today = new Date()
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const startOfMessageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const dayDiff = Math.round((startOfToday.getTime() - startOfMessageDay.getTime()) / (1000 * 60 * 60 * 24))

  if (dayDiff === 0) return 'Today'
  if (dayDiff === 1) return 'Yesterday'

  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

function MessageDaySeparator({ label }: { label: string }) {
  return (
    <div className='flex items-center gap-3 py-2'>
      <div className='h-px flex-1 bg-border/60 dark:bg-border/50' aria-hidden='true' />
      <span className='rounded-full border border-border/70 bg-background/95 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground shadow-sm'>
        {label}
      </span>
      <div className='h-px flex-1 bg-border/60 dark:bg-border/50' aria-hidden='true' />
    </div>
  )
}

function MessageReplyPreview({
  message,
  onClick,
}: {
  message: ReplyPreviewMessage
  onClick?: (message: ReplyPreviewMessage) => void
}) {
  const hasContent = Boolean(message.message.trim())
  const firstAttachment = message.attachments?.[0] ?? null

  const content = firstAttachment
    ? isProbablyImageAttachment(firstAttachment)
      ? 'Photo'
      : getDocumentTypeLabel(firstAttachment.file_name)
    : hasContent
      ? message.message
      : message.voiceDataUrl
        ? 'Voice message'
        : 'Message'

  const preview = (
    <div
      className={cn(
        'flex w-full items-stretch overflow-hidden rounded-2xl border border-primary/15 bg-primary/5 text-left',
        onClick && 'transition hover:bg-primary/10',
      )}
      aria-label={`Reply to ${message.author}`}
    >
      <div className='w-1.5 shrink-0 bg-primary/70' aria-hidden='true' />
      <div className='min-w-0 flex-1 px-3 py-2'>
        <p className='text-[10px] font-semibold text-primary'>Replying to {message.author}</p>
        <p className='mt-0.5 truncate text-xs text-muted-foreground'>{content}</p>
      </div>
    </div>
  )

  if (!onClick) return preview

  return (
    <button type='button' onClick={() => onClick(message)} className='block w-full cursor-pointer text-left'>
      {preview}
    </button>
  )
}

function ComposerReplyPreview({
  message,
  onCancel,
}: {
  message: ReplyPreviewMessage
  onCancel: () => void
}) {
  const hasContent = Boolean(message.message.trim())
  const firstAttachment = message.attachments?.[0] ?? null

  const content = firstAttachment
    ? isProbablyImageAttachment(firstAttachment)
      ? 'Photo'
      : getDocumentTypeLabel(firstAttachment.file_name)
    : hasContent
      ? message.message
      : message.voiceDataUrl
        ? 'Voice message'
        : 'Message'

  return (
    <div className='mb-3 flex items-stretch gap-3 rounded-2xl border border-primary/15 bg-primary/5 px-3 py-2'>
      <div className='w-1.5 shrink-0 rounded-full bg-primary/70' aria-hidden='true' />
      <div className='min-w-0 flex-1'>
        <p className='text-[10px] font-semibold text-primary'>Replying to {message.author}</p>
        <p className='mt-0.5 truncate text-xs text-muted-foreground'>{content}</p>
      </div>
      <Button
        type='button'
        variant='ghost'
        size='icon'
        className='h-8 w-8 shrink-0 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground'
        onClick={onCancel}
        aria-label='Cancel reply'
      >
        <X className='h-4 w-4' aria-hidden='true' />
      </Button>
    </div>
  )
}

function getProfileDisplayName(profile: Pick<ChatProfileRow, 'full_name' | 'username' | 'email'>) {
  return profile.full_name ?? profile.username ?? profile.email ?? 'Unknown user'
}

function getProfileHandle(profile: Pick<ChatProfileRow, 'username' | 'full_name'>) {
  const explicit = profile.username?.trim()
  if (explicit) return explicit.toLowerCase()
  return (profile.full_name ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9._-]/g, '')
}

function getProfileInitials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function displayAttachmentSize(sizeBytes: number | null) {
  if (!sizeBytes || Number.isNaN(sizeBytes)) return 'Unknown size'
  if (sizeBytes < 1024) return `${sizeBytes} B`
  const kib = sizeBytes / 1024
  if (kib < 1024) return `${Math.round(kib)} KB`
  const mib = kib / 1024
  return `${mib >= 10 ? mib.toFixed(1) : mib.toFixed(2)} MB`
}

function isProbablyImageAttachment(attachment: ChatAttachmentRow) {
  if (attachment.attachment_kind === 'image') return true
  return (attachment.mime_type ?? '').toLowerCase().startsWith('image/')
}

function getAttachmentStoredUrl(metadata: Record<string, unknown> | null) {
  const candidate = metadata?.uploaded_url
  return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate : null
}

function toPublicAttachmentUrl(bucket: string, path: string) {
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl
}

function getInitialRoomHeader(room: ChatRoomRow | null) {
  return {
    title: room?.name ?? 'Group chat',
    description: room?.description ?? 'A shared team room for updates, questions, and mentions.',
  }
}

function chatCacheStorageKey(userId: string, roomSlug: string) {
  return `${CHAT_CACHE_KEY}:${userId}:${roomSlug}`
}

function readCachedChatState(userId: string, roomSlug: string) {
  try {
    const raw = localStorage.getItem(chatCacheStorageKey(userId, roomSlug))
    if (!raw) return null

    const parsed = JSON.parse(raw) as ChatCachePayload
    if (!parsed || parsed.userId !== userId || parsed.roomSlug !== roomSlug) return null
    if (Date.now() - parsed.updatedAt > CHAT_CACHE_MAX_AGE_MS) return null
    return parsed
  } catch {
    return null
  }
}

function writeCachedChatState(payload: ChatCachePayload) {
  try {
    localStorage.setItem(chatCacheStorageKey(payload.userId, payload.roomSlug), JSON.stringify(payload))
  } catch {
    // Ignore storage quota and privacy-mode failures.
  }
}

function createTypingDisplayLabel(profiles: ChatProfileRow[]) {
  if (profiles.length === 0) return null
  if (profiles.length === 1) return `${getProfileDisplayName(profiles[0])} is typing...`
  if (profiles.length === 2) {
    return `${getProfileDisplayName(profiles[0])} and ${getProfileDisplayName(profiles[1])} are typing...`
  }
  return `${getProfileDisplayName(profiles[0])} and ${profiles.length - 1} others are typing...`
}

function cloneChatAttachmentForCache(attachment: ChatAttachmentPreviewRow): ChatAttachmentPreviewRow {
  return {
    ...attachment,
    metadata: attachment.metadata ? { ...attachment.metadata } : null,
  }
}

function cloneChatMessageForCache(message: ChatMessage): ChatMessage {
  return {
    ...message,
    attachments: message.attachments?.map(cloneChatAttachmentForCache),
  }
}

function mergeChatMessages(currentMessages: ChatMessage[], nextMessages: ChatMessage[]) {
  const merged = new Map<string, ChatMessage>()
  const pendingByClientMessageId = new Map(
    currentMessages
      .filter((message) => message.pending && message.clientMessageId)
      .map((message) => [message.clientMessageId as string, message]),
  )

  for (const nextMessage of nextMessages) {
    const pendingMatch = nextMessage.clientMessageId ? pendingByClientMessageId.get(nextMessage.clientMessageId) : null
    const currentMatch = merged.get(nextMessage.id) ?? currentMessages.find((message) => message.id === nextMessage.id) ?? null

    if (pendingMatch) {
      merged.set(nextMessage.id, {
        ...pendingMatch,
        ...nextMessage,
        pending: false,
        clientMessageId: nextMessage.clientMessageId ?? pendingMatch.clientMessageId ?? null,
      })
      continue
    }

    merged.set(
      nextMessage.id,
      currentMatch
        ? {
            ...currentMatch,
            ...nextMessage,
            pending: false,
          }
        : nextMessage,
    )
  }

  for (const currentMessage of currentMessages) {
    if (merged.has(currentMessage.id)) continue
    if (currentMessage.pending) {
      merged.set(currentMessage.id, currentMessage)
    }
  }

  return Array.from(merged.values()).sort((left, right) => {
    const leftTime = new Date(left.createdAt).getTime()
    const rightTime = new Date(right.createdAt).getTime()
    if (leftTime !== rightTime) return leftTime - rightTime
    return left.id.localeCompare(right.id)
  })
}

function renderMessageParts(body: string, knownHandles: Set<string>) {
  const parts: Array<string | { type: 'mention'; value: string }> = []
  const regex = /@([a-zA-Z0-9._-]+)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(body)) !== null) {
    const [token, rawHandle] = match
    const before = body.slice(lastIndex, match.index)
    if (before) parts.push(before)

    const handle = rawHandle.toLowerCase()
    parts.push(knownHandles.has(handle) ? { type: 'mention', value: token } : token)
    lastIndex = match.index + token.length
  }

  const tail = body.slice(lastIndex)
  if (tail) parts.push(tail)
  return parts
}

function extractMentionHandles(text: string) {
  return Array.from(
    new Set(
      (text.match(/@([a-zA-Z0-9._-]+)/g) ?? []).map((token) => token.slice(1).toLowerCase()),
    ),
  )
}

type MentionDraft = {
  start: number
  end: number
  query: string
}

function getMentionHandle(option: MentionOption) {
  return option.username.trim().replace(/\s+/g, '_').toLowerCase()
}

function getMentionDraft(value: string, cursor: number | null) {
  if (cursor === null || cursor < 0) return null
  const beforeCursor = value.slice(0, cursor)
  const match = beforeCursor.match(/(^|\s)@([a-zA-Z0-9._-]*)$/)
  if (!match) return null

  const query = match[2] ?? ''
  const start = cursor - query.length - 1
  return { start, end: cursor, query } satisfies MentionDraft
}

function isMentionTriggerKey(key: string) {
  return key === 'ArrowUp' || key === 'ArrowDown' || key === 'Enter' || key === 'Tab' || key === 'Escape'
}

function AttachmentPreview({
  attachment,
  onRemove,
}: {
  attachment: ChatComposerAttachment
  onRemove: (id: string) => void
}) {
  const isImage = attachment.kind === 'image'
  const documentStyle = isImage ? null : getDocumentStyle(attachment.name)
  const DocumentIcon = documentStyle?.Icon ?? FileText

  return (
    <div
      className='group relative overflow-visible rounded-2xl border border-border/70 bg-card shadow-[0_6px_18px_hsl(var(--foreground)/0.05)]'
      title={`${attachment.name} • ${attachment.size}`}
    >
      {isImage ? (
        <div className='relative aspect-square overflow-hidden rounded-2xl bg-muted/40'>
          <img
            src={attachment.preview}
            alt={attachment.name}
            className='h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]'
          />
          <div className='absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent' />
          <button
            type='button'
            onClick={() => onRemove(attachment.id)}
            className='absolute -right-1.5 -top-1.5 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/70 bg-card/95 text-muted-foreground opacity-0 shadow-[0_6px_14px_hsl(var(--foreground)/0.18)] transition duration-150 hover:bg-card hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100'
            aria-label={`Remove ${attachment.name}`}
          >
            <X className='h-3.5 w-3.5' aria-hidden='true' />
          </button>
        </div>
      ) : (
        <div className={cn('relative aspect-square overflow-hidden rounded-2xl p-3', documentStyle?.shellClassName)}>
          <div className='flex h-full flex-col items-center justify-center gap-1'>
            <DocumentIcon className={cn('h-8 w-8', documentStyle?.iconClassName)} aria-hidden='true' />
            <span className={cn('text-[10px] font-medium tracking-[0.06em]', documentStyle?.iconClassName)}>
              {getDocumentTypeLabel(attachment.name)}
            </span>
          </div>
          <button
            type='button'
            onClick={() => onRemove(attachment.id)}
            className='absolute -right-1.5 -top-1.5 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/70 bg-card/95 text-muted-foreground opacity-0 shadow-[0_6px_14px_hsl(var(--foreground)/0.18)] transition duration-150 hover:bg-card hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100'
            aria-label={`Remove ${attachment.name}`}
          >
            <X className='h-3.5 w-3.5' aria-hidden='true' />
          </button>
        </div>
      )}
    </div>
  )
}

function MessageAttachmentPreview({
  attachment,
  onOpen,
  onLoad,
  solo = false,
}: {
  attachment: ChatAttachmentPreviewRow
  onOpen: (attachment: ChatAttachmentPreviewRow) => void
  onLoad?: () => void
  solo?: boolean
}) {
  const isImage = isProbablyImageAttachment(attachment)
  const documentStyle = isImage ? null : getDocumentStyle(attachment.file_name)
  const viewerMode = getAttachmentViewerMode(attachment.file_name, attachment.mime_type)
  const DocumentIcon = documentStyle?.Icon ?? FileText

  if (isImage) {
    return (
      <button
        type='button'
        onClick={() => onOpen(attachment)}
        className={cn(
          'group relative block overflow-hidden rounded-2xl border border-border/70 bg-muted/30 text-left shadow-[0_6px_18px_hsl(var(--foreground)/0.05)] transition hover:border-primary/30 hover:shadow-[0_10px_24px_hsl(var(--foreground)/0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
          solo ? 'w-[11rem] min-w-[11rem] sm:w-[12rem] sm:min-w-[12rem]' : 'w-full',
        )}
        title={`${attachment.file_name} • ${attachment.displaySize}`}
        aria-label={`Open ${attachment.file_name}`}
      >
        {attachment.publicUrl ? (
          <img
            src={attachment.publicUrl}
            alt={attachment.file_name}
            className='aspect-square h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]'
            onLoad={onLoad}
          />
        ) : (
          <div className='flex aspect-square items-center justify-center text-xs text-muted-foreground'>Preview unavailable</div>
        )}
      </button>
    )
  }

  return (
    <button
      type='button'
      onClick={() => onOpen(attachment)}
      className={cn(
        'group relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl border text-left shadow-[0_6px_18px_hsl(var(--foreground)/0.05)] transition hover:shadow-[0_10px_24px_hsl(var(--foreground)/0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
        solo ? 'w-[11rem] min-w-[11rem] sm:w-[12rem] sm:min-w-[12rem]' : 'w-full',
        documentStyle?.shellClassName,
      )}
      title={`${attachment.file_name} • ${attachment.displaySize}`}
      aria-label={`Open ${attachment.file_name} in viewer (${viewerMode})`}
    >
      <div className='flex flex-col items-center justify-center gap-1'>
        <DocumentIcon className={cn('h-6 w-6', documentStyle?.iconClassName)} aria-hidden='true' />
        <span className={cn('text-[9px] font-medium tracking-[0.06em]', documentStyle?.iconClassName)}>
          {getDocumentTypeLabel(attachment.file_name)}
        </span>
      </div>
    </button>
  )
}

function MessageBubble({
  message,
  knownHandles,
  onLongPress,
  onOpenAttachment,
  onAttachmentLoad,
  onJumpToMessage,
  isOnline,
  replyTarget,
}: {
  message: ChatMessage
  knownHandles: Set<string>
  onLongPress: (message: ChatMessage) => void
  onOpenAttachment: (attachment: ChatAttachmentPreviewRow) => void
  onAttachmentLoad: () => void
  onJumpToMessage: (messageId: string) => void
  isOnline?: boolean
  replyTarget?: ChatMessage | null
}) {
  const isMine = Boolean(message.mine)
  const parts = renderMessageParts(message.message, knownHandles)
  const longPressTimerRef = useRef<number | null>(null)
  const attachmentCount = message.attachments?.length ?? 0
  const hasSingleAttachment = attachmentCount === 1
  const replyPreview = replyTarget
    ? {
        id: replyTarget.id,
        author: replyTarget.author,
        message: replyTarget.deletedAt ? 'Deleted message' : replyTarget.message,
        voiceDataUrl: replyTarget.voiceDataUrl,
        attachments: replyTarget.attachments,
      }
    : null

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    clearLongPressTimer()
    longPressTimerRef.current = window.setTimeout(() => {
      onLongPress(message)
      longPressTimerRef.current = null
    }, 500)
  }

  return (
    <div
      id={`chat-message-${message.id}`}
      className={cn('group relative flex items-end gap-3 select-none touch-manipulation', isMine ? 'justify-end' : 'justify-start')}
      onPointerDown={handlePointerDown}
      onPointerUp={clearLongPressTimer}
      onPointerCancel={clearLongPressTimer}
      onPointerLeave={clearLongPressTimer}
      onContextMenu={(event) => {
        event.preventDefault()
        onLongPress(message)
      }}
    >
      {!isMine ? (
        <div className='relative h-8 w-8 overflow-visible'>
          <Avatar className='h-8 w-8 border border-border/70 shadow-sm'>
            {message.authorAvatarUrl ? <AvatarImage src={message.authorAvatarUrl} alt={message.author} /> : null}
            <AvatarFallback className='bg-primary/10 text-xs font-semibold text-primary'>{message.initials}</AvatarFallback>
          </Avatar>
          {isOnline ? (
            <span
              className='absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-emerald-500 shadow-sm'
              aria-hidden='true'
            />
          ) : null}
        </div>
      ) : null}
      <div className={cn('flex max-w-[78%] flex-col gap-1', isMine ? 'ml-auto items-end text-left' : 'items-start')}>
        <div className='flex items-center gap-2'>
          <p className='text-xs font-semibold text-foreground'>{message.author}</p>
        </div>
        {message.replyToId && replyPreview ? (
          <div className={cn('w-full max-w-full', isMine ? 'ml-auto' : 'mr-auto')}>
            <MessageReplyPreview message={replyPreview} onClick={() => onJumpToMessage(replyPreview.id)} />
          </div>
        ) : null}
        {message.message ? (
          <div
            className={cn(
              'inline-flex w-fit max-w-full rounded-2xl px-3 py-2 text-sm leading-relaxed shadow-sm',
              isMine
                ? 'rounded-br-md bg-primary text-primary-foreground'
                : 'rounded-bl-md border bg-muted/35 text-foreground',
              message.pending && 'opacity-70',
            )}
          >
            <span className='whitespace-pre-wrap'>
              {parts.map((part, index) =>
                typeof part === 'string' ? (
                  <span key={`${message.id}-part-${index}`}>{part}</span>
                ) : (
                  <span
                    key={`${message.id}-mention-${index}`}
                    className={cn('rounded-full px-1.5 py-0.5 font-medium', isMine ? 'bg-white/15' : 'bg-primary/10 text-primary')}
                  >
                    {part.value}
                  </span>
                ),
              )}
            </span>
          </div>
        ) : null}
        {message.voiceDataUrl ? (
          <div className={cn('w-fit max-w-full', isMine ? 'ml-auto' : 'mr-auto')}>
            <VoicePlayback src={message.voiceDataUrl} durationMs={message.voiceDurationMs ?? undefined} />
          </div>
        ) : null}
        {message.attachments && message.attachments.length > 0 ? (
          hasSingleAttachment ? (
            <div className={cn('flex w-full max-w-full', isMine ? 'justify-end' : 'justify-start')}>
              <MessageAttachmentPreview
                attachment={message.attachments[0]}
                onOpen={onOpenAttachment}
                onLoad={onAttachmentLoad}
                solo
              />
            </div>
          ) : (
            <div
              className={cn('grid w-fit max-w-full gap-2', isMine ? 'ml-auto grid-cols-3' : 'mr-auto grid-cols-3')}
              dir={isMine ? 'rtl' : 'ltr'}
            >
              {message.attachments.map((attachment) => (
                <MessageAttachmentPreview
                  key={attachment.id}
                  attachment={attachment}
                  onOpen={onOpenAttachment}
                  onLoad={onAttachmentLoad}
                />
              ))}
            </div>
          )
        ) : null}
        <p className='text-[11px] text-muted-foreground'>
          {message.pending ? 'Sending…' : message.time}
          {message.editedAt ? ' · edited' : ''}
        </p>
      </div>
      {isMine ? (
        <Avatar className='h-8 w-8 border border-border/70 shadow-sm'>
          {message.authorAvatarUrl ? <AvatarImage src={message.authorAvatarUrl} alt={message.author} /> : null}
          <AvatarFallback className='bg-foreground/5 text-xs font-semibold text-foreground'>{message.initials}</AvatarFallback>
        </Avatar>
      ) : null}
    </div>
  )
}

export function GroupChatWidget() {
  const { currentUser, session } = useAuth()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [draft, setDraft] = useState('')
  const [room, setRoom] = useState<ChatRoomRow | null>(null)
  const [profiles, setProfiles] = useState<ChatProfileRow[]>([])
  const [roomMembers, setRoomMembers] = useState<ChatRoomMemberRow[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [typingStates, setTypingStates] = useState<ChatRoomTypingStateRow[]>([])
  const [attachments, setAttachments] = useState<ChatComposerAttachment[]>(EMPTY_COMPOSER_ATTACHMENTS)
  const [pendingVoiceMessage, setPendingVoiceMessage] = useState<ChatComposerVoice | null>(null)
  const [mentionDraft, setMentionDraft] = useState<MentionDraft | null>(null)
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [messageActionTarget, setMessageActionTarget] = useState<ChatMessage | null>(null)
  const [replyToMessageId, setReplyToMessageId] = useState<string | null>(null)
  const [attachmentViewer, setAttachmentViewer] = useState<AttachmentViewerState | null>(null)
  const [attachmentCsvText, setAttachmentCsvText] = useState<string | null>(null)
  const [attachmentCsvLoading, setAttachmentCsvLoading] = useState(false)
  const [attachmentCsvError, setAttachmentCsvError] = useState<string | null>(null)
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [isRecordingVoice, setIsRecordingVoice] = useState(false)
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0)
  const [recordingLevels, setRecordingLevels] = useState<number[]>(() => createBaseWaveLevels(20))
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragDepthRef = useRef(0)
  const attachmentsRef = useRef<ChatComposerAttachment[]>(EMPTY_COMPOSER_ATTACHMENTS)
  const pendingVoiceMessageRef = useRef<ChatComposerVoice | null>(null)
  const messagesScrollRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const hydratingRef = useRef(false)
  const sendingRef = useRef(false)
  const typingStartTimerRef = useRef<number | null>(null)
  const typingHeartbeatTimerRef = useRef<number | null>(null)
  const typingActiveRef = useRef(false)
  const realtimeReloadTimerRef = useRef<number | null>(null)
  const voiceMediaRecorderRef = useRef<MediaRecorder | null>(null)
  const voiceMicStreamRef = useRef<MediaStream | null>(null)
  const voiceAudioContextRef = useRef<AudioContext | null>(null)
  const voiceChunksRef = useRef<Blob[]>([])
  const voiceAnimationFrameRef = useRef<number | null>(null)
  const voiceStartAtRef = useRef(0)
  const stickToLatestRef = useRef(false)
  const hasInitialScrollRef = useRef(false)

  const profileById = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile])), [profiles])
  const messageById = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages])
  const replyingToMessage = replyToMessageId ? messageById.get(replyToMessageId) ?? null : null
  const mentionOptions = useMemo(
    () =>
      profiles
        .filter((profile) => profile.id !== currentUser?.id)
        .map((profile) => ({
          id: profile.id,
          name: getProfileDisplayName(profile),
          role: profile.job_title ?? profile.role_label ?? 'Team',
          username: getProfileHandle(profile),
          avatarUrl: profile.avatar_url,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [currentUser?.id, profiles],
  )
  const mentionHandleSet = useMemo(() => new Set(mentionOptions.map((option) => getMentionHandle(option))), [mentionOptions])
  const roomHeader = useMemo(() => getInitialRoomHeader(room), [room])
  const editingMessage = useMemo(
    () => messages.find((message) => message.id === editingMessageId) ?? null,
    [editingMessageId, messages],
  )
  const actionSheetMessage = messageActionTarget
  const roomMemberProfiles = useMemo(
    () =>
      roomMembers
        .map((member) => profileById.get(member.user_id))
        .filter((profile): profile is ChatProfileRow => Boolean(profile))
        .filter((profile) => profile.id !== currentUser?.id),
    [currentUser?.id, profileById, roomMembers],
  )
  const onlineUserIds = useMemo(() => new Set(roomMemberProfiles.map((profile) => profile.id)), [roomMemberProfiles])
  const typingProfiles = useMemo(() => {
    const typingProfileMap = new Map<string, ChatProfileRow>()
    for (const typingState of typingStates) {
      if (!typingState.is_typing) continue
      const profile = profileById.get(typingState.user_id)
      if (!profile || profile.id === currentUser?.id) continue
      typingProfileMap.set(profile.id, profile)
    }

    return Array.from(typingProfileMap.values()).sort((left, right) => getProfileDisplayName(left).localeCompare(getProfileDisplayName(right)))
  }, [currentUser?.id, profileById, typingStates])
  const typingLabel = useMemo(() => createTypingDisplayLabel(typingProfiles), [typingProfiles])

  const filteredMentionOptions = useMemo(() => {
    if (!mentionDraft) return []
    const query = mentionDraft.query.trim().toLowerCase()
    if (!query) return mentionOptions.slice(0, 6)
    return mentionOptions
      .filter((option) => option.name.toLowerCase().includes(query) || option.username.includes(query))
      .slice(0, 6)
  }, [mentionDraft, mentionOptions])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if (params.get('openGroupChat') !== '1') return
    setOpen(true)
  }, [location.search])

  const dispatchChatMentionEmails = useCallback(
    async (messageId: string, recipientIds: string[], messagePreview?: string) => {
      if (!currentUser?.id || recipientIds.length === 0 || !room?.id || !room?.name) return

      const { data: notificationRows, error } = await supabase
        .from('notifications')
        .select('id, recipient_id')
        .eq('actor_id', currentUser.id)
        .eq('type', 'mention')
        .contains('metadata', { chat_message_id: messageId })
        .in('recipient_id', recipientIds)
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Failed to load chat mention notifications', error)
        return
      }

      const latestNotificationByRecipient = Array.from(
        new Map((notificationRows ?? []).map((row) => [row.recipient_id, row] as const)).values(),
      )

      if (latestNotificationByRecipient.length === 0) return

      const appUrl = `${window.location.origin}/dashboard/home?openGroupChat=1`
      void dispatchNotificationEmails(
        latestNotificationByRecipient.map((item) => ({
          notificationId: item.id,
          recipientId: item.recipient_id,
          recipientEmail: profileById.get(item.recipient_id)?.email ?? undefined,
          type: 'mention' as const,
          contextKind: 'chat' as const,
          roomId: room.id,
          roomName: room.name ?? 'Group Chat',
          messagePreview,
          appUrl,
          actorName: currentUser.name ?? currentUser.email ?? 'A teammate',
        })),
      )
    },
    [currentUser?.email, currentUser?.id, currentUser?.name, profileById, room?.id, room?.name],
  )

  useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])

  useEffect(() => {
    pendingVoiceMessageRef.current = pendingVoiceMessage
  }, [pendingVoiceMessage])

  useEffect(() => {
    sendingRef.current = sending
  }, [sending])

  const clearTypingTimers = useCallback(() => {
    if (typingStartTimerRef.current !== null) {
      window.clearTimeout(typingStartTimerRef.current)
      typingStartTimerRef.current = null
    }
    if (typingHeartbeatTimerRef.current !== null) {
      window.clearInterval(typingHeartbeatTimerRef.current)
      typingHeartbeatTimerRef.current = null
    }
  }, [])

  const stopTypingPresence = useCallback(async () => {
    clearTypingTimers()
    typingActiveRef.current = false

    if (!room?.id || !currentUser?.id) return

    const { error } = await supabase
      .from('chat_room_typing_states')
      .delete()
      .eq('room_id', room.id)
      .eq('user_id', currentUser.id)

    if (error) {
      console.warn('Failed to clear typing presence', error)
    }
  }, [clearTypingTimers, currentUser?.id, room?.id])

  const pushTypingPresence = useCallback(async () => {
    if (!room?.id || !currentUser?.id) return

    const { error } = await supabase.from('chat_room_typing_states').upsert(
      {
        room_id: room.id,
        user_id: currentUser.id,
        is_typing: true,
      },
      { onConflict: 'room_id,user_id' },
    )

    if (error) {
      console.warn('Failed to update typing presence', error)
      return
    }

    typingActiveRef.current = true

    if (typingHeartbeatTimerRef.current === null) {
      typingHeartbeatTimerRef.current = window.setInterval(() => {
        void pushTypingPresence()
      }, CHAT_TYPING_HEARTBEAT_MS)
    }
  }, [currentUser?.id, room?.id])

  const scheduleTypingPresence = useCallback(
    (value: string) => {
      if (!room?.id || !currentUser?.id) return

      if (value.trim().length === 0) {
        void stopTypingPresence()
        return
      }

      if (typingActiveRef.current) return

      if (typingStartTimerRef.current !== null) {
        return
      }

      typingStartTimerRef.current = window.setTimeout(() => {
        typingStartTimerRef.current = null
        void pushTypingPresence()
      }, CHAT_TYPING_START_DELAY_MS)
    },
    [currentUser?.id, pushTypingPresence, room?.id, stopTypingPresence],
  )

  const loadTypingStates = useCallback(
    async (roomId: string) => {
      if (!currentUser?.id) {
        setTypingStates([])
        return []
      }

      const typingCutoffIso = new Date(Date.now() - CHAT_TYPING_STATE_TTL_MS).toISOString()
      const { data, error } = await supabase
        .from('chat_room_typing_states')
        .select('id, room_id, user_id, is_typing, created_at, updated_at')
        .eq('room_id', roomId)
        .eq('is_typing', true)
        .gte('updated_at', typingCutoffIso)

      if (error) {
        console.error('Failed to load chat typing state', error)
        setTypingStates([])
        return []
      }

      const nextTypingStates = (data ?? []) as ChatRoomTypingStateRow[]
      setTypingStates(nextTypingStates)
      return nextTypingStates
    },
    [currentUser?.id],
  )

  useLayoutEffect(() => {
    const textarea = inputRef.current
    if (!textarea) return

    textarea.style.height = 'auto'
    const lineHeight = Number.parseFloat(window.getComputedStyle(textarea).lineHeight || '0') || 20
    const verticalPadding = 20
    const minHeight = lineHeight + verticalPadding
    const maxHeight = lineHeight * 6 + verticalPadding
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight)
    textarea.style.height = `${Math.max(nextHeight, minHeight)}px`
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [draft, editingMessageId, open])

  useEffect(() => {
    return () => {
      attachmentsRef.current.forEach(revokeComposerAttachmentPreview)
      if (pendingVoiceMessageRef.current) {
        URL.revokeObjectURL(pendingVoiceMessageRef.current.previewUrl)
        pendingVoiceMessageRef.current = null
      }
      clearTypingTimers()
      if (voiceAnimationFrameRef.current !== null) {
        cancelAnimationFrame(voiceAnimationFrameRef.current)
        voiceAnimationFrameRef.current = null
      }
      const recorder = voiceMediaRecorderRef.current
      if (recorder && recorder.state !== 'inactive') recorder.stop()
      voiceMicStreamRef.current?.getTracks().forEach((track) => track.stop())
      voiceMicStreamRef.current = null
      voiceAudioContextRef.current?.close().catch(() => {})
      voiceAudioContextRef.current = null
    }
  }, [clearTypingTimers])

  const loadChatData = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    if (!currentUser?.id) {
      setRoom(null)
      setProfiles([])
      setRoomMembers([])
      setMessages([])
      setLoading(false)
      return
    }

    const cachedState = background ? null : readCachedChatState(currentUser.id, GENERAL_CHAT_ROOM_SLUG)
    const hasCachedState = Boolean(cachedState)
    if (cachedState) {
      setRoom(cachedState.room)
      setProfiles(cachedState.profiles)
      setRoomMembers(cachedState.roomMembers)
      setMessages(cachedState.messages)
      setError(null)
      setLoading(false)
    } else if (!background) {
      setLoading(true)
      setError(null)
    }

    hydratingRef.current = true
    try {
      const roomResult = await supabase
        .from('chat_rooms')
        .select('id, slug, name, description, last_message_at')
        .eq('slug', GENERAL_CHAT_ROOM_SLUG)
        .maybeSingle()

      if (roomResult.error || !roomResult.data) {
        console.error('Failed to load group chat room', roomResult.error)
        if (!hasCachedState) {
          setRoom(null)
          setProfiles([])
          setRoomMembers([])
          setMessages([])
          setError(roomResult.error?.message ?? 'Unable to load chat room.')
        }
        return
      }

      const roomData = roomResult.data as ChatRoomRow
      setRoom(roomData)

      const nowIso = new Date().toISOString()
      const { error: membershipError } = await supabase.from('chat_room_members').upsert(
        {
          room_id: roomData.id,
          user_id: currentUser.id,
          member_role: 'member',
          last_read_at: nowIso,
        },
        { onConflict: 'room_id,user_id' },
      )

      if (membershipError) {
        console.warn('Failed to ensure chat membership', membershipError)
      }

      const [profilesResult, membersResult, messagesResult] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, username, avatar_url, email, role_label, job_title')
          .order('full_name', { ascending: true }),
        supabase
          .from('chat_room_members')
          .select('id, room_id, user_id, member_role, last_read_at, created_at')
          .eq('room_id', roomData.id)
          .order('created_at', { ascending: true }),
        supabase
          .from('chat_messages')
          .select('id, room_id, author_id, body, reply_to_id, metadata, edited_at, deleted_at, created_at')
          .eq('room_id', roomData.id)
          .order('created_at', { ascending: true }),
      ])

      if (profilesResult.error) {
        console.error('Failed to load chat profiles', profilesResult.error)
      }
      if (membersResult.error) {
        console.error('Failed to load chat members', membersResult.error)
      }
      if (messagesResult.error) {
        console.error('Failed to load chat messages', messagesResult.error)
      }

      const profileRows = (profilesResult.data ?? []) as ChatProfileRow[]
      const memberRows = (membersResult.data ?? []) as ChatRoomMemberRow[]
      const messageRows = (messagesResult.data ?? []) as ChatMessageRow[]
      const profileMap = new Map(profileRows.map((profile) => [profile.id, profile]))
      const messageIds = messageRows.map((row) => row.id)

      let mentionRows: ChatMentionRow[] = []
      let attachmentRows: ChatAttachmentRow[] = []

      if (messageIds.length > 0) {
        const [mentionsResult, attachmentsResult] = await Promise.all([
          supabase
            .from('chat_message_mentions')
            .select('id, message_id, mentioned_user_id, created_at')
            .in('message_id', messageIds),
          supabase
            .from('chat_message_attachments')
            .select(
              'id, message_id, storage_bucket, storage_path, file_name, mime_type, file_size_bytes, attachment_kind, metadata, created_at',
            )
            .in('message_id', messageIds),
        ])

        if (mentionsResult.error) {
          console.error('Failed to load chat mentions', mentionsResult.error)
        }
        if (attachmentsResult.error) {
          console.error('Failed to load chat attachments', attachmentsResult.error)
        }

        mentionRows = (mentionsResult.data ?? []) as ChatMentionRow[]
        attachmentRows = (attachmentsResult.data ?? []) as ChatAttachmentRow[]
      }

      const attachmentMap = new Map<string, Array<ChatAttachmentPreviewRow>>()
      for (const attachment of attachmentRows) {
        const storedUrl = getAttachmentStoredUrl(attachment.metadata)
        const preview = {
          ...attachment,
          publicUrl: storedUrl ?? toPublicAttachmentUrl(attachment.storage_bucket, attachment.storage_path),
          displaySize: displayAttachmentSize(attachment.file_size_bytes),
        }
        const currentAttachments = attachmentMap.get(attachment.message_id) ?? []
        currentAttachments.push(preview)
        attachmentMap.set(attachment.message_id, currentAttachments)
      }

      void mentionRows

      setProfiles(profileRows)
      setRoomMembers(memberRows)
      const voiceStorageKeyByMessageId = new Map<string, string>()
      const nextMessages: ChatMessage[] = messageRows.map((row) => {
        const authorProfile = row.author_id ? profileMap.get(row.author_id) ?? null : null
        const authorName = authorProfile ? getProfileDisplayName(authorProfile) : 'Unknown user'
        const authorHandle = authorProfile ? getProfileHandle(authorProfile) : undefined
        const clientMessageId = typeof row.metadata?.client_message_id === 'string' ? row.metadata.client_message_id : null
        const voiceDataUrl = typeof row.metadata?.voice_data_url === 'string' ? row.metadata.voice_data_url : null
        const voiceStorageKey = typeof row.metadata?.voice_storage_key === 'string' ? row.metadata.voice_storage_key : null
        const voiceDurationMs =
          typeof row.metadata?.voice_duration_ms === 'number'
            ? row.metadata.voice_duration_ms
            : typeof row.metadata?.voice_duration_ms === 'string'
              ? Number(row.metadata.voice_duration_ms)
              : null
        if (voiceStorageKey && !voiceDataUrl) {
          voiceStorageKeyByMessageId.set(row.id, voiceStorageKey)
        }
        return {
          id: row.id,
          authorId: row.author_id,
          author: authorName,
          authorHandle,
          authorAvatarUrl: authorProfile?.avatar_url ?? null,
          role: authorProfile?.job_title ?? authorProfile?.role_label ?? 'Team',
          initials: getProfileInitials(authorName),
          message: row.body,
          time: formatMessageTimestampLabel(row.created_at),
          createdAt: row.created_at,
          replyToId: row.reply_to_id,
          mine: row.author_id === currentUser.id,
          editedAt: row.edited_at,
          deletedAt: row.deleted_at,
          clientMessageId,
          voiceDataUrl,
          voiceStorageKey,
          voiceDurationMs,
          attachments: attachmentMap.get(row.id) ?? [],
        }
      })

      setMessages((currentMessages) => {
        if (!background) return nextMessages
        return mergeChatMessages(currentMessages, nextMessages)
      })
      void loadTypingStates(roomData.id)
      if (voiceStorageKeyByMessageId.size > 0) {
        void Promise.all(
          Array.from(voiceStorageKeyByMessageId.entries()).map(async ([messageId, voiceStorageKey]) => {
            try {
              const resolvedVoiceUrl = await resolveR2ObjectUrl(voiceStorageKey)
              return { messageId, resolvedVoiceUrl }
            } catch {
              return null
            }
          }),
        ).then((resolvedVoices) => {
          const resolvedVoiceMap = new Map(
            resolvedVoices
              .filter((value): value is { messageId: string; resolvedVoiceUrl: string } => Boolean(value?.messageId && value.resolvedVoiceUrl))
              .map((value) => [value.messageId, value.resolvedVoiceUrl]),
          )
          if (resolvedVoiceMap.size === 0) return

          setMessages((current) => {
            const next = current.map((message) =>
              resolvedVoiceMap.has(message.id)
                ? {
                    ...message,
                    voiceDataUrl: resolvedVoiceMap.get(message.id) ?? message.voiceDataUrl ?? null,
                  }
                : message,
            )
            if (currentUser?.id) {
              writeCachedChatState({
                updatedAt: Date.now(),
                userId: currentUser.id,
                roomSlug: roomData.slug,
                room: roomData,
                profiles: profileRows,
                roomMembers: memberRows,
                messages: next.filter((message) => !message.pending).map(cloneChatMessageForCache),
              })
            }
            return next
          })
        })
      }
      writeCachedChatState({
        updatedAt: Date.now(),
        userId: currentUser.id,
        roomSlug: roomData.slug,
        room: roomData,
        profiles: profileRows,
        roomMembers: memberRows,
        messages: nextMessages.filter((message) => !message.pending).map(cloneChatMessageForCache),
      })
      setError(null)
    } catch (loadError) {
      console.error('Failed to load chat data', loadError)
      if (!hasCachedState) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load chat data.')
        setRoom(null)
        setProfiles([])
        setRoomMembers([])
        setMessages([])
        setTypingStates([])
      }
    } finally {
      if (!background) {
        setLoading(false)
      }
      hydratingRef.current = false
    }
  }, [currentUser?.id, loadTypingStates])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => {
      inputRef.current?.focus()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    void loadChatData()
  }, [loadChatData, open])

  useEffect(() => {
    if (!open || !room?.id) return

    let cancelled = false

    const scheduleRoomReload = () => {
      if (hydratingRef.current || sendingRef.current) return

      if (realtimeReloadTimerRef.current !== null) {
        window.clearTimeout(realtimeReloadTimerRef.current)
      }

      realtimeReloadTimerRef.current = window.setTimeout(() => {
        realtimeReloadTimerRef.current = null
        if (cancelled || hydratingRef.current || sendingRef.current) return
        void loadChatData({ background: true })
      }, 180)
    }

    const loadTypingForRoom = () => {
      void loadTypingStates(room.id)
    }

    const channel = supabase
      .channel(`group-chat-room-${room.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${room.id}` }, scheduleRoomReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_room_members', filter: `room_id=eq.${room.id}` }, scheduleRoomReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_rooms', filter: `id=eq.${room.id}` }, scheduleRoomReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_message_mentions' }, scheduleRoomReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_message_attachments' }, scheduleRoomReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_room_typing_states', filter: `room_id=eq.${room.id}` }, loadTypingForRoom)
      .subscribe()

    return () => {
      cancelled = true
      if (realtimeReloadTimerRef.current !== null) {
        window.clearTimeout(realtimeReloadTimerRef.current)
        realtimeReloadTimerRef.current = null
      }
      void supabase.removeChannel(channel)
    }
  }, [loadChatData, loadTypingStates, open, room?.id])

  useEffect(() => {
    if (!currentUser?.id || !room?.slug || loading) return

    try {
      writeCachedChatState({
        updatedAt: Date.now(),
        userId: currentUser.id,
        roomSlug: room.slug,
        room,
        profiles,
        roomMembers,
        messages: messages.filter((message) => !message.pending).map(cloneChatMessageForCache),
      })
    } catch {
      // Ignore storage quota and serialization failures.
    }
  }, [currentUser?.id, loading, messages, profiles, room, roomMembers])

  const replaceMentionDraft = useCallback(
    (option: MentionOption) => {
      if (!mentionDraft) return

      const mentionToken = `@${getMentionHandle(option)} `
      const nextValue = `${draft.slice(0, mentionDraft.start)}${mentionToken}${draft.slice(mentionDraft.end)}`
      const nextCaret = mentionDraft.start + mentionToken.length

      setDraft(nextValue)
      setMentionDraft(null)
      setMentionActiveIndex(0)

      window.requestAnimationFrame(() => {
        const input = inputRef.current
        if (!input) return
        input.focus()
        input.setSelectionRange(nextCaret, nextCaret)
      })
    },
    [draft, mentionDraft],
  )

  const updateMentionContext = useCallback(
    (nextValue: string, cursor: number | null) => {
      setMentionDraft(getMentionDraft(nextValue, cursor))
      setMentionActiveIndex(0)
    },
    [setMentionDraft],
  )

  const appendComposerAttachments = useCallback((incomingFiles: File[], source: 'picker' | 'drop' = 'picker') => {
    if (incomingFiles.length === 0) return

    const { allowed, rejectedCount } = filterAllowedChatAttachments(incomingFiles)
    if (rejectedCount > 0) {
      notify.error(source === 'drop' ? 'Unsupported dropped file' : 'Attachment not allowed', {
        description: 'Only images, PDF, Word, Excel, PowerPoint, ODT, RTF, and CSV files can be attached.',
      })
      return
    }

    if (allowed.length === 0) return

    setAttachments((current) => {
      const availableSlots = MAX_COMPOSER_ATTACHMENTS - current.length
      if (availableSlots <= 0) return current

      const nextAttachments = allowed.slice(0, availableSlots).map((file) => createComposerAttachment(file))
      return [...current, ...nextAttachments]
    })
  }, [])

  const uploadComposerAttachments = useCallback(async (snapshot: ChatComposerAttachment[]) => {
    return Promise.all(
      snapshot.map(async (attachment) => {
        try {
          const uploadFile = attachment.kind === 'image' ? await optimizeImageFileForUpload(attachment.file) : attachment.file
          const upload = await uploadChatAttachmentToR2(uploadFile, session?.token)
          return {
            attachment,
            upload,
            uploadFile,
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Attachment upload failed.'
          throw new Error(`${attachment.name}: ${message}`)
        }
      }),
    )
  }, [session?.token])

  const clearComposerAttachments = useCallback(() => {
    setAttachments((current) => {
      current.forEach(revokeComposerAttachmentPreview)
      return EMPTY_COMPOSER_ATTACHMENTS
    })
  }, [])

  const clearPendingVoiceMessage = useCallback((revoke = true) => {
    setPendingVoiceMessage((current) => {
      if (current && revoke) URL.revokeObjectURL(current.previewUrl)
      return null
    })
  }, [])

  const stopVoiceRecordingVisualizer = useCallback(() => {
    if (voiceAnimationFrameRef.current !== null) {
      cancelAnimationFrame(voiceAnimationFrameRef.current)
      voiceAnimationFrameRef.current = null
    }
    setRecordingLevels(createBaseWaveLevels(20))
    setRecordingElapsedMs(0)
    setIsRecordingVoice(false)
    const stream = voiceMicStreamRef.current
    stream?.getTracks().forEach((track) => track.stop())
    voiceMicStreamRef.current = null
    voiceAudioContextRef.current?.close().catch(() => {})
    voiceAudioContextRef.current = null
  }, [])

  const finalizeVoiceRecording = useCallback(
    (recorder: MediaRecorder) => {
      const durationMs = Date.now() - voiceStartAtRef.current
      const mimeType = recorder.mimeType || 'audio/webm'
      const fileExt = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('wav') ? 'wav' : mimeType.includes('mp4') ? 'm4a' : 'webm'
      const file = new File([new Blob(voiceChunksRef.current, { type: mimeType })], `voice-${Date.now()}.${fileExt}`, {
        type: mimeType,
      })
      const previewUrl = URL.createObjectURL(file)
      setPendingVoiceMessage((current) => {
        if (current) URL.revokeObjectURL(current.previewUrl)
        return { file, previewUrl, durationMs }
      })
      stopVoiceRecordingVisualizer()
      voiceMediaRecorderRef.current = null
    },
    [stopVoiceRecordingVisualizer],
  )

  const stopVoiceRecording = useCallback(() => {
    const recorder = voiceMediaRecorderRef.current
    if (!recorder) {
      stopVoiceRecordingVisualizer()
      return
    }

    try {
      if (recorder.state === 'recording' || recorder.state === 'paused') {
        recorder.stop()
        return
      }
    } catch (error) {
      console.error('Failed to stop voice recording', error)
    }

    finalizeVoiceRecording(recorder)
  }, [finalizeVoiceRecording, stopVoiceRecordingVisualizer])

  const startVoiceRecording = useCallback(async () => {
    if (isRecordingVoice) return

    if (!navigator.mediaDevices?.getUserMedia) {
      notify.error('Voice recording unavailable', {
        description: 'Voice recording is not supported in this browser.',
      })
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      voiceMicStreamRef.current = stream
      voiceChunksRef.current = []
      voiceStartAtRef.current = Date.now()
      setRecordingElapsedMs(0)

      const audioContext = new AudioContext()
      voiceAudioContextRef.current = audioContext
      const source = audioContext.createMediaStreamSource(stream)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 128
      analyser.smoothingTimeConstant = 0.85
      source.connect(analyser)

      const frequencyData = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        analyser.getByteFrequencyData(frequencyData)
        const bucketSize = Math.max(1, Math.floor(frequencyData.length / 20))
        const nextLevels = Array.from({ length: 20 }, (_, barIndex) => {
          const start = barIndex * bucketSize
          const end = Math.min(frequencyData.length, start + bucketSize)
          let sum = 0
          for (let i = start; i < end; i += 1) sum += frequencyData[i]
          const avg = sum / Math.max(1, end - start)
          return Math.max(0.12, avg / 255)
        })
        setRecordingLevels(nextLevels)
        setRecordingElapsedMs(Date.now() - voiceStartAtRef.current)
        voiceAnimationFrameRef.current = requestAnimationFrame(tick)
      }
      voiceAnimationFrameRef.current = requestAnimationFrame(tick)

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          voiceChunksRef.current.push(event.data)
        }
      }

      recorder.onstop = () => {
        finalizeVoiceRecording(recorder)
      }

      voiceMediaRecorderRef.current = recorder
      recorder.start()
      setIsRecordingVoice(true)
    } catch (error) {
      console.error('Failed to start voice recording', error)
      notify.error('Microphone permission required', {
        description: 'Allow microphone access to record a voice message.',
      })
      setIsRecordingVoice(false)
      voiceMediaRecorderRef.current = null
      stopVoiceRecordingVisualizer()
    }
  }, [finalizeVoiceRecording, isRecordingVoice, stopVoiceRecordingVisualizer])

  const handleAttachmentSelection = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = Array.from(event.target.files ?? [])
      appendComposerAttachments(selectedFiles, 'picker')
      event.target.value = ''
    },
    [appendComposerAttachments],
  )

  const openAttachmentPicker = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleComposerDragEnter = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    dragDepthRef.current += 1
    setIsDraggingFiles(true)
  }, [])

  const handleComposerDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleComposerDragLeave = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) {
      setIsDraggingFiles(false)
    }
  }, [])

  const handleComposerDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      dragDepthRef.current = 0
      setIsDraggingFiles(false)
      appendComposerAttachments(Array.from(event.dataTransfer.files ?? []), 'drop')
    },
    [appendComposerAttachments],
  )

  const chatAttachmentDragHandlers = {
    onDragEnter: handleComposerDragEnter,
    onDragOver: handleComposerDragOver,
    onDragLeave: handleComposerDragLeave,
    onDrop: handleComposerDrop,
  } as const

  const cancelEditing = useCallback(() => {
    setEditingMessageId(null)
    setDraft('')
    setMentionDraft(null)
    setMentionActiveIndex(0)
    setReplyToMessageId(null)
    void stopTypingPresence()
  }, [stopTypingPresence])

  const closeMessageActions = useCallback(() => {
    setMessageActionTarget(null)
  }, [])

  const closeAttachmentViewer = useCallback(() => {
    setAttachmentViewer(null)
  }, [])

  const scrollToMessage = useCallback((messageId: string) => {
    const target = document.getElementById(`chat-message-${messageId}`)
    if (!target) return

    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    target.classList.add('ring-2', 'ring-primary/35', 'ring-offset-2', 'ring-offset-background', 'transition', 'duration-300')
    window.setTimeout(() => {
      target.classList.remove('ring-2', 'ring-primary/35', 'ring-offset-2', 'ring-offset-background', 'transition', 'duration-300')
    }, 1200)
  }, [])

  const openAttachmentViewer = useCallback((attachment: ChatAttachmentPreviewRow) => {
    setAttachmentViewer({
      fileName: attachment.file_name,
      displaySize: attachment.displaySize,
      publicUrl: attachment.publicUrl,
      mimeType: attachment.mime_type,
      viewerMode: getAttachmentViewerMode(attachment.file_name, attachment.mime_type),
    })
  }, [])

  const attachmentCsvRows = useMemo(
    () => (attachmentCsvText ? parseCsvText(attachmentCsvText) : []),
    [attachmentCsvText],
  )

  useEffect(() => {
    if (attachmentViewer?.viewerMode !== 'csv' || !attachmentViewer.publicUrl) {
      setAttachmentCsvText(null)
      setAttachmentCsvLoading(false)
      setAttachmentCsvError(null)
      return
    }

    let cancelled = false
    setAttachmentCsvText(null)
    setAttachmentCsvLoading(true)
    setAttachmentCsvError(null)

    void fetch(attachmentViewer.publicUrl)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`CSV preview failed (${response.status})`)
        }
        return response.text()
      })
      .then((text) => {
        if (cancelled) return
        setAttachmentCsvText(text)
        setAttachmentCsvLoading(false)
      })
      .catch((error) => {
        if (cancelled) return
        setAttachmentCsvText(null)
        setAttachmentCsvLoading(false)
        setAttachmentCsvError(error instanceof Error ? error.message : 'CSV preview failed.')
      })

    return () => {
      cancelled = true
    }
  }, [attachmentViewer?.publicUrl, attachmentViewer?.viewerMode])

  const startEditingMessage = useCallback((message: ChatMessage) => {
    setEditingMessageId(message.id)
    setDraft(message.message)
    setMentionDraft(null)
    setMentionActiveIndex(0)
    setReplyToMessageId(null)
    setMessageActionTarget(null)

    window.requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
  }, [])

  const startReplyingToMessage = useCallback(
    (message: ChatMessage) => {
      setReplyToMessageId(message.id)
      setEditingMessageId(null)
      setMentionDraft(null)
      setMentionActiveIndex(0)
      setMessageActionTarget(null)

      window.requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
    },
    [],
  )

  const deleteMessage = useCallback(
    async (message: ChatMessage) => {
      if (!room?.id || !currentUser?.id || !message.mine || sending) return

      const confirmed = window.confirm('Delete this message?')
      if (!confirmed) return

      setSending(true)
      const { error: deleteError } = await supabase.from('chat_messages').delete().eq('id', message.id).eq('author_id', currentUser.id)

      if (deleteError) {
        console.error('Failed to delete chat message', deleteError)
      }

      setSending(false)
      if (!deleteError) {
        setMessageActionTarget(null)
        if (editingMessageId === message.id) cancelEditing()
        void loadChatData({ background: true })
      }
    },
    [cancelEditing, currentUser?.id, editingMessageId, loadChatData, room?.id, sending],
  )

  const sendMessage = useCallback(async () => {
    const trimmed = draft.trim()
    const attachmentsSnapshot = attachments.slice()
    const voiceSnapshot = pendingVoiceMessage
    const hasPayload = Boolean(trimmed || attachmentsSnapshot.length > 0 || voiceSnapshot)
    if (!hasPayload || !room?.id || !currentUser?.id || sending) return

    const isEditing = Boolean(editingMessageId)
    const optimisticId = isEditing ? null : createLocalId()
    const optimisticCreatedAt = optimisticId ? new Date().toISOString() : null
    const optimisticAttachments = optimisticId
      ? attachmentsSnapshot.map((attachment) => createOptimisticAttachmentPreview(attachment, optimisticId))
      : []
    const optimisticVoice = optimisticId && voiceSnapshot
      ? {
          voiceDataUrl: voiceSnapshot.previewUrl,
          voiceStorageKey: `pending/${optimisticId}/voice`,
          voiceDurationMs: voiceSnapshot.durationMs,
        }
      : null
    const previousDraft = draft

    setSending(true)
    void stopTypingPresence()
    setDraft('')
    clearComposerAttachments()
    clearPendingVoiceMessage(false)
    setMentionDraft(null)
    setMentionActiveIndex(0)
    if (optimisticId && optimisticCreatedAt) {
      setMessages((current) => [
        ...current,
        {
          id: optimisticId,
          authorId: currentUser.id,
          author: currentUser.name,
          authorHandle: currentUser.username,
          authorAvatarUrl: currentUser.avatarUrl ?? currentUser.avatarPath ?? null,
          role: currentUser.jobTitle ?? currentUser.roleLabel ?? 'Team',
          initials: getProfileInitials(currentUser.name),
          message: trimmed,
          time: 'Sending…',
          createdAt: optimisticCreatedAt,
          replyToId: replyToMessageId,
          mine: true,
          pending: true,
          editedAt: null,
          deletedAt: null,
          clientMessageId: optimisticId,
          voiceDataUrl: optimisticVoice?.voiceDataUrl ?? null,
          voiceStorageKey: optimisticVoice?.voiceStorageKey ?? null,
          voiceDurationMs: optimisticVoice?.voiceDurationMs ?? null,
          attachments: optimisticAttachments,
        },
      ])
    }
    const mentionsInMessage = extractMentionHandles(trimmed)
    const mentionedUsers = mentionOptions.filter((option) => mentionsInMessage.includes(getMentionHandle(option)))
    let uploadedAttachments: Array<{
      attachment: ChatComposerAttachment
      upload: { bucket: string; key: string; url: string }
      uploadFile: File
    }> = []
    let uploadedVoice: { bucket: string; key: string; url: string } | null = null

    if (attachmentsSnapshot.length > 0 || voiceSnapshot) {
      try {
        ;[uploadedAttachments, uploadedVoice] = await Promise.all([
          attachmentsSnapshot.length > 0 ? uploadComposerAttachments(attachmentsSnapshot) : Promise.resolve([]),
          voiceSnapshot ? uploadChatVoiceToR2(voiceSnapshot.file, session?.token) : Promise.resolve(null),
        ])
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Attachment upload failed.'
        console.error('Failed to upload chat attachments', error)
        notify.error('Attachment upload failed', {
          description: message,
        })
        optimisticAttachments.forEach(revokeAttachmentPreviewUrl)
        if (voiceSnapshot) {
          setPendingVoiceMessage(voiceSnapshot)
        }
        if (optimisticId) {
          setMessages((current) => current.filter((chatMessage) => chatMessage.id !== optimisticId))
        }
        setDraft(previousDraft)
        if (previousDraft.trim().length > 0) {
          scheduleTypingPresence(previousDraft)
        }
        setSending(false)
        return
      }
    }

    const attachmentRows = uploadedAttachments.map(({ attachment, upload, uploadFile }) => ({
      storage_bucket: upload.bucket,
      storage_path: upload.key,
      file_name: attachment.name,
      mime_type: uploadFile.type || attachment.file.type || null,
      file_size_bytes: uploadFile.size,
      attachment_kind: attachment.kind,
      metadata: {
        original_name: attachment.file.name,
        original_size_bytes: attachment.file.size,
        uploaded_size_bytes: uploadFile.size,
        optimized: uploadFile !== attachment.file,
        uploaded_name: uploadFile.name,
        uploaded_url: upload.url,
        public_url: upload.url,
      },
    }))
    const voiceMetadata = uploadedVoice
      ? {
          voice_data_url: uploadedVoice.url,
          voice_storage_key: uploadedVoice.key,
          voice_duration_ms: voiceSnapshot?.durationMs ?? null,
        }
      : null

    if (editingMessageId) {
      const { error: updateError } = await supabase
        .from('chat_messages')
        .update({
          body: trimmed,
          edited_at: new Date().toISOString(),
          metadata: {
            mention_handles: mentionsInMessage,
            ...(voiceMetadata ?? {}),
          },
        })
        .eq('id', editingMessageId)
        .eq('author_id', currentUser.id)

      if (updateError) {
        console.error('Failed to update chat message', updateError)
        notify.error('Message update failed', {
          description: 'Your message could not be updated right now.',
        })
        optimisticAttachments.forEach(revokeAttachmentPreviewUrl)
        if (voiceSnapshot) {
          setPendingVoiceMessage(voiceSnapshot)
        }
        setDraft(previousDraft)
        if (previousDraft.trim().length > 0) {
          scheduleTypingPresence(previousDraft)
        }
        if (optimisticId) {
          setMessages((current) => current.filter((chatMessage) => chatMessage.id !== optimisticId))
        }
        setSending(false)
        return
      }

      const { data: existingMentionRows, error: existingMentionError } = await supabase
        .from('chat_message_mentions')
        .select('mentioned_user_id')
        .eq('message_id', editingMessageId)

      if (existingMentionError) {
        console.error('Failed to load existing chat mentions before edit', existingMentionError)
      }

      const previousMentionIds = new Set((existingMentionRows ?? []).map((row) => row.mentioned_user_id))
      const nextMentionIds = new Set(mentionedUsers.map((user) => user.id))
      const addedMentionIds = Array.from(nextMentionIds).filter((userId) => !previousMentionIds.has(userId))

      const { error: clearMentionsError } = await supabase.from('chat_message_mentions').delete().eq('message_id', editingMessageId)
      if (clearMentionsError) {
        console.error('Failed to clear chat mentions before edit', clearMentionsError)
      } else if (mentionedUsers.length > 0) {
        const mentionRows = mentionedUsers.map((user) => ({
          message_id: editingMessageId,
          mentioned_user_id: user.id,
        }))
        const { error: mentionInsertError } = await supabase.from('chat_message_mentions').insert(mentionRows)
        if (mentionInsertError) {
          console.error('Failed to update chat mentions', mentionInsertError)
        } else if (addedMentionIds.length > 0) {
          void dispatchChatMentionEmails(editingMessageId, addedMentionIds, trimmed)
        }
      }

      if (attachmentRows.length > 0) {
        const { error: attachmentInsertError } = await supabase.from('chat_message_attachments').insert(
          attachmentRows.map((row) => ({
            ...row,
            message_id: editingMessageId,
          })),
        )

        if (attachmentInsertError) {
          console.error('Failed to insert chat attachments', attachmentInsertError)
          notify.error('Attachments could not be saved', {
            description: 'The files were uploaded, but we could not attach them to the message.',
          })
        }
      }

      setDraft('')
      clearComposerAttachments()
      cancelEditing()
      if (voiceSnapshot) {
        URL.revokeObjectURL(voiceSnapshot.previewUrl)
      }
      setSending(false)
      void loadChatData({ background: true })
      return
    }

    const { data: insertedMessage, error: insertError } = await supabase
      .from('chat_messages')
      .insert({
        room_id: room.id,
        author_id: currentUser.id,
        body: trimmed,
        reply_to_id: replyToMessageId,
        metadata: {
          mention_handles: mentionsInMessage,
          client_message_id: optimisticId,
          ...(voiceMetadata ?? {}),
        },
      })
      .select('id, created_at')
      .single()

    if (insertError || !insertedMessage) {
      console.error('Failed to create chat message', insertError)
      optimisticAttachments.forEach(revokeAttachmentPreviewUrl)
      if (voiceSnapshot) {
        setPendingVoiceMessage(voiceSnapshot)
      }
      setDraft(previousDraft)
      if (previousDraft.trim().length > 0) {
        scheduleTypingPresence(previousDraft)
      }
      if (optimisticId) {
        setMessages((current) => current.filter((chatMessage) => chatMessage.id !== optimisticId))
      }
      setSending(false)
      return
    }

    if (mentionedUsers.length > 0) {
      const mentionRows = mentionedUsers.map((user) => ({
        message_id: insertedMessage.id,
        mentioned_user_id: user.id,
      }))
      const { error: mentionInsertError } = await supabase.from('chat_message_mentions').insert(mentionRows)
      if (mentionInsertError) {
        console.error('Failed to create chat mentions', mentionInsertError)
      } else {
        void dispatchChatMentionEmails(insertedMessage.id, mentionedUsers.map((user) => user.id), trimmed)
      }
    }

    const confirmedAttachments = uploadedAttachments.map(({ attachment, upload, uploadFile }) => ({
      id: `${insertedMessage.id}-${attachment.id}`,
      message_id: insertedMessage.id,
      storage_bucket: upload.bucket,
      storage_path: upload.key,
      file_name: attachment.name,
      mime_type: uploadFile.type || attachment.file.type || null,
      file_size_bytes: uploadFile.size,
      attachment_kind: attachment.kind,
      metadata: {
        original_name: attachment.file.name,
        original_size_bytes: attachment.file.size,
        uploaded_size_bytes: uploadFile.size,
        optimized: uploadFile !== attachment.file,
        uploaded_name: uploadFile.name,
        uploaded_url: upload.url,
        public_url: upload.url,
      },
      created_at: insertedMessage.created_at,
      publicUrl: upload.url,
      displaySize: displayAttachmentSize(uploadFile.size),
    }))
    const confirmedVoice = uploadedVoice
      ? {
          voiceDataUrl: uploadedVoice.url,
          voiceStorageKey: uploadedVoice.key,
          voiceDurationMs: voiceSnapshot?.durationMs ?? null,
        }
      : null

    if (attachmentRows.length > 0) {
      const { error: attachmentInsertError } = await supabase.from('chat_message_attachments').insert(
        attachmentRows.map((row) => ({
          ...row,
          message_id: insertedMessage.id,
        })),
      )

      if (attachmentInsertError) {
        console.error('Failed to insert chat attachments', attachmentInsertError)
        notify.error('Attachments could not be saved', {
          description: 'The files were uploaded, but we could not attach them to the message.',
        })
      }
    }

    setMessages((current) =>
      optimisticId
        ? current.map((chatMessage) =>
            chatMessage.id === optimisticId
              ? {
                  ...chatMessage,
                  id: insertedMessage.id,
                  time: formatMessageTimestampLabel(insertedMessage.created_at),
                  createdAt: insertedMessage.created_at,
                  pending: false,
                  clientMessageId: optimisticId,
                  replyToId: replyToMessageId,
                  voiceDataUrl: confirmedVoice?.voiceDataUrl ?? null,
                  voiceStorageKey: confirmedVoice?.voiceStorageKey ?? null,
                  voiceDurationMs: confirmedVoice?.voiceDurationMs ?? null,
                  attachments: confirmedAttachments,
                }
              : chatMessage,
          )
        : current,
    )
    optimisticAttachments.forEach(revokeAttachmentPreviewUrl)
    if (voiceSnapshot) {
      URL.revokeObjectURL(voiceSnapshot.previewUrl)
    }
    setReplyToMessageId(null)
    setSending(false)
    void loadChatData({ background: true })
  }, [
    attachments,
    cancelEditing,
    clearComposerAttachments,
    clearPendingVoiceMessage,
    currentUser?.id,
    currentUser?.avatarPath,
    currentUser?.avatarUrl,
    currentUser?.jobTitle,
    currentUser?.name,
    currentUser?.roleLabel,
    currentUser?.username,
    draft,
    editingMessageId,
    loadChatData,
    mentionOptions,
    pendingVoiceMessage,
    replyToMessageId,
    room?.id,
    sending,
    session?.token,
    scheduleTypingPresence,
    stopTypingPresence,
    dispatchChatMentionEmails,
    uploadComposerAttachments,
  ])

  const handleDraftKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionDraft && filteredMentionOptions.length > 0 && isMentionTriggerKey(event.key)) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setMentionActiveIndex((current) => (current + 1) % filteredMentionOptions.length)
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setMentionActiveIndex((current) => (current - 1 + filteredMentionOptions.length) % filteredMentionOptions.length)
        return
      }

      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        replaceMentionDraft(filteredMentionOptions[mentionActiveIndex] ?? filteredMentionOptions[0])
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        setMentionDraft(null)
        setMentionActiveIndex(0)
        return
      }
    }

    if (event.key !== 'Enter') return
    event.preventDefault()
    void sendMessage()
  }

  const removeAttachment = useCallback((attachmentId: string) => {
    setAttachments((current) => {
      const removedAttachment = current.find((attachment) => attachment.id === attachmentId)
      if (removedAttachment) {
        revokeComposerAttachmentPreview(removedAttachment)
      }
      return current.filter((attachment) => attachment.id !== attachmentId)
    })
  }, [])

  const handleMessageLongPress = useCallback((message: ChatMessage) => {
    setMessageActionTarget(message)
  }, [])

  const scrollMessagesToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end', behavior: 'auto' })
  }, [])

  const handleAttachmentLoad = useCallback(() => {
    if (!open || !stickToLatestRef.current) return
    window.requestAnimationFrame(scrollMessagesToBottom)
  }, [open, scrollMessagesToBottom])

  useEffect(() => {
    if (!open) {
      stickToLatestRef.current = false
      hasInitialScrollRef.current = false
      return
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open || loading || error || messages.length === 0) return
    if (hasInitialScrollRef.current) return

    hasInitialScrollRef.current = true
    stickToLatestRef.current = true
    scrollMessagesToBottom()
  }, [error, loading, messages.length, open, scrollMessagesToBottom])

  useLayoutEffect(() => {
    if (!open || loading || error || messages.length === 0) return
    if (!hasInitialScrollRef.current) return
    if (!stickToLatestRef.current) return

    scrollMessagesToBottom()
  }, [error, loading, messages.length, open, scrollMessagesToBottom])

  const handleMessagesScroll = useCallback(() => {
    const container = messagesScrollRef.current
    if (!container) return

    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    if (distanceFromBottom > 48) {
      stickToLatestRef.current = false
    } else if (distanceFromBottom <= 24) {
      stickToLatestRef.current = true
    }
  }, [])

  const shouldHideChatBody = false

  useEffect(() => {
    if (open) return
    void stopTypingPresence()
  }, [open, stopTypingPresence])

  useEffect(() => {
    return () => {
      void stopTypingPresence()
    }
  }, [stopTypingPresence])

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      void stopTypingPresence()
    }
    setOpen(nextOpen)
    setIsFullscreen(false)
  }, [stopTypingPresence])

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((current) => {
      return !current
    })
  }, [])

  const messageActionsSheet = actionSheetMessage ? (
    <div className='absolute inset-0 z-30 grid place-items-center px-4'>
      <button
        type='button'
        aria-label='Close message options'
        className='absolute inset-0 bg-black/45 backdrop-blur-sm'
        onClick={closeMessageActions}
      />
      <div className='relative z-10 mx-auto w-full max-w-xs rounded-3xl border border-border/70 bg-card p-4 shadow-[0_18px_50px_hsl(var(--foreground)/0.24)]'>
        <div className='mb-3 grid grid-cols-[1.5rem_minmax(0,1fr)_1.5rem] items-start gap-2'>
          <div aria-hidden='true' />
          <div className='min-w-0 space-y-1 text-center'>
            <p className='text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground'>Message options</p>
            <p
              className='overflow-hidden break-words text-sm text-foreground'
              style={{
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
              }}
            >
              {actionSheetMessage.message}
            </p>
          </div>
          <Button
            type='button'
            variant='ghost'
            size='icon'
            className='justify-self-end h-8 w-8 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground'
            onClick={closeMessageActions}
            aria-label='Close message options'
          >
            <X className='h-4 w-4' aria-hidden='true' />
          </Button>
        </div>
        <div className='grid gap-2'>
          <Button
            type='button'
            variant='outline'
            className='h-11 justify-center rounded-2xl border-border/70 bg-background px-4 text-center'
            onClick={() => {
              startReplyingToMessage(actionSheetMessage)
              closeMessageActions()
            }}
          >
            <MessageSquareText className='mr-2 h-4 w-4 shrink-0' aria-hidden='true' />
            Reply
          </Button>
          {actionSheetMessage.mine ? (
            <>
              <Button
                type='button'
                variant='outline'
                className='h-11 justify-center rounded-2xl border-border/70 bg-background px-4 text-center'
                onClick={() => {
                  startEditingMessage(actionSheetMessage)
                  closeMessageActions()
                }}
              >
                <PencilLine className='mr-2 h-4 w-4 shrink-0' aria-hidden='true' />
                Edit message
              </Button>
              <Button
                type='button'
                variant='outline'
                className='h-11 justify-center rounded-2xl border-destructive/20 bg-destructive/5 px-4 text-center text-destructive hover:bg-destructive/10 hover:text-destructive'
                onClick={() => {
                  void deleteMessage(actionSheetMessage)
                  closeMessageActions()
                }}
              >
                <Trash2 className='mr-2 h-4 w-4 shrink-0' aria-hidden='true' />
                Delete message
              </Button>
            </>
          ) : null}
          <Button
            type='button'
            variant='ghost'
            className='h-11 rounded-2xl px-4 text-muted-foreground hover:bg-accent hover:text-foreground'
            onClick={closeMessageActions}
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  ) : null

  const renderChatSurface = (mode: 'popover' | 'fullscreen') => {
    const isFullscreenMode = mode === 'fullscreen'

    return (
      <div className={cn('relative flex min-h-0 flex-col bg-card', isFullscreenMode ? 'h-[100dvh]' : 'h-[min(56rem,calc(100vh-1rem))] max-h-[calc(100vh-1rem)]')}>
        <div
          className={cn(
            'border-b border-border/60 bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.16),transparent_42%),linear-gradient(135deg,hsl(var(--background)),hsl(var(--card))_55%)] px-4 py-4',
            isFullscreenMode && 'sticky top-0 z-20 backdrop-blur-xl',
          )}
        >
          <div className='flex items-start justify-between gap-3'>
            <div className='flex min-w-0 items-start gap-3'>
              <div className='flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-sm'>
                <Users2 className='h-5 w-5' aria-hidden='true' />
              </div>
                <div className='min-w-0 space-y-1'>
                  <div className='flex items-center gap-2'>
                    <h2 className='truncate text-sm font-semibold text-foreground'>{roomHeader.title}</h2>
                    <Badge variant='secondary' className='rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.16em]'>
                      Live
                    </Badge>
                  </div>
                  <p className='text-xs text-muted-foreground'>{roomHeader.description}</p>
                  {typingLabel ? (
                    <p className='flex items-center gap-2 text-xs font-medium text-primary'>
                      <span className='h-1.5 w-1.5 rounded-full bg-primary animate-pulse' aria-hidden='true' />
                      <span>{typingLabel}</span>
                    </p>
                  ) : null}
                </div>
              </div>
            <div className='flex items-center gap-1.5'>
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className='h-9 w-9 rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
                onClick={toggleFullscreen}
                aria-label={isFullscreen ? 'Exit full screen' : 'Expand chat'}
                aria-pressed={isFullscreen}
              >
                <span className='relative flex h-4 w-4 items-center justify-center'>
                  <Maximize2
                    className={cn(
                      'absolute h-4 w-4 transition-[opacity,transform] duration-300 ease-out',
                      isFullscreen ? 'opacity-0 scale-75 rotate-90' : 'opacity-100 scale-100 rotate-0',
                    )}
                    aria-hidden='true'
                  />
                  <Minimize2
                    className={cn(
                      'absolute h-4 w-4 transition-[opacity,transform] duration-300 ease-out',
                      isFullscreen ? 'opacity-100 scale-100 rotate-0' : 'opacity-0 scale-75 -rotate-90',
                    )}
                    aria-hidden='true'
                  />
                </span>
              </Button>
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className='h-9 w-9 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground'
                onClick={() => handleOpenChange(false)}
                aria-label='Close chat'
              >
                <X className='h-4 w-4' aria-hidden='true' />
              </Button>
            </div>
          </div>
        </div>

        <div
          ref={messagesScrollRef}
          className={cn(
            'flex-1 min-h-0 overflow-y-auto px-4 py-4 [overflow-anchor:none]',
            shouldHideChatBody && 'invisible pointer-events-none',
          )}
          onScroll={handleMessagesScroll}
        >
          <div className='mx-auto flex w-full max-w-4xl flex-col gap-4'>
            {loading ? (
              <div className='space-y-3'>
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={`chat-skeleton-${index}`} className='flex items-start gap-3'>
                    <div className='h-8 w-8 animate-pulse rounded-full bg-muted/60' />
                    <div className='flex-1 space-y-2'>
                      <div className='h-3.5 w-28 animate-pulse rounded bg-muted/60' />
                      <div className='h-10 w-full animate-pulse rounded-2xl bg-muted/40' />
                    </div>
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className='rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive'>
                {error}
              </div>
            ) : messages.length === 0 ? (
              <div className='rounded-2xl border border-dashed border-border/70 bg-muted/20 px-4 py-10 text-center'>
                <p className='text-sm font-medium text-foreground'>No messages yet</p>
                <p className='mt-1 text-xs text-muted-foreground'>Start the room with a quick update or mention someone with `@`.</p>
              </div>
            ) : (
              (() => {
                let previousDayKey: string | null = null

                return messages.map((message) => {
                  const dayKey = getMessageDayKey(message.createdAt)
                  const renderSeparator = dayKey !== previousDayKey
                  previousDayKey = dayKey

                  return (
                    <div key={message.id} className='space-y-4'>
                      {renderSeparator ? <MessageDaySeparator label={formatMessageDaySeparator(message.createdAt)} /> : null}
                      <MessageBubble
                        message={message}
                        knownHandles={mentionHandleSet}
                        onLongPress={handleMessageLongPress}
                        onOpenAttachment={openAttachmentViewer}
                        onAttachmentLoad={handleAttachmentLoad}
                        onJumpToMessage={scrollToMessage}
                        isOnline={Boolean(message.authorId && onlineUserIds.has(message.authorId))}
                        replyTarget={message.replyToId ? messageById.get(message.replyToId) ?? null : null}
                      />
                    </div>
                  )
                })
              })()
            )}
            <div ref={messagesEndRef} aria-hidden='true' />
          </div>
        </div>

        <div
          className={cn(
            'relative border-t border-border/60 bg-muted/20 p-4 transition-colors',
            isDraggingFiles ? 'bg-primary/5' : 'bg-muted/20',
          )}
        >
          <div className='mx-auto w-full max-w-4xl'>
            <div className='relative rounded-2xl border border-border/70 bg-background/95 p-3 shadow-[inset_0_1px_0_hsl(var(--foreground)/0.03)]'>
              <input
                ref={fileInputRef}
                type='file'
                accept={CHAT_ATTACHMENT_ACCEPT}
                multiple
                className='hidden'
                onChange={handleAttachmentSelection}
              />

              {editingMessage ? (
                <div className='mb-3 flex items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-primary/5 px-3 py-2'>
                  <div className='min-w-0'>
                    <p className='text-[11px] font-semibold uppercase tracking-[0.16em] text-primary'>Editing message</p>
                    <p className='truncate text-xs text-muted-foreground'>{editingMessage.message}</p>
                  </div>
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    className='h-8 rounded-full px-3 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground'
                    onClick={cancelEditing}
                  >
                    Cancel
                  </Button>
                </div>
              ) : null}

              {attachments.length > 0 ? (
                <div className='mb-3 space-y-2'>
                  <div className='flex items-center justify-between'>
                    <p className='text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground'>Attached media</p>
                    <div className='flex items-center gap-2'>
                      <p className='text-[11px] text-muted-foreground'>
                        {attachments.length} item{attachments.length === 1 ? '' : 's'}
                      </p>
                      <Button
                        type='button'
                        variant='ghost'
                        size='sm'
                        className='h-7 rounded-full px-2.5 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground'
                        onClick={clearComposerAttachments}
                      >
                        Clear all
                      </Button>
                    </div>
                  </div>
                  <div className='grid gap-2 sm:grid-cols-3 lg:grid-cols-6'>
                    {attachments.map((attachment) => (
                      <AttachmentPreview key={attachment.id} attachment={attachment} onRemove={removeAttachment} />
                    ))}
                  </div>
                </div>
              ) : null}

              {pendingVoiceMessage ? (
                <div className='relative mb-3 rounded-2xl border border-border/70 bg-muted/20 p-3 pt-4 shadow-[inset_0_1px_0_hsl(var(--foreground)/0.03)]'>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='absolute -right-2 -top-2 h-8 w-8 rounded-full border border-border/70 bg-background text-muted-foreground shadow-sm hover:bg-accent hover:text-foreground'
                    onClick={() => clearPendingVoiceMessage()}
                    aria-label='Remove voice recording'
                  >
                    <X className='h-4 w-4' aria-hidden='true' />
                  </Button>
                  <div>
                    <VoicePlayback src={pendingVoiceMessage.previewUrl} durationMs={pendingVoiceMessage.durationMs} />
                  </div>
                </div>
              ) : null}

              {replyingToMessage ? (
                <ComposerReplyPreview
                  message={{
                    id: replyingToMessage.id,
                    author: replyingToMessage.author,
                    message: replyingToMessage.deletedAt ? 'Deleted message' : replyingToMessage.message,
                    voiceDataUrl: replyingToMessage.voiceDataUrl,
                    attachments: replyingToMessage.attachments,
                  }}
                  onCancel={() => setReplyToMessageId(null)}
                />
              ) : null}

              <div className='grid items-stretch gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]'>
                <div className='relative min-w-0 h-11'>
                  {isRecordingVoice ? (
                    <div className='flex h-full items-center rounded-xl border border-border/70 bg-muted/30 px-3 pr-14 shadow-[inset_0_0_0_1px_hsl(var(--foreground)/0.04)]'>
                      <div className='grid h-6 min-w-0 flex-1 items-center gap-[2px]' style={{ gridTemplateColumns: `repeat(${recordingLevels.length}, minmax(0, 1fr))` }}>
                        {recordingLevels.map((level, index) => (
                          <span
                            key={index}
                            className='w-[2px] justify-self-center rounded-full bg-rose-500/85'
                            style={{ height: `${Math.max(4, Math.round(level * 11)) * 2}px` }}
                          />
                        ))}
                      </div>
                      <span className='ml-3 text-xs font-medium tabular-nums text-muted-foreground'>{formatVoiceDuration(recordingElapsedMs)}</span>
                    </div>
                  ) : (
                    <textarea
                      ref={inputRef}
                      value={draft}
                      onChange={(event) => {
                        const nextValue = event.target.value
                        setDraft(nextValue)
                        updateMentionContext(nextValue, event.target.selectionStart)
                        scheduleTypingPresence(nextValue)
                      }}
                      onClick={(event) => updateMentionContext(event.currentTarget.value, event.currentTarget.selectionStart)}
                      onKeyUp={(event) => updateMentionContext(event.currentTarget.value, event.currentTarget.selectionStart)}
                      onKeyDown={handleDraftKeyDown}
                      placeholder='Message'
                      rows={1}
                      className='h-full w-full resize-none rounded-xl border border-border/70 bg-muted/30 px-3 py-2.5 pr-14 text-sm leading-5 shadow-[inset_0_0_0_1px_hsl(var(--foreground)/0.04)] ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50'
                    />
                  )}
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className={cn(
                      'absolute right-2 top-1/2 h-8 w-8 -translate-y-1/2 rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                      isRecordingVoice && 'border border-rose-500/40 bg-rose-500/10 text-rose-500 hover:bg-rose-500/15',
                    )}
                    aria-label={isRecordingVoice ? 'Stop recording voice message' : 'Record voice message'}
                    onPointerDown={(event) => {
                      event.preventDefault()
                      if (isRecordingVoice) {
                        stopVoiceRecording()
                        return
                      }
                      void startVoiceRecording()
                    }}
                    onClick={(event) => {
                      if (event.detail !== 0) return
                      event.preventDefault()
                      if (isRecordingVoice) {
                        stopVoiceRecording()
                        return
                      }
                      void startVoiceRecording()
                    }}
                  >
                    {isRecordingVoice ? <Square className='h-3.5 w-3.5' aria-hidden='true' /> : <Mic className='h-4 w-4' aria-hidden='true' />}
                  </Button>
                </div>
                <Button
                  type='button'
                  variant='outline'
                  size='icon'
                  className='h-11 w-11 shrink-0 rounded-xl border-border/70 bg-muted/20'
                  aria-label='Attach file'
                  onClick={openAttachmentPicker}
                >
                  <Paperclip className='h-4 w-4' aria-hidden='true' />
                </Button>
                <Button
                  type='button'
                  size='icon'
                  className='h-11 w-11 shrink-0 rounded-xl'
                  onClick={() => void sendMessage()}
                  aria-label={editingMessage ? 'Update message' : 'Send message'}
                  disabled={sending || isRecordingVoice || !room?.id || !currentUser?.id}
                >
                  {editingMessage ? <Check className='h-4 w-4' aria-hidden='true' /> : <Send className='h-4 w-4' aria-hidden='true' />}
                </Button>
              </div>
              {isDraggingFiles ? (
                <div className='absolute inset-3 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/40 bg-background/85 px-4 py-6 text-center shadow-[0_10px_30px_hsl(var(--foreground)/0.08)]'>
                  <div className='space-y-1'>
                    <p className='text-sm font-semibold text-foreground'>Drop files to attach</p>
                    <p className='text-xs text-muted-foreground'>Images, PDFs, Word docs, spreadsheets, and slides are supported.</p>
                  </div>
                </div>
              ) : null}
              {mentionDraft ? (
                <div className='absolute bottom-[calc(100%+0.75rem)] left-3 right-3 z-20 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-[var(--elevation-lg)]'>
                  <div className='flex items-center justify-between border-b border-border/60 px-3 py-2'>
                    <p className='text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground'>Mention someone</p>
                    <p className='text-[11px] text-muted-foreground'>
                      {filteredMentionOptions.length} match{filteredMentionOptions.length === 1 ? '' : 'es'}
                    </p>
                  </div>
                  <div className='max-h-56 overflow-y-auto p-2'>
                    {filteredMentionOptions.length > 0 ? (
                      filteredMentionOptions.map((option, index) => {
                        const active = index === mentionActiveIndex
                        return (
                          <button
                            key={option.id}
                            type='button'
                            onMouseDown={(event) => {
                              event.preventDefault()
                              replaceMentionDraft(option)
                            }}
                            className={cn(
                              'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors',
                              active ? 'bg-primary/10 text-primary' : 'hover:bg-accent hover:text-foreground',
                            )}
                          >
                            <Avatar className='h-9 w-9 border border-border/70 shadow-sm'>
                              {option.avatarUrl ? <AvatarImage src={option.avatarUrl} alt={option.name} /> : null}
                              <AvatarFallback className={cn('text-xs font-semibold', active ? 'bg-primary/10 text-primary' : 'bg-muted text-foreground')}>
                                {getProfileInitials(option.name)}
                              </AvatarFallback>
                            </Avatar>
                            <div className='min-w-0 flex-1'>
                              <p className='truncate text-sm font-medium'>{option.name}</p>
                              <p className='truncate text-xs text-muted-foreground'>
                                @{option.username} · {option.role}
                              </p>
                            </div>
                          </button>
                        )
                      })
                    ) : (
                      <div className='px-3 py-4 text-sm text-muted-foreground'>No matching users.</div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <Button
        type='button'
        size='icon'
        className={cn(
          'fixed bottom-4 right-4 z-[60] h-14 w-14 rounded-full bg-primary shadow-[var(--elevation-lg)] transition-transform duration-200 hover:scale-105 hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:bottom-6 sm:right-6',
          (open || isFullscreen) && 'hidden',
        )}
        aria-label={open ? 'Close group chat' : 'Open group chat'}
        aria-expanded={open}
        aria-controls='group-chat-panel'
        onClick={() => handleOpenChange(!open)}
      >
        {open ? <X className='h-6 w-6' aria-hidden='true' /> : <MessageSquareText className='h-6 w-6' aria-hidden='true' />}
      </Button>

      {open && !isFullscreen ? (
        <div className='fixed inset-0 z-[55]' {...chatAttachmentDragHandlers}>
          <button
            type='button'
            aria-label='Close group chat'
            className='absolute inset-0 bg-transparent'
            onClick={() => handleOpenChange(false)}
          />
          <div
            id='group-chat-panel'
            className='absolute bottom-4 right-4 w-[calc(100vw-1rem)] max-w-[30rem] overflow-hidden rounded-3xl border border-border/70 p-0 shadow-[0_40px_120px_rgba(15,23,42,0.24),0_12px_28px_rgba(15,23,42,0.10)] ring-1 ring-slate-200/80 dark:shadow-[var(--elevation-lg)] dark:ring-0 sm:bottom-6 sm:right-6 sm:w-[30rem]'
            onClick={(event) => event.stopPropagation()}
          >
            {renderChatSurface('popover')}
            {messageActionsSheet}
          </div>
        </div>
      ) : null}
      <Dialog
        open={open && isFullscreen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            handleOpenChange(false)
          }
        }}
      >
        <DialogContent
          showClose={false}
          style={{ zIndex: 80 }}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          className='left-0 top-0 h-[100dvh] max-h-[100dvh] w-[100vw] max-w-none translate-x-0 translate-y-0 rounded-none border-0 bg-background p-0 shadow-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 data-[state=open]:duration-300 data-[state=closed]:duration-200'
        >
          <DialogTitle className='sr-only'>{roomHeader.title}</DialogTitle>
          <DialogDescription className='sr-only'>{roomHeader.description}</DialogDescription>
          <div className='relative h-full w-full' {...chatAttachmentDragHandlers}>
            {renderChatSurface('fullscreen')}
            {messageActionsSheet}
          </div>
        </DialogContent>
      </Dialog>
      <DocumentViewerModal
        open={Boolean(attachmentViewer)}
        title={attachmentViewer?.fileName ?? 'Attachment viewer'}
        subtitle={attachmentViewer?.displaySize ?? null}
        kindLabel={attachmentViewer ? getDocumentTypeLabel(attachmentViewer.fileName) : null}
        viewerMode={attachmentViewer?.viewerMode ?? null}
        resolvedUrl={attachmentViewer?.publicUrl ?? null}
        csvRows={attachmentCsvRows}
        csvLoading={attachmentCsvLoading}
        csvError={attachmentCsvError}
        onClose={closeAttachmentViewer}
        contentStyle={{ zIndex: 90 }}
        headerActions={
          attachmentViewer?.publicUrl ? (
            <>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() => {
                  const link = document.createElement('a')
                  link.href = attachmentViewer.publicUrl ?? ''
                  link.download = attachmentViewer.fileName
                  link.rel = 'noopener noreferrer'
                  document.body.appendChild(link)
                  link.click()
                  link.remove()
                }}
              >
                <Download className='mr-2 h-4 w-4' aria-hidden='true' />
                Download
              </Button>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() => {
                  window.open(attachmentViewer.publicUrl ?? '', '_blank', 'noopener,noreferrer')
                }}
              >
                <ExternalLink className='mr-2 h-4 w-4' aria-hidden='true' />
                Open file
              </Button>
            </>
          ) : null
        }
      />
    </>
  )
}
