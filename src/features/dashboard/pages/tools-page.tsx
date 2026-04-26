import {
  ArrowRightLeft,
  BadgeDollarSign,
  CheckCircle2,
  CircleAlert,
  ChevronRight,
  Clock3,
  HardDrive,
  FileSpreadsheet,
  FileText,
  Loader2,
  ScanSearch,
  Sparkles,
  UploadCloud,
  X,
  WandSparkles,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  convertPdfSource,
  type DrivePdfDocument,
  type PdfConversionProgress,
  type PdfConversionResult,
  type PdfConversionTarget,
  type SelectedPdfSource,
} from '@/features/dashboard/lib/pdf-converter-scribe'
import { notify } from '@/lib/notify'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

type ToolState = 'active' | 'coming-soon'
type ToolItem = {
  id: string
  label: string
  description: string
  icon: LucideIcon
  state: ToolState
}

type ToolGroup = {
  title: string
  items: ToolItem[]
}

const TOOL_GROUPS: ToolGroup[] = [
  {
    title: 'Converters',
    items: [
      {
        id: 'pdf-converter',
        label: 'PDF Converter',
        description: 'Turn PDFs into editable office files.',
        icon: FileText,
        state: 'active',
      },
    ],
  },
  {
    title: 'Extraction',
    items: [
      {
        id: 'document-extractor',
        label: 'Document Extractor',
        description: 'Pull structured content from reports and scans.',
        icon: ScanSearch,
        state: 'coming-soon',
      },
      {
        id: 'invoice-extractor',
        label: 'Invoice Extractor',
        description: 'Capture totals, vendors, and line items.',
        icon: BadgeDollarSign,
        state: 'coming-soon',
      },
    ],
  },
  {
    title: 'Utilities',
    items: [
      {
        id: 'currency-converter',
        label: 'Currency Converter',
        description: 'Normalize document values across currencies.',
        icon: ArrowRightLeft,
        state: 'coming-soon',
      },
      {
        id: 'ai-rewrite',
        label: 'AI Rewrite Tool',
        description: 'Polish tone, structure, and clarity.',
        icon: WandSparkles,
        state: 'coming-soon',
      },
    ],
  },
]

const CONVERSION_TARGETS: Array<{
  value: PdfConversionTarget
  label: string
  shortLabel: string
  description: string
  icon: LucideIcon
}> = [
  {
    value: 'excel',
    label: 'PDF to Excel',
    shortLabel: 'XLSX',
    description: 'Best for reviewing bank statements and transaction tables.',
    icon: FileSpreadsheet,
  },
  {
    value: 'csv',
    label: 'PDF to CSV',
    shortLabel: 'CSV',
    description: 'Best for accounting imports and clean row exports.',
    icon: FileSpreadsheet,
  },
  {
    value: 'word',
    label: 'PDF to Word',
    shortLabel: 'DOCX',
    description: 'Best for editable text-heavy documents.',
    icon: FileText,
  },
]

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

function isPdfFileName(name: string) {
  return name.toLowerCase().endsWith('.pdf')
}

function formatFileDate(value?: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Africa/Blantyre',
  }).format(date)
}

function getEngineLabel(engine?: PdfConversionResult['engine']) {
  if (engine === 'server') return 'Server conversion'
  if (engine === 'local-ocr') return 'Local OCR fallback'
  if (engine === 'local-text') return 'Local text extraction'
  if (engine === 'legacy') return 'Legacy local engine'
  return 'Pending'
}

function ComingSoonBadge({ className }: { className?: string }) {
  return (
    <Badge
      className={cn(
        'border-amber-500/30 bg-amber-500/15 text-amber-800 shadow-none dark:border-amber-400/30 dark:bg-amber-400/15 dark:text-amber-200',
        className,
      )}
    >
      Coming soon
    </Badge>
  )
}

function ToolTreeRow({
  tool,
  active,
  onClick,
}: {
  tool: ToolItem
  active?: boolean
  onClick?: () => void
}) {
  const Icon = tool.icon
  const isComingSoon = tool.state === 'coming-soon'

  return (
    <button
      type='button'
      onClick={onClick}
      disabled={isComingSoon}
      className={cn(
        'group relative flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-75',
        active
          ? 'border-primary/30 bg-primary/10 text-foreground shadow-sm'
          : 'border-border/70 bg-card/70 text-foreground hover:border-border hover:bg-accent/50',
        isComingSoon && 'border-border/60 bg-muted/20',
      )}
    >
      <span
        className={cn(
          'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border',
          active ? 'border-primary/20 bg-primary/15 text-primary' : 'border-border/70 bg-background text-muted-foreground',
          isComingSoon && 'bg-amber-500/10 text-amber-700 dark:text-amber-200',
      )}
      >
        <Icon className='h-4 w-4' aria-hidden='true' />
      </span>
      <span className='min-w-0 flex-1'>
        <span className='block truncate text-sm font-medium'>{tool.label}</span>
      </span>
      {isComingSoon ? <ComingSoonBadge className='absolute right-3 top-0 z-10 -mt-2' /> : null}
      {active ? <ChevronRight className='h-4 w-4 self-center text-primary' aria-hidden='true' /> : null}
    </button>
  )
}

function TargetCard({
  target,
  active,
  onClick,
}: {
  target: (typeof CONVERSION_TARGETS)[number]
  active: boolean
  onClick: () => void
}) {
  const Icon = target.icon
  return (
    <button
      type='button'
      onClick={onClick}
      className={cn(
        'flex h-full flex-col justify-between rounded-2xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'border-primary/30 bg-primary/10 shadow-sm'
          : 'border-border/70 bg-card/75 hover:border-border hover:bg-accent/30',
      )}
    >
      <div className='flex items-start justify-between gap-3'>
        <span
          className={cn(
            'inline-flex h-10 w-10 items-center justify-center rounded-xl border',
            active ? 'border-primary/20 bg-primary/15 text-primary' : 'border-border/70 bg-background text-muted-foreground',
          )}
        >
          <Icon className='h-4 w-4' aria-hidden='true' />
        </span>
        <Badge
          variant='outline'
          className='border-border/70 bg-background/70 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground'
        >
          {target.shortLabel}
        </Badge>
      </div>
      <div className='mt-4 space-y-2'>
        <p className='text-sm font-semibold text-foreground'>{target.label}</p>
        <p className='text-xs leading-5 text-muted-foreground'>{target.description}</p>
      </div>
      <div className='mt-4 flex items-center justify-between text-xs'>
        <span className={cn('font-medium', active ? 'text-primary' : 'text-muted-foreground')}>{active ? 'Selected' : 'Select target'}</span>
        <span className='inline-flex items-center gap-1 text-muted-foreground'>
          <Sparkles className='h-3.5 w-3.5' aria-hidden='true' />
          Ready
        </span>
      </div>
    </button>
  )
}

function downloadBlob(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = fileName
  link.rel = 'noreferrer'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000)
}

type ConversionToastState = {
  open: boolean
  status: 'loading' | 'success' | 'error'
  title: string
  detail: string
  progress: number
}

export function ToolsPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const conversionToastTimerRef = useRef<number | null>(null)
  const conversionHeartbeatRef = useRef<number | null>(null)
  const conversionProgressRef = useRef({ percent: 0, updatedAt: 0 })
  const conversionActiveRef = useRef(false)
  const [selectedTarget, setSelectedTarget] = useState<PdfConversionTarget>('excel')
  const [selectedSource, setSelectedSource] = useState<SelectedPdfSource | null>(null)
  const [dragging, setDragging] = useState(false)
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false)
  const [sourcePickerView, setSourcePickerView] = useState<'chooser' | 'drive'>('chooser')
  const [sourceSearch, setSourceSearch] = useState('')
  const [drivePdfDocuments, setDrivePdfDocuments] = useState<DrivePdfDocument[]>([])
  const [driveLoading, setDriveLoading] = useState(false)
  const [isConverting, setIsConverting] = useState(false)
  const [conversionToast, setConversionToast] = useState<ConversionToastState | null>(null)

  const activeTarget = useMemo(
    () => CONVERSION_TARGETS.find((target) => target.value === selectedTarget) ?? CONVERSION_TARGETS[0],
    [selectedTarget],
  )

  const selectedSourceName = selectedSource?.kind === 'drive' ? selectedSource.document.name : selectedSource?.file.name ?? null
  const selectedSourceSize = selectedSource?.kind === 'drive' ? selectedSource.document.size : selectedSource?.file.size ?? null
  const selectedSourceLabel = selectedSource?.kind === 'drive' ? 'My Drive' : selectedSource ? 'Local storage' : null
  const selectedSourceTimestamp = selectedSource?.kind === 'drive' ? formatFileDate(selectedSource.document.uploadedAt) : null
  const filteredDrivePdfDocuments = useMemo(() => {
    const query = sourceSearch.trim().toLowerCase()
    if (!query) return drivePdfDocuments
    return drivePdfDocuments.filter((document) => document.name.toLowerCase().includes(query))
  }, [drivePdfDocuments, sourceSearch])

  useEffect(() => {
    let cancelled = false
    setDriveLoading(true)

    void (async () => {
      const { data, error } = await supabase
        .from('drive_documents')
        .select('id,file_name,mime_type,file_size_bytes,storage_path,created_at,deleted_at')
        .order('created_at', { ascending: false })

      if (cancelled) return

      if (error) {
        notify.error('My Drive could not be loaded', { description: error.message })
        setDrivePdfDocuments([])
      } else {
        setDrivePdfDocuments(
          (data ?? [])
            .filter((document) => !document.deleted_at && (document.mime_type === 'application/pdf' || isPdfFileName(document.file_name)))
            .map((document) => ({
              id: document.id,
              name: document.file_name,
              size: Number(document.file_size_bytes ?? 0),
              storagePath: document.storage_path,
              uploadedAt: document.created_at,
            })),
        )
      }

      setDriveLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return () => {
      if (conversionToastTimerRef.current !== null) {
        window.clearTimeout(conversionToastTimerRef.current)
      }
    }
  }, [])

  const handleFileSelection = (files: FileList | File[]) => {
    const nextFile = Array.from(files).find((file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))
    if (nextFile) {
      setSelectedSource({ kind: 'local', file: nextFile })
    }
  }

  const openLocalStoragePicker = () => {
    setSourcePickerOpen(false)
    window.setTimeout(() => {
      fileInputRef.current?.click()
    }, 0)
  }

  const handleMyDriveSelection = () => {
    setSourcePickerView('drive')
    setSourceSearch('')
  }

  const handleSelectDriveDocument = (document: DrivePdfDocument) => {
    setSelectedSource({ kind: 'drive', document })
    setSourcePickerOpen(false)
    setSourcePickerView('chooser')
    notify.success('PDF selected from My Drive', {
      description: document.name,
    })
  }

  const handleConvert = async () => {
    if (!selectedSource || isConverting) return

    setIsConverting(true)
    conversionActiveRef.current = true
    if (conversionToastTimerRef.current !== null) {
      window.clearTimeout(conversionToastTimerRef.current)
      conversionToastTimerRef.current = null
    }
    if (conversionHeartbeatRef.current !== null) {
      window.clearInterval(conversionHeartbeatRef.current)
      conversionHeartbeatRef.current = null
    }
    conversionProgressRef.current = { percent: 0, updatedAt: Date.now() }
    setConversionToast({
      open: true,
      status: 'loading',
      title: 'Converting PDF',
      detail: 'Preparing the export engine.',
      progress: 0,
    })

    conversionHeartbeatRef.current = window.setInterval(() => {
      const current = conversionProgressRef.current
      if (!conversionActiveRef.current) return
      if (!current.updatedAt) return

      const elapsed = Date.now() - current.updatedAt
      if (elapsed < 1000) return

      const nextPercent = Math.min(98, current.percent + (current.percent >= 90 ? 1 : elapsed > 5000 ? 6 : 2))
      if (nextPercent <= current.percent) return

      conversionProgressRef.current = {
        percent: nextPercent,
        updatedAt: Date.now(),
      }

      setConversionToast((existing) => {
        if (!existing?.open || existing.status !== 'loading') return existing
        return {
          ...existing,
          detail: existing.detail || `Preparing ${activeTarget.shortLabel}.`,
          progress: nextPercent,
          title: nextPercent >= 90 ? 'Finalizing conversion' : existing.title,
        }
      })
    }, 750)

    try {
      const result = await convertPdfSource(selectedSource, selectedTarget, (progress: PdfConversionProgress) => {
        conversionProgressRef.current = {
          percent: progress.percent,
          updatedAt: Date.now(),
        }
        setConversionToast((current) => {
          if (!current?.open) return current
          return {
            ...current,
            status: 'loading',
            title: progress.label,
            detail: progress.detail ?? `Preparing ${activeTarget.shortLabel}.`,
            progress: progress.percent,
          }
        })
      })
      downloadBlob(result.blob, result.fileName)
      setConversionToast({
        open: true,
        status: 'success',
        title: 'Conversion complete',
        detail: `${result.fileName} is ready in your downloads. ${getEngineLabel(result.engine)} handled this file.`,
        progress: 100,
      })
      conversionToastTimerRef.current = window.setTimeout(() => {
        setConversionToast(null)
        conversionToastTimerRef.current = null
      }, 1800)
    } catch (error) {
      setConversionToast({
        open: true,
        status: 'error',
        title: 'Conversion failed',
        detail: error instanceof Error ? error.message : 'Unable to convert the selected PDF.',
        progress: 100,
      })
    } finally {
      setIsConverting(false)
      conversionActiveRef.current = false
      if (conversionHeartbeatRef.current !== null) {
        window.clearInterval(conversionHeartbeatRef.current)
        conversionHeartbeatRef.current = null
      }
    }
  }

  return (
    <div className='flex h-full min-h-0 w-full flex-col gap-6'>
      {conversionToast?.open ? (
        <div className='fixed right-4 top-4 z-50 w-[min(24rem,calc(100vw-2rem))] sm:right-6 sm:top-6'>
          <section className='rounded-2xl border border-border/70 bg-card/95 p-4 shadow-2xl backdrop-blur-md'>
            <div className='flex items-start justify-between gap-4'>
              <div className='flex min-w-0 items-start gap-3'>
                <div
                  className={cn(
                    'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
                    conversionToast.status === 'success'
                      ? 'bg-emerald-500/10 text-emerald-600'
                      : conversionToast.status === 'error'
                        ? 'bg-destructive/10 text-destructive'
                        : 'bg-primary/10 text-primary',
                  )}
                >
                  {conversionToast.status === 'success' ? (
                    <CheckCircle2 className='h-4 w-4' />
                  ) : conversionToast.status === 'error' ? (
                    <CircleAlert className='h-4 w-4' />
                  ) : (
                    <Loader2 className='h-4 w-4 animate-spin' />
                  )}
                </div>
                <div className='min-w-0'>
                  <h3 className='truncate text-sm font-semibold text-foreground'>{conversionToast.title}</h3>
                  <p className='mt-1 text-xs text-muted-foreground'>{conversionToast.detail}</p>
                </div>
              </div>

              {conversionToast.status !== 'loading' ? (
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  className='h-8 w-8'
                  onClick={() => setConversionToast(null)}
                  aria-label='Dismiss conversion progress'
                >
                  <X className='h-4 w-4 text-muted-foreground' />
                </Button>
              ) : null}
            </div>

            <div className='mt-3 h-2 overflow-hidden rounded-full bg-muted'>
              <div
                className={cn(
                  'h-full rounded-full transition-[width] duration-200 ease-out',
                  conversionToast.status === 'error' ? 'bg-destructive' : conversionToast.status === 'success' ? 'bg-emerald-500' : 'bg-primary',
                )}
                style={{ width: `${Math.max(0, Math.min(100, conversionToast.progress))}%` }}
              />
            </div>

            <p className='mt-3 text-xs font-medium tabular-nums text-muted-foreground'>{Math.round(conversionToast.progress)}%</p>
          </section>
        </div>
      ) : null}

      <div className='grid flex-1 min-h-0 gap-6 xl:grid-cols-[320px_minmax(0,1fr)]'>
        <aside className='flex h-full min-h-0 flex-col overflow-hidden rounded-3xl border bg-card/85 shadow-[var(--elevation-sm)]'>
          <div className='border-b border-border/70 px-5 py-4'>
            <p className='text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground'>Tool navigator</p>
            <p className='mt-1 text-sm text-muted-foreground'>Structured like a folder tree so the suite feels familiar inside Files.</p>
          </div>
          <div className='min-h-0 flex-1 space-y-5 overflow-y-auto p-4'>
            {TOOL_GROUPS.map((group) => (
              <section key={group.title} className='space-y-3'>
                <div className='flex items-center justify-between px-1'>
                  <h2 className='text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground'>{group.title}</h2>
                  <span className='text-[11px] text-muted-foreground'>{group.items.length} items</span>
                </div>
                <div className='space-y-2'>
                  {group.items.map((tool) =>
                    tool.id === 'pdf-converter' ? (
                      <ToolTreeRow key={tool.id} tool={tool} active />
                    ) : (
                      <ToolTreeRow key={tool.id} tool={tool} />
                    ),
                  )}
                </div>
              </section>
            ))}
          </div>
        </aside>

        <main className='flex h-full min-w-0 flex-col'>
          <Card className='flex h-full min-h-0 flex-col overflow-hidden border-border/70 bg-card/90 shadow-[var(--elevation-sm)]'>
            <CardHeader className='border-b border-border/70 bg-muted/20'>
              <CardTitle className='text-2xl'>Spreadsheet-first PDF conversion</CardTitle>
              <p className='max-w-2xl text-sm leading-6 text-muted-foreground'>
                Build clean Excel or CSV exports for statements and keep Word or PowerPoint available for general document work.
              </p>
            </CardHeader>

            <CardContent className='flex-1 overflow-y-auto p-5 lg:p-6'>
              <section className='space-y-5'>
                <div className='space-y-4'>
                  <div
                    onDragEnter={(event) => {
                      event.preventDefault()
                      setDragging(true)
                    }}
                    onDragOver={(event) => {
                      event.preventDefault()
                      setDragging(true)
                    }}
                    onDragLeave={(event) => {
                      event.preventDefault()
                      setDragging(false)
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      setDragging(false)
                      handleFileSelection(event.dataTransfer.files)
                    }}
                    className={cn(
                      'rounded-3xl border border-dashed px-6 py-8 transition-colors',
                      dragging ? 'border-primary/50 bg-primary/5' : 'border-border/80 bg-background/40',
                    )}
                  >
                    <div className='flex flex-col items-center justify-center gap-5 text-center md:min-h-[240px]'>
                      <div className='inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-border/70 bg-background text-primary shadow-sm'>
                        <UploadCloud className='h-5 w-5' aria-hidden='true' />
                      </div>
                      <div className='space-y-1'>
                        <h3 className='text-lg font-semibold text-foreground'>Upload a PDF</h3>
                        <p className='max-w-lg text-sm leading-6 text-muted-foreground'>
                          Use bank statements, invoices, or reports. Excel and CSV are prioritized for statement-style files.
                        </p>
                      </div>
                      <div className='flex flex-wrap items-center justify-center gap-3'>
                        <input
                          ref={fileInputRef}
                          type='file'
                          accept='.pdf,application/pdf'
                          className='hidden'
                          onChange={(event) => handleFileSelection(event.target.files ?? [])}
                        />
                        <Button
                          type='button'
                          variant='outline'
                          onClick={() => {
                            setSourcePickerView('chooser')
                            setSourceSearch('')
                            setSourcePickerOpen(true)
                          }}
                        >
                          <UploadCloud className='h-4 w-4' />
                          Browse files
                        </Button>
                        <Button type='button' disabled={!selectedSource || isConverting} onClick={handleConvert}>
                          {isConverting ? <Loader2 className='h-4 w-4 animate-spin' /> : <ArrowRightLeft className='h-4 w-4' />}
                          {isConverting ? 'Converting' : `Convert to ${activeTarget.shortLabel}`}
                        </Button>
                      </div>
                    </div>

                    {selectedSource ? (
                      <div className='mt-6 rounded-2xl border border-border/70 bg-card/90 p-4 shadow-sm'>
                        <div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
                          <div className='min-w-0'>
                            <p className='text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground'>Selected file</p>
                            <p className='mt-1 truncate text-sm font-semibold text-foreground'>{selectedSourceName}</p>
                            <p className='mt-1 text-xs text-muted-foreground'>
                              {selectedSourceSize !== null ? `${formatBytes(selectedSourceSize)} · PDF ready for conversion` : 'PDF ready for conversion'}
                            </p>
                            {selectedSourceTimestamp ? <p className='mt-1 text-xs text-muted-foreground'>Uploaded {selectedSourceTimestamp}</p> : null}
                          </div>
                          <div className='flex flex-wrap items-center gap-2'>
                            <Badge variant='outline' className='border-emerald-500/20 bg-emerald-500/10 text-emerald-700 shadow-none dark:text-emerald-300'>
                              <CheckCircle2 className='mr-1 h-3.5 w-3.5' />
                              Ready
                            </Badge>
                            <Badge variant='outline' className='border-border/70 bg-background/70 text-muted-foreground shadow-none'>
                              <Clock3 className='mr-1 h-3.5 w-3.5' />
                              Conversion pending
                            </Badge>
                            {selectedSourceLabel ? (
                              <Badge variant='outline' className='border-border/70 bg-background/70 text-muted-foreground shadow-none'>
                                {selectedSourceLabel}
                              </Badge>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className='space-y-3'>
                    <div className='flex items-center justify-between gap-3'>
                      <div>
                        <h3 className='text-sm font-semibold text-foreground'>Conversion targets</h3>
                        <p className='text-xs text-muted-foreground'>Excel and CSV are the primary paths. Word stays available for general documents.</p>
                      </div>
                      <Badge variant='outline' className='border-border/70 bg-background/70 text-muted-foreground shadow-none'>
                        {activeTarget.shortLabel} selected
                      </Badge>
                    </div>

                    <div className='grid gap-3 lg:grid-cols-3'>
                      {CONVERSION_TARGETS.map((target) => (
                        <TargetCard
                          key={target.value}
                          target={target}
                          active={selectedTarget === target.value}
                          onClick={() => setSelectedTarget(target.value)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            </CardContent>
          </Card>
        </main>
      </div>

      <Dialog
        open={sourcePickerOpen}
        onOpenChange={(open) => {
          setSourcePickerOpen(open)
          if (!open) {
            setSourcePickerView('chooser')
            setSourceSearch('')
          }
        }}
      >
        <DialogContent className='sm:max-w-lg'>
          <DialogHeader className='space-y-2'>
            <DialogTitle>{sourcePickerView === 'drive' ? 'Select from My Drive' : 'Choose file source'}</DialogTitle>
            <DialogDescription>
              {sourcePickerView === 'drive' ? 'Only PDF files are shown here.' : 'Select where you want to pick the PDF from.'}
            </DialogDescription>
          </DialogHeader>
          {sourcePickerView === 'chooser' ? (
            <div className='grid gap-4 pt-2 sm:grid-cols-2'>
              <button
                type='button'
                onClick={handleMyDriveSelection}
                className='flex flex-col items-start gap-3 rounded-2xl border border-border/70 bg-card px-5 py-5 text-left transition-colors hover:border-border hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              >
                <span className='inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border/70 bg-background text-primary'>
                  <HardDrive className='h-5 w-5' aria-hidden='true' />
                </span>
                <span>
                  <span className='block text-sm font-semibold text-foreground'>My Drive</span>
                  <span className='mt-1 block text-xs text-muted-foreground'>Pick a PDF from your cloud drive.</span>
                </span>
              </button>
              <button
                type='button'
                onClick={openLocalStoragePicker}
                className='flex flex-col items-start gap-3 rounded-2xl border border-border/70 bg-card px-5 py-5 text-left transition-colors hover:border-border hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              >
                <span className='inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border/70 bg-background text-primary'>
                  <UploadCloud className='h-5 w-5' aria-hidden='true' />
                </span>
                <span>
                  <span className='block text-sm font-semibold text-foreground'>Local storage</span>
                  <span className='mt-1 block text-xs text-muted-foreground'>Browse files from this device.</span>
                </span>
              </button>
            </div>
          ) : (
            <div className='space-y-4 pt-2'>
              <div className='flex items-center justify-between gap-3'>
                <p className='text-sm font-medium text-foreground'>PDF files in My Drive</p>
                <Button type='button' variant='ghost' size='sm' onClick={() => setSourcePickerView('chooser')} className='-mr-2'>
                  Back
                </Button>
              </div>
              <Input
                value={sourceSearch}
                onChange={(event) => setSourceSearch(event.target.value)}
                placeholder='Search PDFs'
                aria-label='Search PDFs in My Drive'
              />
              <div className='max-h-[320px] space-y-2 overflow-y-auto pr-1'>
                {driveLoading ? (
                  <div className='flex items-center justify-center rounded-2xl border border-border/70 bg-card px-4 py-12 text-sm text-muted-foreground'>
                    <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                    Loading PDFs
                  </div>
                ) : filteredDrivePdfDocuments.length > 0 ? (
                  filteredDrivePdfDocuments.map((document) => (
                    <button
                      key={document.id}
                      type='button'
                      onClick={() => handleSelectDriveDocument(document)}
                      className='flex w-full items-center gap-4 rounded-2xl border border-border/70 bg-card px-4 py-4 text-left transition-colors hover:border-border hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                    >
                      <span className='inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-background text-primary'>
                        <FileText className='h-4 w-4' aria-hidden='true' />
                      </span>
                      <span className='min-w-0 flex-1'>
                        <span className='block truncate text-sm font-semibold text-foreground'>{document.name}</span>
                        <span className='mt-1 block text-xs text-muted-foreground'>{formatBytes(document.size)}</span>
                      </span>
                      <Badge variant='outline' className='border-border/70 bg-background/70 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground'>
                        PDF
                      </Badge>
                    </button>
                  ))
                ) : (
                  <div className='rounded-2xl border border-dashed border-border/70 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground'>
                    {sourceSearch.trim() ? 'No matching PDF files found in My Drive.' : 'No PDF files found in My Drive.'}
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter className='pt-2'>
            <Button
              type='button'
              variant='outline'
              onClick={() => {
                setSourcePickerOpen(false)
                setSourcePickerView('chooser')
              }}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
