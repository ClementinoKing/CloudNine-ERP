import type { CSSProperties, ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { getOfficeViewerUrl, type DocumentViewerMode } from '@/lib/document-preview'
import { FileText, Loader2, X } from 'lucide-react'

type DocumentViewerModalProps = {
  open: boolean
  title: string
  subtitle?: string | null
  kindLabel?: string | null
  viewerMode: DocumentViewerMode | null
  resolvedUrl: string | null
  loading?: boolean
  csvRows?: string[][]
  csvLoading?: boolean
  csvError?: string | null
  onClose: () => void
  headerActions?: ReactNode
  footerNote?: ReactNode
  contentStyle?: CSSProperties
}

export function DocumentViewerModal({
  open,
  title,
  subtitle,
  kindLabel,
  viewerMode,
  resolvedUrl,
  loading = false,
  csvRows = [],
  csvLoading = false,
  csvError = null,
  onClose,
  headerActions,
  footerNote,
  contentStyle,
}: DocumentViewerModalProps) {
  const defaultFooter = (
    <p>
      Documents open in the built-in viewer when possible. If a file does not render inline, use{' '}
      <span className='font-medium text-foreground'>Open file</span> or <span className='font-medium text-foreground'>Download</span>.
    </p>
  )

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        showClose={false}
        style={contentStyle}
        className='left-0 top-0 h-[100dvh] max-h-[100dvh] w-[100vw] max-w-none translate-x-0 translate-y-0 rounded-none border-0 bg-background p-0 shadow-none'
      >
        <DialogTitle className='sr-only'>{title}</DialogTitle>
        <DialogDescription className='sr-only'>Full-screen document viewer for images, PDFs, CSVs, and office documents.</DialogDescription>

        <div className='flex h-full flex-col overflow-hidden bg-background'>
          <div className='flex items-start justify-between gap-4 border-b border-border/70 px-4 py-3 sm:px-6'>
            <div className='min-w-0 space-y-1'>
              <div className='flex flex-wrap items-center gap-2'>
                <h3 className='truncate text-sm font-semibold text-foreground'>{title}</h3>
                {kindLabel ? (
                  <Badge variant='secondary' className='rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.16em]'>
                    {kindLabel}
                  </Badge>
                ) : null}
              </div>
              {subtitle ? <p className='text-xs text-muted-foreground'>{subtitle}</p> : null}
            </div>

            <div className='flex items-center gap-2'>
              {headerActions}
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className='h-9 w-9 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground'
                onClick={onClose}
                aria-label='Close viewer'
              >
                <X className='h-4 w-4' aria-hidden='true' />
              </Button>
            </div>
          </div>

          <div className='flex min-h-0 flex-1 items-stretch justify-center bg-black/95'>
            {loading ? (
              <div className='flex h-full w-full items-center justify-center p-8 text-center'>
                <div className='max-w-sm space-y-3'>
                  <FileText className='mx-auto h-10 w-10 animate-pulse text-muted-foreground' />
                  <p className='text-sm font-medium text-foreground'>Loading preview...</p>
                </div>
              </div>
            ) : !resolvedUrl ? (
              <div className='flex h-full w-full items-center justify-center p-8 text-center text-sm text-muted-foreground'>
                <div className='max-w-md space-y-2'>
                  <p className='font-medium text-foreground'>Preview unavailable</p>
                  <p>This file can still be opened in a new tab using the action in the header.</p>
                </div>
              </div>
            ) : viewerMode === 'image' ? (
              <div className='flex h-full w-full items-center justify-center p-4 sm:p-6'>
                <img
                  src={resolvedUrl}
                  alt={title}
                  className='max-h-full max-w-full rounded-2xl object-contain shadow-[0_20px_60px_hsl(var(--foreground)/0.2)]'
                />
              </div>
            ) : viewerMode === 'pdf' ? (
              <iframe title={title} src={resolvedUrl} className='h-full w-full border-0 bg-background' />
            ) : viewerMode === 'csv' ? (
              <div className='flex h-full w-full items-stretch justify-center bg-background p-4 sm:p-6'>
                <div className='w-full max-w-[1400px] overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm'>
                  {csvLoading ? (
                    <div className='flex min-h-[18rem] items-center justify-center p-8 text-center'>
                      <div className='max-w-sm space-y-3'>
                        <Loader2 className='mx-auto h-10 w-10 animate-spin text-muted-foreground' />
                        <p className='text-sm font-medium text-foreground'>Loading CSV preview...</p>
                      </div>
                    </div>
                  ) : csvError ? (
                    <div className='flex min-h-[18rem] items-center justify-center p-8 text-center text-sm text-muted-foreground'>
                      <div className='max-w-md space-y-2'>
                        <p className='font-medium text-foreground'>CSV preview unavailable</p>
                        <p>{csvError}</p>
                      </div>
                    </div>
                  ) : csvRows.length === 0 ? (
                    <div className='flex min-h-[18rem] items-center justify-center p-8 text-center text-sm text-muted-foreground'>
                      <div className='max-w-md space-y-2'>
                        <p className='font-medium text-foreground'>CSV file is empty</p>
                        <p>This file does not contain any previewable rows.</p>
                      </div>
                    </div>
                  ) : (
                    <div className='max-h-full overflow-auto'>
                      <table className='min-w-full border-collapse text-sm'>
                        <thead className='sticky top-0 z-10 bg-card/95 backdrop-blur'>
                          <tr className='border-b border-border/70'>
                            {csvRows[0].map((cell, index) => (
                              <th
                                key={`csv-head-${index}`}
                                className='whitespace-nowrap border-r border-border/70 px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground last:border-r-0'
                              >
                                {cell || `Column ${index + 1}`}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {csvRows.slice(1).map((row, rowIndex) => (
                            <tr key={`csv-row-${rowIndex}`} className='border-b border-border/50 last:border-b-0'>
                              {row.map((cell, cellIndex) => (
                                <td
                                  key={`csv-row-${rowIndex}-cell-${cellIndex}`}
                                  className='max-w-[18rem] border-r border-border/50 px-4 py-3 align-top text-foreground last:border-r-0'
                                >
                                  <span className='block break-words'>{cell || '\u00A0'}</span>
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <iframe title={title} src={getOfficeViewerUrl(resolvedUrl)} className='h-full w-full border-0 bg-background' />
            )}
          </div>

          <div className='border-t border-border/70 px-4 py-3 text-xs text-muted-foreground sm:px-6'>
            {footerNote ?? defaultFooter}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
