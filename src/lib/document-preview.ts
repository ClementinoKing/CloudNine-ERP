import { FileText, Image } from 'lucide-react'
import { FaFilePdf } from 'react-icons/fa6'
import { PiMicrosoftExcelLogo, PiMicrosoftPowerpointLogo, PiMicrosoftWordLogo } from 'react-icons/pi'
import type { ComponentType } from 'react'

export type DocumentViewerMode = 'image' | 'pdf' | 'csv' | 'office'

export type DocumentStyle = {
  shellClassName: string
  iconClassName: string
  Icon: ComponentType<{ className?: string }>
}

export function getAttachmentExtension(fileName: string) {
  const rawExtension = fileName.split('.').pop()?.toLowerCase() ?? ''
  if (rawExtension === 'pttx') return 'pptx'
  return rawExtension
}

export function isImageAttachmentName(fileName: string) {
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif'].includes(getAttachmentExtension(fileName))
}

export function getDocumentStyle(name: string): DocumentStyle {
  const extension = getAttachmentExtension(name)
  if (isImageAttachmentName(name)) {
    return {
      shellClassName: 'border-sky-500/20 bg-gradient-to-br from-sky-500/10 via-background to-background',
      iconClassName: 'text-sky-600',
      Icon: Image,
    }
  }
  if (extension === 'pdf') {
    return {
      shellClassName: 'border-rose-500/20 bg-gradient-to-br from-rose-500/10 via-background to-background',
      iconClassName: 'text-rose-600',
      Icon: FaFilePdf,
    }
  }
  if (extension === 'docx' || extension === 'doc' || extension === 'odt' || extension === 'rtf') {
    return {
      shellClassName: 'border-sky-500/20 bg-gradient-to-br from-sky-500/10 via-background to-background',
      iconClassName: 'text-sky-600',
      Icon: PiMicrosoftWordLogo,
    }
  }
  if (extension === 'xlsx' || extension === 'xls' || extension === 'csv' || extension === 'ods') {
    return {
      shellClassName: 'border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-background to-background',
      iconClassName: 'text-emerald-600',
      Icon: PiMicrosoftExcelLogo,
    }
  }
  if (extension === 'pptx' || extension === 'ppt' || extension === 'odp') {
    return {
      shellClassName: 'border-amber-500/20 bg-gradient-to-br from-amber-500/10 via-background to-background',
      iconClassName: 'text-amber-600',
      Icon: PiMicrosoftPowerpointLogo,
    }
  }

  return {
    shellClassName: 'border-border/70 bg-gradient-to-br from-muted/50 via-background to-background',
    iconClassName: 'text-muted-foreground',
    Icon: FileText,
  }
}

export function getDocumentTypeLabel(name: string) {
  const extension = getAttachmentExtension(name)
  if (isImageAttachmentName(name)) return 'IMG'
  if (extension === 'xlsx' || extension === 'xls' || extension === 'csv' || extension === 'ods') return 'SHEET'
  if (extension === 'docx' || extension === 'doc' || extension === 'odt' || extension === 'rtf') return 'DOC'
  if (extension === 'pptx' || extension === 'ppt' || extension === 'odp') return 'PPT'
  return extension ? extension.toUpperCase() : 'FILE'
}

export function getDocumentViewerMode(fileName: string, mimeType?: string | null) {
  const extension = getAttachmentExtension(fileName)
  const normalizedMimeType = (mimeType ?? '').toLowerCase()

  if (
    normalizedMimeType.startsWith('image/') ||
    ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif'].includes(extension)
  ) {
    return 'image' as const
  }

  if (normalizedMimeType.includes('pdf') || extension === 'pdf') {
    return 'pdf' as const
  }

  if (normalizedMimeType.includes('csv') || extension === 'csv') {
    return 'csv' as const
  }

  return 'office' as const
}

export function getOfficeViewerUrl(url: string) {
  return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`
}

export function getExcelViewerUrl(url: string) {
  return `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(url)}`
}

export function parseCsvText(text: string) {
  const rows: string[][] = []
  let currentRow: string[] = []
  let currentCell = ''
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]

    if (inQuotes) {
      if (char === '"' && next === '"') {
        currentCell += '"'
        index += 1
        continue
      }
      if (char === '"') {
        inQuotes = false
        continue
      }
      currentCell += char
      continue
    }

    if (char === '"') {
      inQuotes = true
      continue
    }

    if (char === ',') {
      currentRow.push(currentCell)
      currentCell = ''
      continue
    }

    if (char === '\r') {
      continue
    }

    if (char === '\n') {
      currentRow.push(currentCell)
      rows.push(currentRow)
      currentRow = []
      currentCell = ''
      continue
    }

    currentCell += char
  }

  currentRow.push(currentCell)
  if (currentRow.some((cell) => cell.trim().length > 0) || rows.length === 0) {
    rows.push(currentRow)
  }

  return rows.filter((row) => row.some((cell) => cell.trim().length > 0))
}
