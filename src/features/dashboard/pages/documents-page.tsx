import { formatDistanceToNowStrict } from 'date-fns'
import {
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Download,
  FolderPlus,
  GripVertical,
  Info,
  LayoutGrid,
  LayoutList,
  MoreVertical,
  Loader2,
  Search,
  RotateCcw,
  HardDrive,
  Shield,
  FileType,
  SlidersHorizontal,
  Upload,
  Trash2,
  UserRound,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { DocumentViewerModal } from '@/components/document-viewer-modal'
import { useAuth } from '@/features/auth/context/auth-context'
import { notify } from '@/lib/notify'
import {
  getAttachmentExtension,
  getDocumentStyle,
  getDocumentTypeLabel,
  getDocumentViewerMode,
  getExcelViewerUrl,
  parseCsvText,
} from '@/lib/document-preview'
import { supabase } from '@/lib/supabase'
import { deleteDriveDocumentFromR2, resolveR2ObjectUrl, uploadDriveDocumentToR2 } from '@/lib/r2'
import { cn } from '@/lib/utils'

type DriveFolder = {
  id: string
  parentId: string | null
  ownerId: string | null
  visibility: 'shared' | 'private'
  name: string
  sortOrder: number
  deletedAt: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

type DriveDocument = {
  id: string
  folderId: string | null
  ownerId: string | null
  visibility: 'shared' | 'private'
  storageBucket: string
  storagePath: string
  name: string
  mimeType: string
  size: number
  sortOrder: number
  deletedAt: string | null
  uploadedBy: string | null
  uploadedAt: string
  updatedAt: string
}

type DriveState = {
  folders: DriveFolder[]
  documents: DriveDocument[]
  activeFolderId: string | null
  view: 'drive' | 'trash'
}

type DragPayload = {
  kind: 'folder'
  id: string
}

type UploadStatus = 'uploading' | 'saving' | 'done' | 'error'

type UploadProgressItem = {
  id: string
  name: string
  size: number
  progress: number
  status: UploadStatus
  error?: string
}

type UserProfileSummary = {
  id: string
  fullName: string | null
  username: string | null
  email: string | null
}

type DocumentFilter = 'all' | 'images' | 'pdf' | 'docs' | 'sheets' | 'slides' | 'text'
type DocumentSort = 'newest' | 'oldest' | 'name-asc' | 'name-desc' | 'size-desc' | 'size-asc'
type DocumentLayout = 'cards' | 'list'

const DRIVE_ACCEPT =
  'image/*,application/pdf,.pdf,application/msword,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,application/vnd.oasis.opendocument.text,.odt,application/rtf,.rtf,text/rtf,.rtf,application/vnd.ms-excel,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx,text/csv,.csv,application/vnd.oasis.opendocument.spreadsheet,.ods,application/vnd.ms-powerpoint,.ppt,application/vnd.openxmlformats-officedocument.presentationml.presentation,.pptx,application/vnd.oasis.opendocument.presentation,.odp,text/plain,.txt'

const DOCUMENT_FILTER_OPTIONS: Array<{ value: DocumentFilter; label: string }> = [
  { value: 'all', label: 'All files' },
  { value: 'images', label: 'Images' },
  { value: 'pdf', label: 'PDFs' },
  { value: 'docs', label: 'Word documents' },
  { value: 'sheets', label: 'Spreadsheets' },
  { value: 'slides', label: 'Presentations' },
  { value: 'text', label: 'Text files' },
]

const DOCUMENT_SORT_OPTIONS: Array<{ value: DocumentSort; label: string; description: string }> = [
  { value: 'newest', label: 'Newest first', description: 'Show the most recently uploaded files first.' },
  { value: 'oldest', label: 'Oldest first', description: 'Show the oldest uploaded files first.' },
  { value: 'name-asc', label: 'Name: A to Z', description: 'Sort file names from A through Z.' },
  { value: 'name-desc', label: 'Name: Z to A', description: 'Sort file names from Z through A.' },
  { value: 'size-desc', label: 'Size: Largest to smallest', description: 'Show the largest files first.' },
  { value: 'size-asc', label: 'Size: Smallest to largest', description: 'Show the smallest files first.' },
]

const ACTIVE_FOLDER_STORAGE_KEY = 'contas-crm-documents-active-folder'

function readStoredActiveFolderId() {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(ACTIVE_FOLDER_STORAGE_KEY)
  } catch {
    return null
  }
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const rounded = value >= 10 || unitIndex === 0 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded} ${units[unitIndex]}`
}

function getFileKind(file: DriveDocument) {
  if (file.mimeType.startsWith('image/')) return 'Image'
  if (file.mimeType === 'application/pdf') return 'PDF'
  if (
    file.mimeType.includes('spreadsheet') ||
    file.mimeType === 'application/vnd.ms-excel' ||
    getAttachmentExtension(file.name) === 'csv' ||
    file.mimeType === 'text/csv'
  ) {
    return 'Sheet'
  }
  if (file.mimeType.includes('wordprocessingml') || file.mimeType === 'application/msword') return 'Document'
  if (file.mimeType.includes('presentation') || file.mimeType === 'application/vnd.ms-powerpoint') return 'Slide'
  if (file.mimeType.startsWith('text/')) return 'Text'
  return 'File'
}

function folderPath(folderMap: Map<string, DriveFolder>, folderId: string | null) {
  if (!folderId) return [{ id: null, name: 'My Drive' }]
  const segments: Array<{ id: string | null; name: string }> = []
  let current = folderMap.get(folderId) ?? null
  while (current) {
    segments.push({ id: current.id, name: current.name })
    current = current.parentId ? folderMap.get(current.parentId) ?? null : null
  }
  return [{ id: null, name: 'My Drive' }, ...segments.reverse()]
}

function previewWords(value: string, count: number) {
  const words = value.split(/\s+/).filter(Boolean)
  if (words.length <= count) return value
  return `${words.slice(0, count).join(' ')}...`
}

function formatDocumentUploadDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'Africa/Blantyre',
  }).format(date)
}

function hasFilePayload(event: DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.types).includes('Files')
}

function getUploadStatusLabel(status: UploadStatus) {
  if (status === 'saving') return 'Saving metadata'
  if (status === 'done') return 'Done'
  if (status === 'error') return 'Failed'
  return 'Uploading'
}

function getProfileDisplayName(profile?: Pick<UserProfileSummary, 'fullName' | 'username' | 'email'> | null) {
  if (!profile) return 'Unknown user'
  return profile.fullName ?? profile.username ?? profile.email ?? 'Unknown user'
}

function getDocumentFilterCategory(file: DriveDocument): DocumentFilter {
  const extension = getAttachmentExtension(file.name)

  if (
    file.mimeType.startsWith('image/') ||
    ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif'].includes(extension)
  ) {
    return 'images'
  }

  if (file.mimeType === 'application/pdf' || extension === 'pdf') {
    return 'pdf'
  }

  if (file.mimeType.includes('spreadsheet') || file.mimeType === 'application/vnd.ms-excel' || ['xlsx', 'xls', 'csv', 'ods'].includes(extension)) {
    return 'sheets'
  }

  if (file.mimeType.includes('presentation') || file.mimeType === 'application/vnd.ms-powerpoint' || ['pptx', 'ppt', 'odp'].includes(extension)) {
    return 'slides'
  }

  if (file.mimeType.includes('wordprocessingml') || file.mimeType === 'application/msword' || ['docx', 'doc', 'odt', 'rtf'].includes(extension)) {
    return 'docs'
  }

  if (
    file.mimeType.startsWith('text/') ||
    extension === 'txt' ||
    extension === 'md' ||
    extension === 'json'
  ) {
    return 'text'
  }

  return 'docs'
}

function FolderMark({ className, active = false }: { className?: string; active?: boolean }) {
  return (
    <span
      aria-hidden='true'
      className={cn('inline-block shrink-0', className)}
      style={{
        backgroundImage: active
          ? 'linear-gradient(180deg, hsl(var(--primary) / 1) 0%, hsl(var(--primary) / 0.94) 52%, hsl(var(--primary) / 0.82) 100%)'
          : 'linear-gradient(180deg, hsl(var(--primary) / 0.96) 0%, hsl(var(--primary) / 0.88) 52%, hsl(var(--primary) / 0.74) 100%)',
        WebkitMaskImage: "url('/Svg/Folder.svg')",
        maskImage: "url('/Svg/Folder.svg')",
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
      }}
    />
  )
}

function isSharedRootFolder(folder: DriveFolder) {
  return folder.parentId === null && folder.visibility === 'shared' && folder.name === 'Shared'
}

function sortDocuments(documents: DriveDocument[], sort: DocumentSort) {
  return [...documents].sort((left, right) => {
    switch (sort) {
      case 'oldest':
        return (
          new Date(left.uploadedAt).getTime() - new Date(right.uploadedAt).getTime() ||
          left.name.localeCompare(right.name)
        )
      case 'name-asc':
        return left.name.localeCompare(right.name) || new Date(right.uploadedAt).getTime() - new Date(left.uploadedAt).getTime()
      case 'name-desc':
        return right.name.localeCompare(left.name) || new Date(right.uploadedAt).getTime() - new Date(left.uploadedAt).getTime()
      case 'size-desc':
        return right.size - left.size || left.name.localeCompare(right.name)
      case 'size-asc':
        return left.size - right.size || left.name.localeCompare(right.name)
      case 'newest':
      default:
        return (
          new Date(right.uploadedAt).getTime() - new Date(left.uploadedAt).getTime() ||
          left.name.localeCompare(right.name)
        )
    }
  })
}

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted/60', className)} />
}

function DocumentsPageSkeleton() {
  return (
    <div className='flex min-h-[calc(100dvh-6rem)] w-full flex-col gap-6'>
      <div className='grid min-h-0 flex-1 gap-6 xl:grid-cols-[300px_minmax(0,1fr)]'>
        <aside className='flex h-full flex-col rounded-2xl border bg-card/70 p-4 shadow-sm'>
          <div className='space-y-4'>
            <SkeletonBlock className='h-4 w-24' />
            <div className='space-y-2'>
              <SkeletonBlock className='h-11 w-full rounded-xl' />
              <SkeletonBlock className='h-11 w-full rounded-xl' />
              <SkeletonBlock className='h-11 w-full rounded-xl' />
              <SkeletonBlock className='h-11 w-4/5 rounded-xl' />
            </div>
          </div>
          <div className='mt-auto space-y-3 border-t border-border/70 pt-4'>
            <SkeletonBlock className='h-10 w-full rounded-xl' />
            <SkeletonBlock className='h-4 w-28' />
          </div>
        </aside>

        <main className='flex min-h-0 min-w-0 flex-col gap-4'>
          <section className='flex min-h-0 flex-1 flex-col rounded-2xl border bg-card/70 p-4 shadow-sm'>
            <div className='flex flex-wrap items-start justify-between gap-4'>
              <div className='space-y-3'>
                <SkeletonBlock className='h-4 w-24' />
                <SkeletonBlock className='h-6 w-40' />
                <div className='flex flex-wrap items-center gap-2'>
                  <SkeletonBlock className='h-7 w-24 rounded-full' />
                  <SkeletonBlock className='h-7 w-28 rounded-full' />
                </div>
              </div>
              <div className='flex flex-wrap items-center gap-3'>
                <SkeletonBlock className='h-10 w-[260px] rounded-full' />
                <SkeletonBlock className='h-10 w-28 rounded-xl' />
                <SkeletonBlock className='h-10 w-28 rounded-xl' />
                <SkeletonBlock className='h-10 w-24 rounded-xl' />
              </div>
            </div>

            <div className='mt-4 min-h-0 flex-1 space-y-8'>
              <section className='space-y-3'>
                <div className='flex items-center justify-between gap-3'>
                  <div className='space-y-1'>
                    <SkeletonBlock className='h-4 w-24' />
                    <SkeletonBlock className='h-3 w-20' />
                  </div>
                </div>
                <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'>
                  {Array.from({ length: 3 }, (_, index) => (
                    <div key={`drive-folder-skeleton-${index}`} className='rounded-[1.6rem] border border-border/70 bg-card/80 p-4 shadow-sm'>
                      <div className='flex items-start justify-between gap-2'>
                        <SkeletonBlock className='h-8 w-8 rounded-lg' />
                        <SkeletonBlock className='h-5 w-12 rounded-full' />
                      </div>
                      <div className='mt-4 space-y-3'>
                        <SkeletonBlock className='h-24 w-full rounded-[1.4rem]' />
                        <div className='space-y-2'>
                          <SkeletonBlock className='h-4 w-32 max-w-full' />
                          <SkeletonBlock className='h-3 w-20 max-w-full' />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className='space-y-3'>
                <div className='flex items-end justify-between gap-3 px-1'>
                  <div className='space-y-2'>
                    <SkeletonBlock className='h-4 w-16' />
                    <SkeletonBlock className='h-3 w-20' />
                  </div>
                  <div className='flex items-center gap-2'>
                    <SkeletonBlock className='h-7 w-24 rounded-full' />
                    <SkeletonBlock className='h-7 w-24 rounded-full' />
                    <SkeletonBlock className='h-9 w-20 rounded-full' />
                  </div>
                </div>
                <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5'>
                  {Array.from({ length: 5 }, (_, index) => (
                    <div
                      key={`drive-file-skeleton-${index}`}
                      className='rounded-xl border border-border/70 bg-card/80 p-2 shadow-[0_6px_18px_hsl(var(--foreground)/0.05)]'
                    >
                      <div className='flex items-center gap-2'>
                        <SkeletonBlock className='h-4 w-4 shrink-0 rounded-sm' />
                        <SkeletonBlock className='h-4 flex-1 rounded-md' />
                        <SkeletonBlock className='h-7 w-7 rounded-full' />
                      </div>
                      <div className='mt-2 overflow-hidden rounded-lg border border-border/70'>
                        <SkeletonBlock className='aspect-square w-full rounded-none' />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}

export function DocumentsPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [state, setState] = useState<DriveState>({
    folders: [],
    documents: [],
    activeFolderId: readStoredActiveFolderId(),
    view: 'drive',
  })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [documentLayout, setDocumentLayout] = useState<DocumentLayout>('list')
  const [documentFilter, setDocumentFilter] = useState<DocumentFilter>('all')
  const [documentSort, setDocumentSort] = useState<DocumentSort>('newest')
  const [filtersDrawerOpen, setFiltersDrawerOpen] = useState(false)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [dragging, setDragging] = useState<DragPayload | null>(null)
  const [dropTarget, setDropTarget] = useState<string | 'root' | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadItems, setUploadItems] = useState<UploadProgressItem[]>([])
  const [uploadTargetLabel, setUploadTargetLabel] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [previewDocumentId, setPreviewDocumentId] = useState<string | null>(null)
  const [infoDocumentId, setInfoDocumentId] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [csvPreviewText, setCsvPreviewText] = useState<string | null>(null)
  const [csvPreviewLoading, setCsvPreviewLoading] = useState(false)
  const [csvPreviewError, setCsvPreviewError] = useState<string | null>(null)
  const [cardPreviewUrls, setCardPreviewUrls] = useState<Record<string, string>>({})
  const [userProfilesById, setUserProfilesById] = useState<Record<string, UserProfileSummary>>({})
  const { currentUser } = useAuth()

  const refreshDrive = async () => {
    const [foldersResult, documentsResult] = await Promise.all([
      supabase.from('drive_folders').select('id,parent_id,owner_id,visibility,name,sort_order,deleted_at,created_by,created_at,updated_at').order('sort_order', { ascending: true }),
      supabase.from('drive_documents').select('id,folder_id,owner_id,visibility,storage_bucket,storage_path,file_name,mime_type,file_size_bytes,sort_order,deleted_at,uploaded_by,created_at,updated_at').order('sort_order', { ascending: true }),
    ])

    if (foldersResult.error) {
      setStatusMessage(foldersResult.error.message)
      return false
    }
    if (documentsResult.error) {
      setStatusMessage(documentsResult.error.message)
      return false
    }

    const ownerIds = Array.from(
      new Set((documentsResult.data ?? []).map((document) => document.owner_id).filter((value): value is string => Boolean(value))),
    )
    const uploadedByIds = Array.from(
      new Set((documentsResult.data ?? []).map((document) => document.uploaded_by).filter((value): value is string => Boolean(value))),
    )
    const profileIds = Array.from(new Set([...ownerIds, ...uploadedByIds]))

    let profileMap: Record<string, UserProfileSummary> = {}
    if (profileIds.length > 0) {
      const profilesResult = await supabase.from('profiles').select('id,full_name,username,email').in('id', profileIds)
      if (profilesResult.error) {
        setStatusMessage(profilesResult.error.message)
      } else {
        profileMap = Object.fromEntries(
          (profilesResult.data ?? []).map((profile) => [
            profile.id,
            {
              id: profile.id,
              fullName: profile.full_name ?? null,
              username: profile.username ?? null,
              email: profile.email ?? null,
            },
          ]),
        )
      }
    }

    setState((current) => ({
      ...current,
      folders: (foldersResult.data ?? []).map((folder) => ({
        id: folder.id,
        parentId: folder.parent_id,
        ownerId: folder.owner_id,
        visibility: folder.visibility,
        name: folder.name,
        sortOrder: Number(folder.sort_order ?? 0),
        deletedAt: folder.deleted_at,
        createdBy: folder.created_by,
        createdAt: folder.created_at,
        updatedAt: folder.updated_at,
      })),
      documents: (documentsResult.data ?? []).map((document) => ({
        id: document.id,
        folderId: document.folder_id,
        ownerId: document.owner_id,
        visibility: document.visibility,
        storageBucket: document.storage_bucket,
        storagePath: document.storage_path,
        name: document.file_name,
        mimeType: document.mime_type ?? 'application/octet-stream',
        size: Number(document.file_size_bytes ?? 0),
        sortOrder: Number(document.sort_order ?? 0),
        deletedAt: document.deleted_at,
        uploadedBy: document.uploaded_by,
        uploadedAt: document.created_at,
        updatedAt: document.updated_at,
      })),
    }))
    setUserProfilesById(profileMap)
    return true
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        await refreshDrive()
      } catch (error) {
        if (!cancelled) {
          setStatusMessage(error instanceof Error ? error.message : 'Failed to load documents.')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const folderMap = useMemo(() => new Map(state.folders.map((folder) => [folder.id, folder])), [state.folders])
  const driveFolders = useMemo(() => state.folders.filter((folder) => folder.deletedAt === null), [state.folders])
  const trashedFolders = useMemo(() => state.folders.filter((folder) => folder.deletedAt !== null), [state.folders])
  const trashedDocuments = useMemo(() => state.documents.filter((document) => document.deletedAt !== null), [state.documents])
  const allFoldersByParent = useMemo(() => {
    const map = new Map<string | null, DriveFolder[]>()
    for (const folder of state.folders) {
      const list = map.get(folder.parentId) ?? []
      list.push(folder)
      map.set(folder.parentId, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    }
    return map
  }, [state.folders])
  const foldersByParent = useMemo(() => {
    const map = new Map<string | null, DriveFolder[]>()
    for (const folder of driveFolders) {
      const list = map.get(folder.parentId) ?? []
      list.push(folder)
      map.set(folder.parentId, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    }
    return map
  }, [driveFolders])

  const isTrashView = state.view === 'trash'
  const activeFolderId = isTrashView ? null : state.activeFolderId
  const activeFolder = activeFolderId ? folderMap.get(activeFolderId) ?? null : null
  const activeFolderVisible = activeFolder?.deletedAt === null ? activeFolder : null
  const breadcrumbs = useMemo(() => {
    if (isTrashView) return [{ id: 'trash' as const, name: 'Trash' }]
    return folderPath(folderMap, activeFolderId)
  }, [activeFolderId, folderMap, isTrashView])
  const visibleFolders = useMemo(() => {
    if (isTrashView) return []
    const folders = foldersByParent.get(activeFolderId) ?? []
    const query = search.trim().toLowerCase()
    if (!query) return folders
    return folders.filter((folder) => folder.name.toLowerCase().includes(query))
  }, [activeFolderId, foldersByParent, isTrashView, search])

  const visibleDocuments = useMemo(() => {
    if (isTrashView) return []
    const query = search.trim().toLowerCase()
    const docs = activeFolderId ? state.documents.filter((document) => document.folderId === activeFolderId && document.deletedAt === null) : []
    const filtered = docs.filter((document) => {
      const matchesSearch = !query || `${document.name} ${document.mimeType}`.toLowerCase().includes(query)
      const matchesFilter = documentFilter === 'all' || getDocumentFilterCategory(document) === documentFilter
      return matchesSearch && matchesFilter
    })
    return sortDocuments(filtered, documentSort)
  }, [activeFolderId, documentFilter, documentSort, isTrashView, search, state.documents])

  const trashQuery = search.trim().toLowerCase()
  const visibleTrashFolders = useMemo(() => {
    if (!isTrashView) return []
    if (!trashQuery) return trashedFolders
    return trashedFolders.filter((folder) => `${folder.name} ${folder.parentId ? folderMap.get(folder.parentId)?.name ?? '' : 'My Drive'}`.toLowerCase().includes(trashQuery))
  }, [folderMap, isTrashView, trashQuery, trashedFolders])

  const visibleTrashDocuments = useMemo(() => {
    if (!isTrashView) return []
    const filtered = !trashQuery
      ? trashedDocuments
      : trashedDocuments.filter((document) => `${document.name} ${folderMap.get(document.folderId ?? '')?.name ?? 'My Drive'}`.toLowerCase().includes(trashQuery))
    return sortDocuments(filtered, documentSort)
  }, [documentSort, folderMap, isTrashView, trashQuery, trashedDocuments])

  const selectedDocumentFilterLabel = useMemo(
    () => DOCUMENT_FILTER_OPTIONS.find((option) => option.value === documentFilter)?.label ?? 'All files',
    [documentFilter],
  )
  const selectedDocumentSortLabel = useMemo(
    () => DOCUMENT_SORT_OPTIONS.find((option) => option.value === documentSort)?.label ?? 'Newest first',
    [documentSort],
  )
  const activeFilterCount = Number(documentFilter !== 'all') + Number(documentSort !== 'newest')

  const selectedDocument = useMemo(
    () => state.documents.find((document) => document.id === previewDocumentId && document.deletedAt === null) ?? null,
    [previewDocumentId, state.documents],
  )
  const selectedInfoDocument = useMemo(
    () => state.documents.find((document) => document.id === infoDocumentId && document.deletedAt === null) ?? null,
    [infoDocumentId, state.documents],
  )
  const selectedInfoDocumentStyle = useMemo(
    () => (selectedInfoDocument ? getDocumentStyle(selectedInfoDocument.name) : null),
    [selectedInfoDocument],
  )
  const InfoDocumentIcon = selectedInfoDocumentStyle?.Icon
  const selectedInfoDocumentUploader = useMemo(() => {
    if (!selectedInfoDocument?.uploadedBy) return null
    return userProfilesById[selectedInfoDocument.uploadedBy] ?? null
  }, [selectedInfoDocument, userProfilesById])
  const selectedInfoDocumentUploaderLabel = useMemo(() => {
    if (!selectedInfoDocument) return null
    if (selectedInfoDocument.uploadedBy && selectedInfoDocument.uploadedBy === currentUser?.id) {
      return 'You'
    }
    return getProfileDisplayName(selectedInfoDocumentUploader)
  }, [currentUser?.id, selectedInfoDocument, selectedInfoDocumentUploader])
  const getDocumentUploaderLabel = (document: DriveDocument) => {
    if (document.uploadedBy && document.uploadedBy === currentUser?.id) {
      return 'You'
    }
    if (!document.uploadedBy) return 'Unknown'
    return getProfileDisplayName(userProfilesById[document.uploadedBy] ?? null)
  }
  const selectedDocumentViewerMode = useMemo(
    () => (selectedDocument ? getDocumentViewerMode(selectedDocument.name, selectedDocument.mimeType) : null),
    [selectedDocument],
  )
  const selectedDocumentExcelUrl = useMemo(
    () => (previewUrl && selectedDocumentViewerMode === 'csv' ? getExcelViewerUrl(previewUrl) : null),
    [previewUrl, selectedDocumentViewerMode],
  )
  const selectedDocumentCsvRows = useMemo(
    () => (csvPreviewText ? parseCsvText(csvPreviewText) : []),
    [csvPreviewText],
  )
  const trashCount = trashedFolders.length + trashedDocuments.length
  const draggingFolder = useMemo(
    () => (dragging?.kind === 'folder' ? folderMap.get(dragging.id) ?? null : null),
    [dragging, folderMap],
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (state.view !== 'drive' || !state.activeFolderId) {
      window.localStorage.removeItem(ACTIVE_FOLDER_STORAGE_KEY)
      return
    }
    window.localStorage.setItem(ACTIVE_FOLDER_STORAGE_KEY, state.activeFolderId)
  }, [state.activeFolderId, state.view])

  useEffect(() => {
    if (loading || state.view !== 'drive' || !state.activeFolderId) return
    if (state.folders.length === 0) return
    if (activeFolderVisible) return

    setState((current) => ({
      ...current,
      activeFolderId: null,
    }))
  }, [activeFolderVisible, loading, state.activeFolderId, state.folders.length, state.view])

  const getFolderSubtreeDocumentPaths = (folderId: string) => {
    const descendantFolderIds = new Set<string>()

    const visit = (currentFolderId: string) => {
      if (descendantFolderIds.has(currentFolderId)) return
      descendantFolderIds.add(currentFolderId)
      const childFolders = allFoldersByParent.get(currentFolderId) ?? []
      for (const childFolder of childFolders) {
        visit(childFolder.id)
      }
    }

    visit(folderId)

    const documentPaths = new Set<string>()
    for (const document of state.documents) {
      if (document.folderId && descendantFolderIds.has(document.folderId)) {
        documentPaths.add(document.storagePath)
      }
    }

    return Array.from(documentPaths)
  }
  const deleteDriveObjects = async (storagePaths: string[]) => {
    const uniquePaths = Array.from(new Set(storagePaths.filter(Boolean)))
    if (uniquePaths.length === 0) return
    await Promise.all(uniquePaths.map((path) => deleteDriveDocumentFromR2(path)))
  }
  const folderOverview = useMemo(() => {
    const documentsByFolder = new Map<string | null, DriveDocument[]>()
    for (const document of state.documents) {
      if (document.deletedAt !== null) continue
      const list = documentsByFolder.get(document.folderId) ?? []
      list.push(document)
      documentsByFolder.set(document.folderId, list)
    }

    const totals = new Map<string, { folders: number; documents: number; bytes: number }>()
    const visited = new Set<string>()

    const walk = (folderId: string) => {
      if (visited.has(folderId)) {
        return totals.get(folderId) ?? { folders: 0, documents: 0, bytes: 0 }
      }
      visited.add(folderId)

      const childFolders = foldersByParent.get(folderId) ?? []
      const directDocuments = documentsByFolder.get(folderId) ?? []
      const summary = {
        folders: childFolders.length,
        documents: directDocuments.length,
        bytes: directDocuments.reduce((sum, document) => sum + document.size, 0),
      }

      for (const childFolder of childFolders) {
        const childSummary = walk(childFolder.id)
        summary.folders += childSummary.folders
        summary.documents += childSummary.documents
        summary.bytes += childSummary.bytes
      }

      totals.set(folderId, summary)
      return summary
    }

    for (const folder of driveFolders.filter((item) => item.parentId === null)) {
      walk(folder.id)
    }

    return totals
  }, [driveFolders, foldersByParent, state.documents])

  useEffect(() => {
    if (!selectedDocument) {
      setPreviewUrl(null)
      setPreviewLoading(false)
      return
    }

    let cancelled = false
    setPreviewUrl(null)
    setPreviewLoading(true)

    void resolveR2ObjectUrl(selectedDocument.storagePath)
      .then((url) => {
        if (!cancelled) {
          setPreviewUrl(url)
          setPreviewLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPreviewUrl(null)
          setPreviewLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [selectedDocument])

  useEffect(() => {
    if (selectedDocumentViewerMode !== 'csv' || !previewUrl) {
      setCsvPreviewText(null)
      setCsvPreviewLoading(false)
      setCsvPreviewError(null)
      return
    }

    let cancelled = false
    setCsvPreviewText(null)
    setCsvPreviewLoading(true)
    setCsvPreviewError(null)

    void fetch(previewUrl)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`CSV preview failed (${response.status})`)
        }
        return response.text()
      })
      .then((text) => {
        if (cancelled) return
        setCsvPreviewText(text)
        setCsvPreviewLoading(false)
      })
      .catch((error) => {
        if (cancelled) return
        setCsvPreviewText(null)
        setCsvPreviewLoading(false)
        setCsvPreviewError(error instanceof Error ? error.message : 'CSV preview failed.')
      })

    return () => {
      cancelled = true
    }
  }, [previewUrl, selectedDocumentViewerMode])

  useEffect(() => {
    if (documentLayout !== 'cards') return

    const imageDocuments = visibleDocuments.filter((document) => document.mimeType.startsWith('image/'))
    if (imageDocuments.length === 0) return

    let cancelled = false
    void (async () => {
      const resolved = await Promise.allSettled(
        imageDocuments.map(async (document) => [document.id, await resolveR2ObjectUrl(document.storagePath)] as const),
      )
      if (cancelled) return

      setCardPreviewUrls((current) => {
        const next = { ...current }
        for (const result of resolved) {
          if (result.status === 'fulfilled') {
            const [id, url] = result.value
            next[id] = url
          }
        }
        return next
      })
    })()

    return () => {
      cancelled = true
    }
  }, [documentLayout, visibleDocuments])

  const createFolder = async () => {
    if (state.view === 'trash') return
    const name = newFolderName.trim()
    if (!name) return
    setStatusMessage(null)
    const { error } = await supabase.rpc('create_drive_folder', {
      p_name: name,
      p_parent_id: state.activeFolderId,
    })
    if (error) {
      setStatusMessage(error.message)
      return
    }
    await refreshDrive()
    setNewFolderName('')
    setNewFolderOpen(false)
    setStatusMessage(null)
    notify.success('Folder created', {
      description: `"${name}" was added to ${currentFolderLabel}.`,
    })
  }

  const handleUpload = async (files: FileList | File[], targetFolderId?: string | null) => {
    if (state.view === 'trash') return
    const entries = Array.from(files)
    if (entries.length === 0) return
    const resolvedTargetFolderId = targetFolderId ?? null
    if (!resolvedTargetFolderId) {
      notify.error('Upload blocked', {
        description: 'Open a folder to upload files.',
      })
      return
    }
    setUploading(true)
    setStatusMessage(null)
    const resolvedTargetLabel =
      folderMap.get(resolvedTargetFolderId)?.name ??
      currentFolderLabel
    const uploadBatch = entries.map((file, index) => ({
      id: `${Date.now()}-${index}-${file.name}`,
      name: file.name,
      size: file.size,
      progress: 0,
      status: 'uploading' as const,
    }))
    setUploadTargetLabel(resolvedTargetLabel)
    setUploadItems(uploadBatch)

    const updateUploadItem = (itemId: string, updater: (item: UploadProgressItem) => UploadProgressItem) => {
      setUploadItems((current) => current.map((item) => (item.id === itemId ? updater(item) : item)))
    }

    try {
      const results = await Promise.allSettled(
        entries.map(async (file, index) => {
          const itemId = uploadBatch[index]?.id ?? `${Date.now()}-${index}-${file.name}`

          try {
            const upload = await uploadDriveDocumentToR2(file, undefined, (progress) => {
              updateUploadItem(itemId, (item) => ({
                ...item,
                progress,
                status: 'uploading',
              }))
            })

            updateUploadItem(itemId, (item) => ({
              ...item,
              progress: 100,
              status: 'saving',
            }))

            const { error } = await supabase.rpc('create_drive_document', {
              p_folder_id: resolvedTargetFolderId,
              p_storage_bucket: upload.bucket,
              p_storage_path: upload.key,
              p_file_name: file.name,
              p_mime_type: file.type || 'application/octet-stream',
              p_file_size_bytes: file.size,
            })
            if (error) throw error

            updateUploadItem(itemId, (item) => ({
              ...item,
              progress: 100,
              status: 'done',
            }))

            return upload
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Upload failed.'
            updateUploadItem(itemId, (item) => ({
              ...item,
              progress: 100,
              status: 'error',
              error: message,
            }))
            throw error
          }
        }),
      )

      const failures: string[] = []
      for (const result of results) {
        if (result.status === 'rejected') {
          failures.push(result.reason instanceof Error ? result.reason.message : 'Upload failed.')
        }
      }

      await refreshDrive()

      if (failures.length > 0) {
        setStatusMessage(failures[0] ?? 'One or more uploads failed.')
      } else {
        const uploadedCount = results.filter((result) => result.status === 'fulfilled').length
        setStatusMessage(null)
        notify.success('Upload complete', {
          description: `${uploadedCount} document${uploadedCount === 1 ? '' : 's'} uploaded to ${resolvedTargetLabel}.`,
        })
      }
    } finally {
      setUploading(false)
    }
  }

  const moveFolder = async (folderId: string, targetFolderId: string | null) => {
    const folder = folderMap.get(folderId)
    if (!folder || state.view === 'trash') return
    if (isSharedRootFolder(folder)) {
      setStatusMessage('Shared folder cannot be moved.')
      return
    }

    const targetFolder = targetFolderId ? folderMap.get(targetFolderId) ?? null : null
    const isSharedRootTarget = Boolean(
      targetFolder &&
        targetFolder.parentId === null &&
        targetFolder.visibility === 'shared' &&
        targetFolder.name === 'Shared',
    )
    if (targetFolderId && targetFolder && targetFolder.parentId === folder.parentId && !isSharedRootTarget) {
      const { error } = await supabase.rpc('move_drive_folder', {
        p_folder_id: folderId,
        p_before_folder_id: targetFolderId,
      })
      if (error) {
        setStatusMessage(error.message)
        return
      }
    } else {
      const { error } = await supabase.rpc('move_drive_folder', {
        p_folder_id: folderId,
        p_target_folder_id: targetFolderId,
      })
      if (error) {
        setStatusMessage(error.message)
        return
      }
    }

    await refreshDrive()
    setStatusMessage(null)
    notify.success('Folder moved', {
      description: targetFolderId ? 'The folder was moved successfully.' : 'The folder was moved to My Drive.',
    })
  }

  const openFolder = (folderId: string | null) => {
    setState((current) => ({
      ...current,
      view: 'drive',
      activeFolderId: folderId,
    }))
    setSearch('')
  }

  const openTrash = () => {
    setState((current) => ({
      ...current,
      view: 'trash',
    }))
    setSearch('')
  }

  const handleDrop = (targetFolderId: string | null) => {
    if (state.view === 'trash') return
    if (!dragging) return
    void moveFolder(dragging.id, targetFolderId)
    setDragging(null)
    setDropTarget(null)
  }

  const handleDropZone = (event: DragEvent<HTMLElement>, targetFolderId: string | null) => {
    event.preventDefault()
    if (state.view === 'trash') return

    if (hasFilePayload(event)) {
      if (targetFolderId === null) {
        notify.error('Upload blocked', {
          description: 'Open a folder to upload files.',
        })
        return
      }
      void handleUpload(event.dataTransfer.files, targetFolderId)
      setDragging(null)
      setDropTarget(null)
      return
    }

    handleDrop(targetFolderId)
  }

  const startFolderDrag = (event: DragEvent<HTMLElement>, folderId: string) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', folderId)
    setDragging({ kind: 'folder', id: folderId })
  }

  const openPreview = (documentId: string) => {
    setInfoDocumentId(null)
    setPreviewDocumentId(documentId)
  }

  const openDocumentInfo = (documentId: string) => {
    setPreviewDocumentId(null)
    setInfoDocumentId(documentId)
  }

  const softDeleteDocument = (documentId: string) => {
    void (async () => {
      const { error } = await supabase.rpc('trash_drive_document', { p_document_id: documentId })
      if (error) {
        setStatusMessage(error.message)
        return
      }
      if (previewDocumentId === documentId) {
        setPreviewDocumentId(null)
      }
      await refreshDrive()
      setStatusMessage(null)
      notify.success('Document moved to trash')
    })()
  }

  const restoreDocument = (documentId: string) => {
    void (async () => {
      const { error } = await supabase.rpc('restore_drive_document', { p_document_id: documentId })
      if (error) {
        setStatusMessage(error.message)
        return
      }
      await refreshDrive()
      setStatusMessage(null)
      notify.success('Document restored')
    })()
  }

  const permanentlyDeleteDocument = (documentId: string) => {
    void (async () => {
      const document = state.documents.find((item) => item.id === documentId)
      if (!document) {
        setStatusMessage('Document not found')
        return
      }
      try {
        await deleteDriveDocumentFromR2(document.storagePath)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to delete document from storage.'
        setStatusMessage(message)
        notify.error('Document delete failed', { description: message })
        return
      }
      const { error } = await supabase.rpc('delete_drive_document_permanently', { p_document_id: documentId })
      if (error) {
        setStatusMessage(error.message)
        notify.error('Document delete failed', { description: error.message })
        return
      }
      if (previewDocumentId === documentId) {
        setPreviewDocumentId(null)
      }
      await refreshDrive()
      setStatusMessage(null)
      notify.success('Document deleted permanently')
    })()
  }

  const softDeleteFolder = (folderId: string) => {
    void (async () => {
      const folder = folderMap.get(folderId)
      if (folder && isSharedRootFolder(folder)) {
        setStatusMessage('Shared folder cannot be deleted.')
        return
      }
      const { error } = await supabase.rpc('trash_drive_folder', { p_folder_id: folderId })
      if (error) {
        setStatusMessage(error.message)
        return
      }
      await refreshDrive()
      setStatusMessage(null)
      notify.success('Folder moved to trash')
    })()
  }

  const restoreFolder = (folderId: string) => {
    void (async () => {
      const { error } = await supabase.rpc('restore_drive_folder', { p_folder_id: folderId })
      if (error) {
        setStatusMessage(error.message)
        return
      }
      await refreshDrive()
      setStatusMessage(null)
      notify.success('Folder restored')
    })()
  }

  const permanentlyDeleteFolder = (folderId: string) => {
    void (async () => {
      const folder = folderMap.get(folderId)
      if (folder && isSharedRootFolder(folder)) {
        setStatusMessage('Shared folder cannot be deleted.')
        return
      }
      try {
        await deleteDriveObjects(getFolderSubtreeDocumentPaths(folderId))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to delete folder documents from storage.'
        setStatusMessage(message)
        notify.error('Folder delete failed', { description: message })
        return
      }
      const { error } = await supabase.rpc('delete_drive_folder_permanently', { p_folder_id: folderId })
      if (error) {
        setStatusMessage(error.message)
        notify.error('Folder delete failed', { description: error.message })
        return
      }
      await refreshDrive()
      setStatusMessage(null)
      notify.success('Folder deleted permanently')
    })()
  }

  const clearTrash = () => {
    void (async () => {
      try {
        await deleteDriveObjects(trashedDocuments.map((document) => document.storagePath))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to delete trashed files from storage.'
        setStatusMessage(message)
        notify.error('Trash clear failed', { description: message })
        return
      }
      const { error } = await supabase.rpc('clear_drive_trash')
      if (error) {
        setStatusMessage(error.message)
        notify.error('Trash clear failed', { description: error.message })
        return
      }
      await refreshDrive()
      setStatusMessage(null)
      notify.success('Trash cleared')
    })()
  }

  const renderFolderTree = (parentId: string | null, depth = 0) => {
    const folders = foldersByParent.get(parentId) ?? []
    if (folders.length === 0) return null

    return folders.map((folder) => {
      const childFolders = foldersByParent.get(folder.id) ?? []
      const childDocuments = state.documents.filter((document) => document.folderId === folder.id).length
      const isActive = folder.id === activeFolderId
      const isDropTarget = dropTarget === folder.id
      const isSharedRoot = isSharedRootFolder(folder)

      return (
        <div key={folder.id} className='space-y-1'>
          <button
            type='button'
            draggable={!isSharedRoot}
            onDragStart={(event) => {
              if (isSharedRoot) return
              startFolderDrag(event, folder.id)
            }}
            onDragEnd={() => setDragging(null)}
            onDragOver={(event) => {
              event.preventDefault()
              event.dataTransfer.dropEffect = hasFilePayload(event) ? 'copy' : 'move'
              setDropTarget(folder.id)
            }}
            onClick={() => openFolder(folder.id)}
            onDragLeave={() => {
              if (dropTarget === folder.id) setDropTarget(null)
            }}
            onDrop={(event) => handleDropZone(event, folder.id)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
              isSharedRoot ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
              isActive ? 'bg-primary/10 text-primary' : 'text-foreground/90 hover:bg-accent hover:text-accent-foreground',
              isDropTarget && 'bg-primary/10 ring-2 ring-primary/30',
            )}
            style={{ paddingLeft: 12 + depth * 14 }}
          >
            <span className='inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground'>
              <GripVertical className='h-3.5 w-3.5' aria-hidden='true' />
            </span>
            <FolderMark className='h-4 w-5' />
            <span className='min-w-0 flex-1 truncate'>{folder.name}</span>
            <span className='text-xs text-muted-foreground tabular-nums'>
              {childFolders.length + childDocuments}
            </span>
          </button>
          {renderFolderTree(folder.id, depth + 1)}
        </div>
      )
    })
  }

  const currentFolderLabel = isTrashView ? 'Trash' : activeFolderVisible?.name ?? 'My Drive'
  const currentFolderItems = useMemo(() => {
    if (isTrashView) {
      return [
        ...visibleTrashFolders.map((folder) => ({ kind: 'trashed-folder' as const, folder })),
        ...visibleTrashDocuments.map((document) => ({ kind: 'trashed-document' as const, document })),
      ]
    }
    return [
      ...visibleFolders.map((folder) => ({ kind: 'folder' as const, folder })),
      ...visibleDocuments.map((document) => ({ kind: 'document' as const, document })),
    ]
  }, [isTrashView, visibleDocuments, visibleFolders, visibleTrashDocuments, visibleTrashFolders])
  const currentFolders = useMemo(() => (isTrashView ? [] : visibleFolders), [isTrashView, visibleFolders])
  const currentDocuments = useMemo(() => (isTrashView ? [] : visibleDocuments), [isTrashView, visibleDocuments])
  const hasVisibleFolders = currentFolders.length > 0
  const hasVisibleDocuments = currentDocuments.length > 0
  const showEmptyDriveState = !isTrashView && !hasVisibleFolders && !hasVisibleDocuments
  const folderContentDropActive = !isTrashView && dragging !== null && dropTarget === activeFolderId
  const uploadErrorCount = uploadItems.filter((item) => item.status === 'error').length
  const uploadActiveCount = uploadItems.filter((item) => item.status === 'uploading' || item.status === 'saving').length
  const activeUploadItem = useMemo(() => {
    if (uploadItems.length === 0) return null
    return uploadItems.find((item) => item.status === 'uploading' || item.status === 'saving') ?? uploadItems[0] ?? null
  }, [uploadItems])
  const remainingUploadItems = useMemo(
    () => (activeUploadItem ? uploadItems.filter((item) => item.id !== activeUploadItem.id) : []),
    [activeUploadItem, uploadItems],
  )
  const dismissUploadSummary = () => {
    if (uploading) return
    setUploadItems([])
    setUploadTargetLabel(null)
  }

  useEffect(() => {
    if (uploading) return
    if (uploadItems.length === 0) return
    if (uploadErrorCount > 0) return
    if (uploadActiveCount > 0) return

    const timeout = window.setTimeout(() => {
      setUploadItems([])
      setUploadTargetLabel(null)
    }, 1200)

    return () => window.clearTimeout(timeout)
  }, [uploadActiveCount, uploadErrorCount, uploadItems.length, uploading])

  if (loading && state.folders.length === 0 && state.documents.length === 0) {
    return <DocumentsPageSkeleton />
  }

  return (
    <div className='flex min-h-[calc(100dvh-6rem)] w-full flex-col gap-6'>
      <input
        ref={fileInputRef}
        type='file'
        multiple
        accept={DRIVE_ACCEPT}
        className='hidden'
        onChange={(event) => {
          const files = event.target.files
          if (files) {
            void handleUpload(files, state.activeFolderId)
            event.target.value = ''
          }
        }}
      />

      {statusMessage ? (
        <div className='rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive'>
          {statusMessage}
        </div>
      ) : null}

      {uploadItems.length > 0 ? (
        <div className='fixed right-4 top-4 z-50 w-[min(24rem,calc(100vw-2rem))] sm:right-6 sm:top-6'>
          <section className='rounded-2xl border border-border/70 bg-card/95 p-4 shadow-2xl backdrop-blur-md'>
            {activeUploadItem ? (
              <div className='space-y-3'>
                <div className='flex items-start justify-between gap-4'>
                  <div className='flex min-w-0 items-start gap-3'>
                    <div
                      className={cn(
                        'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
                        activeUploadItem.status === 'done'
                          ? 'bg-emerald-500/10 text-emerald-600'
                          : activeUploadItem.status === 'error'
                            ? 'bg-destructive/10 text-destructive'
                            : 'bg-primary/10 text-primary',
                      )}
                    >
                      {activeUploadItem.status === 'done' ? (
                        <CheckCircle2 className='h-4 w-4' />
                      ) : activeUploadItem.status === 'error' ? (
                        <CircleAlert className='h-4 w-4' />
                      ) : (
                        <Loader2 className='h-4 w-4 animate-spin' />
                      )}
                    </div>
                    <div className='min-w-0'>
                      <div className='flex items-center gap-2'>
                        <h3 className='truncate text-sm font-semibold text-foreground'>
                          {activeUploadItem.name}
                        </h3>
                        <span className='rounded-full border border-border/70 bg-muted/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground'>
                          {activeUploadItem.status === 'saving' ? 'Saving' : getUploadStatusLabel(activeUploadItem.status)}
                        </span>
                      </div>
                      <p className='mt-1 text-xs text-muted-foreground'>
                        {formatBytes(activeUploadItem.size)} · {Math.round(activeUploadItem.progress)}%
                        {uploadTargetLabel ? ` · ${uploadTargetLabel}` : ''}
                        {activeUploadItem.status === 'error' && activeUploadItem.error ? ` · ${activeUploadItem.error}` : ''}
                      </p>
                    </div>
                  </div>

                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='h-8 w-8'
                    onClick={dismissUploadSummary}
                    disabled={uploading}
                    aria-label='Dismiss upload progress'
                  >
                    <Trash2 className='h-4 w-4 text-muted-foreground' />
                  </Button>
                </div>

                <div className='h-2 overflow-hidden rounded-full bg-muted'>
                  <div
                    className={cn(
                      'h-full rounded-full transition-[width] duration-200 ease-out',
                      activeUploadItem.status === 'error' ? 'bg-destructive' : 'bg-primary',
                    )}
                    style={{ width: `${Math.max(0, Math.min(100, activeUploadItem.progress))}%` }}
                  />
                </div>
              </div>
            ) : null}

            {remainingUploadItems.length > 0 ? (
              <div className='mt-4 space-y-2'>
                {remainingUploadItems.map((item) => {
                  const statusLabel = getUploadStatusLabel(item.status)
                  const statusClass =
                    item.status === 'done'
                      ? 'bg-emerald-500/10 text-emerald-600'
                      : item.status === 'error'
                        ? 'bg-destructive/10 text-destructive'
                        : 'bg-primary/10 text-primary'
                  const statusIcon =
                    item.status === 'done' ? (
                      <CheckCircle2 className='h-4 w-4' />
                    ) : item.status === 'error' ? (
                      <CircleAlert className='h-4 w-4' />
                    ) : (
                      <Loader2 className='h-4 w-4 animate-spin' />
                    )

                  return (
                    <div key={item.id} className='rounded-xl border border-border/70 bg-background/80 px-3 py-3'>
                      <div className='flex items-start justify-between gap-3'>
                        <div className='flex min-w-0 items-start gap-3'>
                          <div className={cn('inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', statusClass)}>{statusIcon}</div>
                          <div className='min-w-0'>
                            <p className='truncate text-sm font-medium text-foreground'>{item.name}</p>
                            <p className='mt-1 text-xs text-muted-foreground'>
                              {formatBytes(item.size)} · {statusLabel}
                              {item.status === 'error' && item.error ? ` · ${item.error}` : ''}
                            </p>
                          </div>
                        </div>
                        <span className='text-xs font-medium tabular-nums text-muted-foreground'>{Math.round(item.progress)}%</span>
                      </div>
                      <div className='mt-3 h-1.5 overflow-hidden rounded-full bg-muted'>
                        <div
                          className={cn(
                            'h-full rounded-full transition-[width] duration-200 ease-out',
                            item.status === 'error' ? 'bg-destructive' : item.status === 'done' ? 'bg-emerald-500' : 'bg-primary',
                          )}
                          style={{ width: `${Math.max(0, Math.min(100, item.progress))}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      <div className='grid min-h-0 flex-1 gap-6 xl:grid-cols-[300px_minmax(0,1fr)]'>
        <aside className='flex h-full flex-col rounded-2xl border bg-card/70 p-4 shadow-sm'>
          <div className='flex min-h-0 flex-1 flex-col gap-3'>
            <div className='flex items-center justify-between'>
              <p className='text-sm font-semibold text-foreground'>Folders</p>
              <span className='text-xs text-muted-foreground'>Drag to move</span>
            </div>
            <button
              type='button'
              onClick={() => openFolder(null)}
              onDragOver={(event) => {
                event.preventDefault()
                if (hasFilePayload(event)) {
                  event.dataTransfer.dropEffect = 'none'
                  return
                }
                event.dataTransfer.dropEffect = 'move'
                setDropTarget('root')
              }}
              onDragLeave={() => {
                if (dropTarget === 'root') setDropTarget(null)
              }}
              onDrop={(event) => handleDropZone(event, null)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground',
                activeFolderId === null ? 'bg-primary/10 text-primary' : 'bg-background text-foreground',
                dropTarget === 'root' && 'ring-2 ring-primary/30',
              )}
              >
                <FolderMark className='h-4 w-5' />
                <span className='flex-1 truncate'>My Drive</span>
                <span className='text-xs text-muted-foreground tabular-nums'>
                  {foldersByParent.get(null)?.length ?? 0}
                </span>
              </button>
            {dragging?.kind === 'folder' && draggingFolder?.visibility !== 'shared' ? (
              <button
                type='button'
                onDragOver={(event) => {
                  event.preventDefault()
                  if (hasFilePayload(event)) {
                    event.dataTransfer.dropEffect = 'none'
                    return
                  }
                  event.dataTransfer.dropEffect = 'move'
                  setDropTarget('root')
                }}
                onDragLeave={() => {
                  if (dropTarget === 'root') setDropTarget(null)
                }}
                onDrop={(event) => handleDropZone(event, null)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md border border-dashed border-border/70 px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
                  dropTarget === 'root' && 'border-primary/40 bg-primary/10 text-primary',
                )}
              >
                <FolderMark className='h-4 w-5' />
                <span className='flex-1 truncate'>Drop here to move out to My Drive</span>
              </button>
            ) : null}
            <div className='min-h-0 flex-1 space-y-1 overflow-y-auto pr-1'>
              {renderFolderTree(null)}
            </div>
          </div>

          <div className='mt-4 border-t border-border/70 pt-4'>
            <button
              type='button'
              onClick={openTrash}
              className={cn(
                'flex w-full items-center justify-between rounded-xl border px-3 py-3 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground',
                isTrashView ? 'border-destructive/30 bg-destructive/10 text-destructive' : 'bg-background text-foreground',
              )}
            >
              <div className='flex items-center gap-2'>
                <Trash2 className='h-4 w-4 shrink-0' />
                <span className='font-medium'>Trash</span>
              </div>
              <span className='rounded-full bg-muted/60 px-2 py-1 text-xs tabular-nums text-muted-foreground'>{trashCount}</span>
            </button>
            <p className='mt-2 text-xs text-muted-foreground'>Deleted items stay here until you clear them.</p>
          </div>
        </aside>

        <main className='flex min-h-0 min-w-0 flex-col gap-4'>
          <section
            className={cn(
              'flex min-h-0 flex-1 flex-col rounded-2xl border bg-card/70 p-4 shadow-sm transition-colors',
              folderContentDropActive && 'border-primary/40 bg-primary/5 ring-2 ring-primary/20',
            )}
            onDragOver={
              isTrashView
                ? undefined
                : (event) => {
                    event.preventDefault()
                    event.dataTransfer.dropEffect = hasFilePayload(event) ? 'copy' : 'move'
                    if (dropTarget !== activeFolderId) setDropTarget(activeFolderId)
                  }
            }
            onDragLeave={
              isTrashView
                ? undefined
                : () => {
                    if (dropTarget === activeFolderId) setDropTarget(null)
                  }
            }
            onDrop={
              isTrashView
                ? undefined
                : (event) => handleDropZone(event, activeFolderId)
            }
          >
            {folderContentDropActive ? (
              <div className='mb-4 flex items-center justify-between gap-3 rounded-xl border border-dashed border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary'>
                <span className='font-medium'>Drop files here to upload them, or drag folders to move them into {currentFolderLabel}.</span>
                <span className='hidden text-xs text-primary/80 md:inline'>Release to move</span>
              </div>
            ) : null}

            <div className='flex flex-wrap items-start justify-between gap-3'>
              <div className='space-y-2'>
                {isTrashView ? (
                  <div className='flex items-center gap-2'>
                    <Trash2 className='h-4 w-4 text-destructive' />
                    <h2 className='text-lg font-semibold text-foreground'>Trash</h2>
                    <Badge className='rounded-full border border-border/70 bg-muted/40 px-2.5 text-[11px] font-medium text-foreground'>
                      {trashCount} items
                    </Badge>
                  </div>
                ) : (
                  <>
                    <div className='flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground'>
                      {breadcrumbs.map((crumb, index) => (
                        <button
                          key={`${crumb.id ?? 'root'}-${crumb.name}`}
                          type='button'
                          onClick={() => openFolder(crumb.id)}
                          className={cn(
                            'inline-flex items-center gap-1 rounded-md px-2 py-1 transition-colors hover:bg-accent hover:text-accent-foreground',
                            index === breadcrumbs.length - 1 && 'font-medium text-foreground',
                          )}
                        >
                          <span>{crumb.name}</span>
                          {index < breadcrumbs.length - 1 ? <ChevronRight className='h-3.5 w-3.5' /> : null}
                        </button>
                      ))}
                    </div>
                    <div className='flex items-center gap-2'>
                      <h2 className='text-lg font-semibold text-foreground'>{currentFolderLabel}</h2>
                      <Badge className='rounded-full border border-border/70 bg-muted/40 px-2.5 text-[11px] font-medium text-foreground'>
                        {visibleFolders.length} folders
                      </Badge>
                      <Badge className='rounded-full border border-border/70 bg-muted/40 px-2.5 text-[11px] font-medium text-foreground'>
                        {visibleDocuments.length} documents
                      </Badge>
                    </div>
                  </>
                )}
              </div>
              <div className='flex flex-wrap items-center gap-3'>
                {!isTrashView ? (
                  <div className='inline-flex rounded-lg border bg-background p-1 shadow-sm'>
                    <button
                      type='button'
                      onClick={() => setDocumentLayout('list')}
                      aria-pressed={documentLayout === 'list'}
                      className={cn(
                        'inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors',
                        documentLayout === 'list'
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                      )}
                    >
                      <LayoutList className='h-4 w-4' />
                      List
                    </button>
                    <button
                      type='button'
                      onClick={() => setDocumentLayout('cards')}
                      aria-pressed={documentLayout === 'cards'}
                      className={cn(
                        'inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors',
                        documentLayout === 'cards'
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                      )}
                    >
                      <LayoutGrid className='h-4 w-4' />
                      Cards
                    </button>
                  </div>
                ) : null}
                <div className='relative w-full min-w-[240px] lg:w-[320px]'>
                  <Search className='pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={isTrashView ? 'Search trash' : 'Search this folder'}
                    className='h-10 pl-9'
                  />
                </div>
                {isTrashView ? (
                  <Button type='button' variant='destructive' className='h-10 gap-2' onClick={clearTrash} disabled={trashCount === 0}>
                    <Trash2 className='h-4 w-4' />
                    Clear trash
                  </Button>
                ) : (
                  <>
                    <Button
                      type='button'
                      variant='outline'
                      className='h-10 gap-2'
                      onClick={() => setFiltersDrawerOpen(true)}
                    >
                      <SlidersHorizontal className='h-4 w-4' />
                      Filters
                      {activeFilterCount > 0 ? (
                        <Badge className='rounded-full border border-border/70 bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-foreground'>
                          {activeFilterCount}
                        </Badge>
                      ) : null}
                    </Button>
                    <Button
                      type='button'
                      variant='outline'
                      className='h-10 gap-2'
                      onClick={() => {
                        setNewFolderName('')
                        setNewFolderOpen(true)
                      }}
                    >
                      <FolderPlus className='h-4 w-4' />
                      New folder
                    </Button>
                    {activeFolderId ? (
                      <Button
                        type='button'
                        className='h-10 gap-2'
                        disabled={uploading}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Upload className='h-4 w-4' />
                        Upload
                      </Button>
                    ) : null}
                  </>
                )}
              </div>
            </div>

            <div className='mt-4 flex min-h-0 flex-1 flex-col'>
              <div className='flex items-center justify-between gap-3'>
                <p className='text-sm font-semibold text-foreground'>{isTrashView ? 'Trash contents' : 'Folder contents'}</p>
                {!isTrashView ? (
                  <p className='text-xs text-muted-foreground'>
                    {activeFolderId ? 'Drop files here to upload them. Drag folders to move them.' : 'Open a folder to view its files.'}
                  </p>
                ) : null}
              </div>

              {isTrashView ? (
                currentFolderItems.length === 0 ? (
                  <div className='mt-4 flex min-h-[18rem] flex-1 items-center justify-center rounded-xl border border-dashed bg-muted/10 p-8 text-center'>
                    <div className='max-w-sm'>
                      <p className='text-sm font-medium text-foreground'>Trash is empty.</p>
                      <p className='mt-1 text-sm text-muted-foreground'>Deleted items will appear here until you clear them.</p>
                    </div>
                  </div>
                ) : (
                  <div className='mt-4 space-y-2'>
                    {currentFolderItems.map((item) => {
                      if (item.kind === 'trashed-folder') {
                        const folder = item.folder
                        const parentName = folder.parentId ? folderMap.get(folder.parentId)?.name ?? 'My Drive' : 'My Drive'

                        return (
                          <div key={folder.id} className='rounded-xl border border-border/70 bg-muted/20 p-4 shadow-sm'>
                            <div className='flex items-start justify-between gap-3'>
                              <div className='flex min-w-0 items-start gap-3'>
                                <span className='mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive'>
                                  <Trash2 className='h-5 w-5' />
                                </span>
                                <div className='min-w-0'>
                                  <p className='truncate text-sm font-semibold text-foreground'>{folder.name}</p>
                                  <p className='mt-1 truncate text-xs text-muted-foreground'>Originally in {parentName}</p>
                                </div>
                              </div>
                              <span className='inline-flex rounded-full border border-border/70 bg-muted/40 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground'>
                                Trash
                              </span>
                            </div>
                            <div className='mt-4 flex items-center justify-end gap-2'>
                              <Button type='button' variant='ghost' size='icon' className='h-8 w-8' onClick={() => restoreFolder(folder.id)} aria-label={`Restore ${folder.name}`}>
                                <RotateCcw className='h-4 w-4' />
                              </Button>
                              <Button
                                type='button'
                                variant='ghost'
                                size='icon'
                                className='h-8 w-8 text-destructive hover:text-destructive'
                                onClick={() => permanentlyDeleteFolder(folder.id)}
                                aria-label={`Delete ${folder.name} permanently`}
                              >
                                <Trash2 className='h-4 w-4' />
                              </Button>
                            </div>
                          </div>
                        )
                      }

                      if (item.kind === 'trashed-document') {
                        const document = item.document
                        const folderName = folderMap.get(document.folderId ?? '')?.name ?? 'My Drive'

                        return (
                          <div key={document.id} className='rounded-xl border border-border/70 bg-muted/20 p-4 shadow-sm'>
                            <div className='flex items-start justify-between gap-3'>
                              <div className='flex min-w-0 items-start gap-3'>
                                <span className='mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive'>
                                  <Trash2 className='h-4 w-4' />
                                </span>
                                <div className='min-w-0'>
                                  <p className='truncate text-sm font-semibold text-foreground'>{previewWords(document.name, 10)}</p>
                                  <p className='mt-1 truncate text-xs text-muted-foreground'>{folderName}</p>
                                </div>
                              </div>
                              <span className='inline-flex rounded-full border border-border/70 bg-muted/40 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground'>
                                {getFileKind(document)}
                              </span>
                            </div>
                            <div className='mt-4 flex items-center justify-end gap-2'>
                              <Button type='button' variant='ghost' size='icon' className='h-8 w-8' onClick={() => restoreDocument(document.id)} aria-label={`Restore ${document.name}`}>
                                <RotateCcw className='h-4 w-4' />
                              </Button>
                              <Button
                                type='button'
                                variant='ghost'
                                size='icon'
                                className='h-8 w-8 text-destructive hover:text-destructive'
                                onClick={() => permanentlyDeleteDocument(document.id)}
                                aria-label={`Delete ${document.name} permanently`}
                              >
                                <Trash2 className='h-4 w-4' />
                              </Button>
                            </div>
                          </div>
                        )
                      }

                      return null
                    })}
                  </div>
                )
              ) : showEmptyDriveState ? (
                  <div className='mt-4 flex min-h-[18rem] flex-1 items-center justify-center rounded-xl border border-dashed bg-muted/10 p-8 text-center'>
                    <div className='max-w-sm'>
                      <p className='text-sm font-medium text-foreground'>No folders or files yet.</p>
                      <p className='mt-1 text-sm text-muted-foreground'>Create a folder or upload a file to get started.</p>
                    </div>
                  </div>
                ) : (
                  <div className='mt-4 space-y-8'>
                  <section className='space-y-3'>
                    <div className='flex items-center justify-between gap-3'>
                      <div className='space-y-1'>
                        <p className='text-sm font-semibold text-foreground'>Folders</p>
                        <p className='text-xs text-muted-foreground'>{currentFolders.length} folder{currentFolders.length === 1 ? '' : 's'}</p>
                      </div>
                    </div>

                    {currentFolders.length > 0 ? (
                      <div
                        className={cn(
                          'grid gap-4 sm:grid-cols-2',
                          documentLayout === 'list' ? 'lg:grid-cols-3 xl:grid-cols-4' : 'xl:grid-cols-3 2xl:grid-cols-4',
                        )}
                      >
                        {currentFolders.map((folder) => {
                          const isActive = folder.id === activeFolderId
                          const isTarget = dropTarget === folder.id
                          const isSharedRoot = isSharedRootFolder(folder)
                          const childDocuments = state.documents.filter((document) => document.folderId === folder.id && document.deletedAt === null).length
                          const childFolders = foldersByParent.get(folder.id)?.length ?? 0
                          const overview = folderOverview.get(folder.id)
                          const documentCount = overview?.documents ?? childDocuments
                          const folderCount = overview?.folders ?? childFolders
                          const compactFolderLayout = documentLayout === 'list'

                          return (
                            <div
                              key={folder.id}
                              draggable={!isSharedRoot}
                              onDragStart={(event) => {
                                if (isSharedRoot) return
                                startFolderDrag(event, folder.id)
                              }}
                              onDragEnd={() => setDragging(null)}
                              onDragOver={(event) => {
                                event.preventDefault()
                                event.dataTransfer.dropEffect = hasFilePayload(event) ? 'copy' : 'move'
                                setDropTarget(folder.id)
                              }}
                              onDragLeave={() => {
                                if (dropTarget === folder.id) setDropTarget(null)
                              }}
                              onDrop={(event) => handleDropZone(event, folder.id)}
                              role='button'
                              tabIndex={0}
                              onClick={() => openFolder(folder.id)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault()
                                  openFolder(folder.id)
                                }
                              }}
                              className={cn(
                                'group relative overflow-hidden border border-border/70 bg-card/80 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md',
                                compactFolderLayout ? 'rounded-2xl p-3' : 'rounded-[1.6rem] p-4',
                                isSharedRoot ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
                                isActive && 'border-primary/40 bg-primary/5',
                                isTarget && 'ring-2 ring-primary/30',
                              )}
                            >
                              <div className='absolute right-3 top-3 z-10'>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      type='button'
                                      variant='ghost'
                                      size='icon'
                                      className='h-8 w-8 text-muted-foreground transition-colors hover:text-foreground'
                                      onClick={(event) => event.stopPropagation()}
                                    >
                                      <MoreVertical className='h-4 w-4' />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align='end' className='w-fit min-w-0'>
                                    <DropdownMenuItem
                                      className='gap-2 whitespace-nowrap pr-3'
                                      onSelect={() => {
                                        openFolder(folder.id)
                                      }}
                                    >
                                      <ArrowUpRight className='h-4 w-4' />
                                      Open
                                    </DropdownMenuItem>
                                    {!isSharedRoot ? (
                                      <DropdownMenuItem
                                        className='gap-2 whitespace-nowrap pr-3 text-destructive'
                                        onSelect={() => {
                                          softDeleteFolder(folder.id)
                                        }}
                                      >
                                        <Trash2 className='h-4 w-4' />
                                        Move to trash
                                      </DropdownMenuItem>
                                    ) : null}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>

                              <div className={cn('min-w-0', compactFolderLayout ? 'flex items-center gap-3 pr-10' : 'flex flex-col items-start pt-4')}>
                                <FolderMark active={isActive} className={compactFolderLayout ? 'h-8 w-10 shrink-0' : 'h-24 w-32'} />
                                <div className={cn('min-w-0', compactFolderLayout ? 'flex-1' : 'mt-3')}>
                                  <p className='truncate text-sm font-semibold text-foreground'>{folder.name}</p>
                                  {!compactFolderLayout ? (
                                    <p className='mt-1 text-xs text-muted-foreground'>
                                      {folderCount} subfolder{folderCount === 1 ? '' : 's'} · {documentCount} document
                                      {documentCount === 1 ? '' : 's'}
                                    </p>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : null}
                  </section>

                  {currentDocuments.length > 0 ? (
                    <section className={cn('space-y-3', currentFolders.length > 0 && 'pt-2')}>
                      {currentFolders.length > 0 ? <div className='h-px w-full bg-border/70' /> : null}
                      <div className='flex flex-wrap items-end justify-between gap-3 px-1'>
                        <div className='space-y-1'>
                          <p className='text-sm font-semibold text-foreground'>Files</p>
                          <p className='text-xs text-muted-foreground'>
                            {visibleDocuments.length} file{visibleDocuments.length === 1 ? '' : 's'}
                          </p>
                        </div>
                        <div className='flex flex-wrap items-center gap-2'>
                          {documentFilter !== 'all' ? (
                            <Badge className='rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 text-[11px] font-medium text-foreground'>
                              Filter: {selectedDocumentFilterLabel}
                            </Badge>
                          ) : null}
                          {documentSort !== 'newest' ? (
                            <Badge className='rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 text-[11px] font-medium text-foreground'>
                              Sort: {selectedDocumentSortLabel}
                            </Badge>
                          ) : null}
                        </div>
                      </div>

                      {visibleDocuments.length === 0 ? (
                        <div className='flex min-h-[12rem] items-center justify-center rounded-3xl border border-dashed bg-muted/10 p-6 text-center'>
                          <div className='max-w-sm'>
                            <p className='text-sm font-medium text-foreground'>No files match these filters.</p>
                            <p className='mt-1 text-sm text-muted-foreground'>Try a different file type or clear the search.</p>
                          </div>
                        </div>
                      ) : documentLayout === 'cards' ? (
                        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5'>
                          {visibleDocuments.map((document) => {
                            const isPreview = selectedDocument?.id === document.id
                            const documentStyle = getDocumentStyle(document.name)
                            const DocumentIcon = documentStyle.Icon
                            const cardPreviewUrl = cardPreviewUrls[document.id] ?? null
                            const isImage = document.mimeType.startsWith('image/')

                            return (
                              <div
                                key={document.id}
                                role='button'
                                tabIndex={0}
                                onClick={() => openPreview(document.id)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault()
                                    openPreview(document.id)
                                  }
                                }}
                                className={cn(
                                  'group relative overflow-hidden rounded-xl border p-2 text-left shadow-[0_6px_18px_hsl(var(--foreground)/0.05)] transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_24px_hsl(var(--foreground)/0.08)]',
                                  documentStyle.shellClassName,
                                  isPreview && 'border-primary/40 bg-primary/5',
                                )}
                              >
                                <div className='flex items-center gap-2'>
                                  <DocumentIcon className={cn('h-4 w-4 shrink-0', documentStyle.iconClassName)} />
                                  <div className='min-w-0 flex-1'>
                                    <p className='truncate text-sm font-semibold leading-none text-foreground'>{document.name}</p>
                                  </div>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        type='button'
                                        variant='ghost'
                                        size='icon'
                                        className='h-7 w-7 shrink-0 self-center text-muted-foreground transition-colors hover:text-foreground'
                                        onClick={(event) => event.stopPropagation()}
                                      >
                                        <MoreVertical className='h-3.5 w-3.5' />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align='end' className='w-fit min-w-0'>
                                      <DropdownMenuItem
                                        className='gap-2 whitespace-nowrap pr-3'
                                        onClick={(event) => event.stopPropagation()}
                                        onSelect={() => {
                                          openPreview(document.id)
                                        }}
                                      >
                                        <ArrowUpRight className='h-4 w-4' />
                                        Open
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        className='gap-2 whitespace-nowrap pr-3'
                                        onClick={(event) => event.stopPropagation()}
                                        onSelect={() => {
                                          openDocumentInfo(document.id)
                                        }}
                                      >
                                        <Info className='h-4 w-4' />
                                        View info
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        className='gap-2 whitespace-nowrap pr-3 text-destructive'
                                        onClick={(event) => event.stopPropagation()}
                                        onSelect={() => {
                                          softDeleteDocument(document.id)
                                        }}
                                      >
                                        <Trash2 className='h-4 w-4' />
                                        Move to trash
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>

                                <div className='mt-2'>
                                  <div
                                    className={cn(
                                      'flex h-[8.5rem] items-center justify-center overflow-hidden rounded-lg border transition-transform duration-300 group-hover:scale-[1.01]',
                                      'border-border/70',
                                    )}
                                  >
                                    {isImage && cardPreviewUrl ? (
                                      <img
                                        src={cardPreviewUrl}
                                        alt={document.name}
                                        className='h-full w-full object-cover'
                                      />
                                    ) : (
                                      <DocumentIcon className={cn('h-10 w-10', documentStyle.iconClassName)} />
                                    )}
                                  </div>
                                </div>

                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <div className='space-y-2'>
                          <div className='hidden grid-cols-[minmax(0,1fr)_180px_140px_110px_56px] items-center gap-4 px-4 pb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground md:grid'>
                            <span>Name</span>
                            <span>Uploaded by</span>
                            <span>Uploaded</span>
                            <span className='text-right'>Type</span>
                            <span className='text-right'>Actions</span>
                          </div>
                          {visibleDocuments.map((document) => {
                            const isPreview = selectedDocument?.id === document.id
                            const folderName = folderMap.get(document.folderId ?? '')?.name ?? 'My Drive'
                            const documentStyle = getDocumentStyle(document.name)
                            const DocumentIcon = documentStyle.Icon
                            const uploaderLabel = getDocumentUploaderLabel(document)
                            const uploadedLabel = formatDocumentUploadDate(document.uploadedAt)

                            return (
                              <div
                                key={document.id}
                                role='button'
                                tabIndex={0}
                                onClick={() => openPreview(document.id)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault()
                                    openPreview(document.id)
                                  }
                                }}
                                className={cn(
                                  'group grid gap-3 rounded-2xl border border-border/70 bg-card/70 px-3 py-2.5 shadow-sm transition-colors hover:bg-accent/30 md:grid-cols-[minmax(0,1fr)_180px_140px_110px_56px] md:items-center',
                                  isPreview && 'border-primary/40 bg-primary/5',
                                )}
                              >
                                <div className='flex min-w-0 items-center gap-2.5'>
                                  <DocumentIcon className={cn('h-4 w-4 shrink-0', documentStyle.iconClassName)} />
                                  <div className='min-w-0'>
                                    <p className='truncate text-sm font-medium leading-none text-foreground'>{document.name}</p>
                                    <p className='mt-0.5 text-xs text-muted-foreground'>{folderName}</p>
                                  </div>
                                </div>

                                <div className='flex min-w-0 items-center md:justify-start'>
                                  <span className='truncate text-sm text-muted-foreground'>{uploaderLabel}</span>
                                </div>

                                <div className='flex min-w-0 items-center md:justify-start'>
                                  <span className='truncate text-sm text-muted-foreground'>{uploadedLabel}</span>
                                </div>

                                <div className='flex items-center justify-end md:justify-end'>
                                  <span className='inline-flex rounded-full border border-border/70 bg-card/70 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground'>
                                    {getDocumentTypeLabel(document.name)}
                                  </span>
                                </div>

                                <div className='flex items-center justify-end gap-2'>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        type='button'
                                        variant='ghost'
                                        size='icon'
                                        className='h-7 w-7 text-muted-foreground hover:text-foreground'
                                        onClick={(event) => event.stopPropagation()}
                                      >
                                        <MoreVertical className='h-3.5 w-3.5' />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align='end' className='w-fit min-w-0'>
                                      <DropdownMenuItem
                                        className='gap-2 whitespace-nowrap pr-3'
                                        onClick={(event) => event.stopPropagation()}
                                        onSelect={() => {
                                          openPreview(document.id)
                                        }}
                                      >
                                        <ArrowUpRight className='h-4 w-4' />
                                        Open
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        className='gap-2 whitespace-nowrap pr-3'
                                        onClick={(event) => event.stopPropagation()}
                                        onSelect={() => {
                                          openDocumentInfo(document.id)
                                        }}
                                      >
                                        <Info className='h-4 w-4' />
                                        View info
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        className='gap-2 whitespace-nowrap pr-3 text-destructive'
                                        onClick={(event) => event.stopPropagation()}
                                        onSelect={() => {
                                          softDeleteDocument(document.id)
                                        }}
                                      >
                                        <Trash2 className='h-4 w-4' />
                                        Move to trash
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </section>
                  ) : null}
                  </div>
                )}
            </div>
          </section>
        </main>
      </div>

      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className='max-w-md overflow-hidden p-0'>
          <DialogHeader className='border-b px-6 py-5 text-left'>
            <DialogTitle>New folder</DialogTitle>
            <DialogDescription>Create a folder inside {currentFolderLabel}.</DialogDescription>
          </DialogHeader>
          <div className='space-y-5 px-6 py-5'>
            <div className='space-y-2'>
              <label className='text-sm font-medium text-foreground'>Folder name</label>
              <Input
                value={newFolderName}
                onChange={(event) => setNewFolderName(event.target.value)}
                placeholder='Folder name'
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    createFolder()
                  }
                }}
              />
            </div>
            <div className='flex items-center justify-end gap-3 pt-1'>
              <Button type='button' variant='outline' onClick={() => setNewFolderOpen(false)}>
                Cancel
              </Button>
              <Button type='button' onClick={createFolder} disabled={!newFolderName.trim()}>
                Create folder
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <DocumentViewerModal
        open={Boolean(selectedDocument)}
        title={selectedDocument?.name ?? 'Document preview'}
        subtitle={selectedDocument ? folderMap.get(selectedDocument.folderId ?? '')?.name ?? 'My Drive' : null}
        kindLabel={selectedDocument ? getFileKind(selectedDocument) : null}
        viewerMode={selectedDocumentViewerMode}
        resolvedUrl={previewUrl}
        loading={previewLoading}
        csvRows={selectedDocumentCsvRows}
        csvLoading={csvPreviewLoading}
        csvError={csvPreviewError}
        onClose={() => setPreviewDocumentId(null)}
        headerActions={
          selectedDocument ? (
            <>
              {previewUrl ? (
                <>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => {
                      const targetUrl = selectedDocumentViewerMode === 'csv' ? selectedDocumentExcelUrl ?? previewUrl : previewUrl
                      window.open(targetUrl, '_blank', 'noopener,noreferrer')
                    }}
                  >
                    <ArrowUpRight className='mr-2 h-4 w-4' aria-hidden='true' />
                    {selectedDocumentViewerMode === 'csv' ? 'Open in Excel' : 'Open file'}
                  </Button>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => {
                      const link = document.createElement('a')
                      link.href = previewUrl
                      link.download = selectedDocument?.name ?? 'document'
                      link.rel = 'noopener noreferrer'
                      document.body.appendChild(link)
                      link.click()
                      link.remove()
                    }}
                  >
                    <Download className='mr-2 h-4 w-4' aria-hidden='true' />
                    Download
                  </Button>
                </>
              ) : null}
              <Button
                type='button'
                variant='destructive'
                size='sm'
                onClick={() => {
                  softDeleteDocument(selectedDocument.id)
                  setPreviewDocumentId(null)
                }}
              >
                <Trash2 className='mr-2 h-4 w-4' aria-hidden='true' />
                Move to trash
              </Button>
            </>
          ) : null
        }
      />

      <Dialog open={Boolean(selectedInfoDocument)} onOpenChange={(open) => !open && setInfoDocumentId(null)}>
        <DialogContent className='max-w-lg overflow-hidden p-0'>
          <DialogHeader className='border-b px-5 py-4 text-left'>
            <DialogTitle>Document info</DialogTitle>
            <DialogDescription>Details about this file and where it lives in the drive.</DialogDescription>
          </DialogHeader>

          {selectedInfoDocument ? (
            <div className='space-y-4 px-5 py-4'>
              <div className='flex items-start gap-3'>
                <div
                  className={cn(
                    'inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border',
                    selectedInfoDocument.mimeType.startsWith('image/')
                      ? 'border-sky-500/20 bg-sky-500/10 text-sky-600'
                      : selectedInfoDocument.mimeType === 'application/pdf'
                        ? 'border-rose-500/20 bg-rose-500/10 text-rose-600'
                      : 'border-border/70 bg-muted/40 text-muted-foreground',
                  )}
                >
                  {InfoDocumentIcon ? <InfoDocumentIcon className={cn('h-5 w-5', selectedInfoDocumentStyle?.iconClassName)} /> : null}
                </div>
                <div className='min-w-0 flex-1 space-y-0.5'>
                  <p className='truncate text-sm font-semibold text-foreground'>{selectedInfoDocument.name}</p>
                  <p className='truncate text-xs text-muted-foreground'>
                    {folderPath(folderMap, selectedInfoDocument.folderId).map((crumb) => crumb.name).join(' / ')}
                  </p>
                </div>
              </div>

              <div className='grid gap-2 sm:grid-cols-2'>
                <div className='rounded-xl border border-border/70 bg-muted/20 p-3'>
                  <div className='flex items-center gap-2'>
                    <FileType className='h-3.5 w-3.5 shrink-0 text-muted-foreground' />
                    <div className='min-w-0'>
                      <p className='text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground'>Type</p>
                      <p className='mt-0.5 truncate text-sm font-medium text-foreground'>{getFileKind(selectedInfoDocument)}</p>
                    </div>
                  </div>
                </div>
                <div className='rounded-xl border border-border/70 bg-muted/20 p-3'>
                  <div className='flex items-center gap-2'>
                    <Shield className='h-3.5 w-3.5 shrink-0 text-muted-foreground' />
                    <div className='min-w-0'>
                      <p className='text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground'>Visibility</p>
                      <p className='mt-0.5 truncate text-sm font-medium text-foreground'>
                        {selectedInfoDocument.visibility === 'shared' ? 'Shared' : 'Private'}
                      </p>
                    </div>
                  </div>
                </div>
                <div className='rounded-xl border border-border/70 bg-muted/20 p-3'>
                  <div className='flex items-center gap-2'>
                    <HardDrive className='h-3.5 w-3.5 shrink-0 text-muted-foreground' />
                    <div className='min-w-0'>
                      <p className='text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground'>Size</p>
                      <p className='mt-0.5 truncate text-sm font-medium text-foreground'>{formatBytes(selectedInfoDocument.size)}</p>
                    </div>
                  </div>
                </div>
                <div className='rounded-xl border border-border/70 bg-muted/20 p-3'>
                  <div className='flex items-center gap-2'>
                    <Upload className='h-3.5 w-3.5 shrink-0 text-muted-foreground' />
                    <div className='min-w-0'>
                      <p className='text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground'>Uploaded</p>
                      <p className='mt-0.5 truncate text-sm font-medium text-foreground'>
                        {formatDistanceToNowStrict(new Date(selectedInfoDocument.uploadedAt), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                </div>
                <div className='rounded-xl border border-border/70 bg-muted/20 p-3'>
                  <div className='flex items-center gap-2'>
                    <UserRound className='h-3.5 w-3.5 shrink-0 text-muted-foreground' />
                    <div className='min-w-0'>
                      <p className='text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground'>Uploaded by</p>
                      <p className='mt-0.5 truncate text-sm font-medium text-foreground'>{selectedInfoDocumentUploaderLabel ?? 'Unknown user'}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className='flex justify-end pt-1'>
                <Button type='button' onClick={() => setInfoDocumentId(null)}>
                  Close
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={filtersDrawerOpen} onOpenChange={setFiltersDrawerOpen}>
        <DialogContent
          className='left-auto right-0 top-0 h-full w-full max-w-[360px] translate-x-0 translate-y-0 rounded-none border-y-0 border-r-0 border-l border-border/80 p-4 shadow-2xl max-[420px]:max-w-full'
          disableAnimations
        >
          <DialogHeader className='space-y-1'>
            <DialogTitle className='text-base'>Filter and sort</DialogTitle>
            <DialogDescription>Refine which files appear and how they are ordered.</DialogDescription>
          </DialogHeader>

          <div className='mt-4 space-y-3'>
            <div className='space-y-2'>
              <p className='text-[11px] uppercase tracking-[0.18em] text-muted-foreground'>File type</p>
              <div className='space-y-2'>
                {DOCUMENT_FILTER_OPTIONS.map((option) => (
                  <Button
                    key={option.value}
                    type='button'
                    variant={documentFilter === option.value ? 'secondary' : 'outline'}
                    className='h-10 w-full justify-start rounded-xl px-3 text-sm'
                    onClick={() => setDocumentFilter(option.value)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className='space-y-2 pt-2'>
              <p className='text-[11px] uppercase tracking-[0.18em] text-muted-foreground'>Sort order</p>
              <div className='space-y-2'>
                {DOCUMENT_SORT_OPTIONS.map((option) => (
                  <Button
                    key={option.value}
                    type='button'
                    variant={documentSort === option.value ? 'secondary' : 'outline'}
                    className='h-auto w-full flex-col items-start justify-start rounded-xl px-3 py-2 text-left'
                    onClick={() => setDocumentSort(option.value)}
                  >
                    <span className='text-sm font-medium text-foreground'>{option.label}</span>
                    <span className='text-xs font-normal text-muted-foreground'>{option.description}</span>
                  </Button>
                ))}
              </div>
            </div>

            <div className='flex items-center gap-2 pt-1'>
              <Button
                type='button'
                variant='outline'
                className='h-9 px-3 text-xs'
                onClick={() => {
                  setDocumentFilter('all')
                  setDocumentSort('newest')
                }}
                disabled={documentFilter === 'all' && documentSort === 'newest'}
              >
                Clear all
              </Button>
              <Button type='button' className='h-9 px-3 text-xs' onClick={() => setFiltersDrawerOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
