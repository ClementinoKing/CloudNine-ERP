import { resolveR2ObjectUrl } from '@/lib/r2'
import { supabase } from '@/lib/supabase'

export type PdfConversionTarget = 'excel' | 'csv' | 'word' | 'powerpoint'
export type PdfConversionEngine = 'server' | 'local-text' | 'local-ocr' | 'legacy'

export type DrivePdfDocument = {
  id: string
  name: string
  size: number
  storagePath: string
  uploadedAt: string
}

export type SelectedPdfSource =
  | { kind: 'local'; file: File }
  | { kind: 'drive'; document: DrivePdfDocument }

type ExtractedPdfPage = {
  pageNumber: number
  lines: string[]
}

type DocxParagraph = import('docx').Paragraph

export type PdfConversionResult = {
  fileName: string
  blob: Blob
  engine: PdfConversionEngine
}

export type PdfConversionProgress = {
  percent: number
  label: string
  detail?: string
}

function stripPdfExtension(fileName: string) {
  return fileName.replace(/\.pdf$/i, '')
}

function getSourceName(source: SelectedPdfSource) {
  return source.kind === 'drive' ? source.document.name : source.file.name
}

function getOutputFileName(source: SelectedPdfSource, target: PdfConversionTarget) {
  const baseName = stripPdfExtension(getSourceName(source)).trim() || 'converted-document'
  const extension = target === 'excel' ? 'xlsx' : target === 'csv' ? 'csv' : target === 'word' ? 'docx' : 'pptx'
  return `${baseName}.${extension}`
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

const PDFJS_STANDARD_FONT_DATA_URL = `${import.meta.env.BASE_URL}pdfjs/standard_fonts/`
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
function groupPageText(textItems: Array<{ str?: string; transform?: number[] }>) {
  const positionedItems = textItems
    .map((item) => ({
      text: normalizeText(String(item.str ?? '')),
      x: Number(item.transform?.[4] ?? 0),
      y: Number(item.transform?.[5] ?? 0),
    }))
    .filter((item) => item.text.length > 0)

  if (positionedItems.length === 0) return []

  const sortedItems = positionedItems.sort((left, right) => right.y - left.y || left.x - right.x)
  const lines: Array<{ y: number; items: typeof positionedItems }> = []
  const lineThreshold = 3

  for (const item of sortedItems) {
    const existingLine = lines.find((line) => Math.abs(line.y - item.y) <= lineThreshold)
    if (!existingLine) {
      lines.push({ y: item.y, items: [item] })
      continue
    }

    existingLine.items.push(item)
    existingLine.y = (existingLine.y * (existingLine.items.length - 1) + item.y) / existingLine.items.length
  }

  return lines
    .sort((left, right) => right.y - left.y)
    .map((line) => line.items.sort((left, right) => left.x - right.x).map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

async function loadPdfBytes(source: SelectedPdfSource) {
  if (source.kind === 'local') {
    return new Uint8Array(await source.file.arrayBuffer())
  }

  const objectUrl = await resolveR2ObjectUrl(source.document.storagePath)
  const response = await fetch(objectUrl)
  if (!response.ok) {
    throw new Error(`Could not load "${source.document.name}" from My Drive.`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

async function loadPdfFile(source: SelectedPdfSource) {
  const bytes = await loadPdfBytes(source)
  return new File([bytes], getSourceName(source), { type: 'application/pdf' })
}

export async function extractTextPdfPages(source: SelectedPdfSource, onProgress?: (progress: PdfConversionProgress) => void) {
  const data = await loadPdfBytes(source)
  const { getDocument } = await import('pdfjs-dist/webpack.mjs')
  const loadingTask = getDocument({
    data,
    disableWorker: true,
    standardFontDataUrl: PDFJS_STANDARD_FONT_DATA_URL,
  } as any)

  try {
    const pdfDocument = await loadingTask.promise
    const pageNumbers = Array.from({ length: pdfDocument.numPages }, (_, index) => index + 1)
    const pages: ExtractedPdfPage[] = []

    for (const pageNumber of pageNumbers) {
      onProgress?.({
        percent: 10 + Math.round(((pageNumber - 1) / pageNumbers.length) * 70),
        label: 'Extracting text',
        detail: `Reading page ${pageNumber} of ${pageNumbers.length}`,
      })

      const page = await pdfDocument.getPage(pageNumber)
      const textContent = await page.getTextContent()
      const lines = groupPageText(textContent.items as Array<{ str?: string; transform?: number[] }>)

      pages.push({
        pageNumber,
        lines: lines.length > 0 ? lines : ['No extractable text found on this page.'],
      })
    }

    return {
      title: source.kind === 'drive' ? source.document.name : source.file.name,
      pages,
    }
  } finally {
    loadingTask.destroy()
  }
}

type ScribeProgressMessage = {
  n?: number
  type?: string
  info?: {
    status?: string
    engineName?: string
  }
}

let scribePromise: Promise<any> | null = null

async function getScribe() {
  if (!scribePromise) {
    scribePromise = import('scribe.js-ocr').then((module) => module.default)
  }
  return await scribePromise
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize)
    binary += String.fromCharCode(...chunk)
  }

  return btoa(binary)
}

async function getSupabaseAccessToken() {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? SUPABASE_ANON_KEY ?? ''
}

async function convertWithServerEngine(
  source: SelectedPdfSource,
  target: PdfConversionTarget,
  onProgress?: (progress: PdfConversionProgress) => void,
) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase environment variables are missing.')
  }

  onProgress?.({ percent: 5, label: 'Loading PDF' })
  const bytes = await loadPdfBytes(source)
  onProgress?.({ percent: 15, label: 'Uploading PDF' })

  const token = await getSupabaseAccessToken()
  const response = await fetch(`${SUPABASE_URL}/functions/v1/pdf-convert`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fileName: getSourceName(source),
      pdfBase64: bytesToBase64(bytes),
      target,
    }),
  })

  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new Error(message || `Server conversion failed with status ${response.status}.`)
  }

  onProgress?.({ percent: 95, label: 'Downloading result' })
  const blob = await response.blob()
  const contentDisposition = response.headers.get('content-disposition') ?? ''
  const fileNameMatch = contentDisposition.match(/filename=\"?([^\";]+)\"?/i)

  return {
    fileName: fileNameMatch?.[1] ?? getOutputFileName(source, target),
    blob,
    engine: 'server' as const,
  }
}

function createProgressReporter(
  onProgress: ((progress: PdfConversionProgress) => void) | undefined,
  pageCount: number,
) {
  return (message: ScribeProgressMessage) => {
    if (!onProgress) return

    const pageNumber = typeof message.n === 'number' ? message.n + 1 : 1
    const totalPages = Math.max(1, pageCount)
    const pageRatio = Math.min(1, pageNumber / totalPages)
    const status = String(message.info?.status ?? '').toLowerCase()

    if (message.type === 'importPDF' || message.type === 'importImage') {
      onProgress({
        percent: 8 + Math.round(pageRatio * 12),
        label: 'Loading PDF',
        detail: `Importing page ${pageNumber} of ${totalPages}`,
      })
      return
    }

    if (message.type === 'recognize') {
      const detail = status.includes('sending')
        ? `Recognizing page ${pageNumber} of ${totalPages}`
        : status.includes('loading')
          ? `Preparing OCR for page ${pageNumber} of ${totalPages}`
          : `Processing page ${pageNumber} of ${totalPages}`

      onProgress({
        percent: 24 + Math.round(pageRatio * 54),
        label: 'Recognizing text',
        detail,
      })
      return
    }

    if (message.type === 'export') {
      onProgress({
        percent: 85 + Math.round(pageRatio * 10),
        label: 'Building output',
        detail: `Preparing file from page ${pageNumber} of ${totalPages}`,
      })
    }
  }
}

async function extractWithScribe(source: SelectedPdfSource, onProgress?: (progress: PdfConversionProgress) => void) {
  const scribe = await getScribe()
  const pdfFile = await loadPdfFile(source)
  const previousProgressHandler = scribe.opt.progressHandler
  const previousWarningHandler = scribe.opt.warningHandler
  const previousErrorHandler = scribe.opt.errorHandler

  try {
    onProgress?.({ percent: 5, label: 'Loading PDF' })
    await scribe.init({ pdf: true, ocr: true, font: true })

    scribe.opt.warningHandler = () => {}
    scribe.opt.errorHandler = () => {}

    onProgress?.({ percent: 14, label: 'Preparing document engine' })
    await scribe.importFiles([pdfFile])

    const pageCount = Number(scribe.inputData.pageCount ?? scribe.data?.ocr?.active?.length ?? 0)
    scribe.opt.progressHandler = createProgressReporter(onProgress, pageCount)
    onProgress?.({
      percent: 22,
      label: 'Analyzing document',
      detail: `${pageCount || 1} page${pageCount === 1 ? '' : 's'} detected`,
    })

    await scribe.recognize({ langs: ['eng'] })

    const activePages: Array<any> = Array.isArray(scribe.data?.ocr?.active) ? scribe.data.ocr.active : []
    const pages: ExtractedPdfPage[] = activePages.map((page, index) => {
      const pageNumber = Number(page?.n ?? index) + 1
      const pageText = scribe.utils.ocr.getPageText(page)
      const lines = pageText
        .split(/\r?\n/)
        .map((line: string) => normalizeText(line))
        .filter(Boolean)

      return {
        pageNumber,
        lines: lines.length > 0 ? lines : ['No extractable text found on this page.'],
      }
    })

    return {
      title: getSourceName(source),
      pages: pages.length > 0
        ? pages
        : [
            {
              pageNumber: 1,
              lines: ['No extractable text found on this PDF.'],
            },
          ],
    }
  } finally {
    scribe.opt.progressHandler = previousProgressHandler
    scribe.opt.warningHandler = previousWarningHandler
    scribe.opt.errorHandler = previousErrorHandler
    if (typeof scribe.clear === 'function') {
      scribe.clear()
    }
  }
}

export async function buildWordBlob(source: SelectedPdfSource, onProgress?: (progress: PdfConversionProgress) => void) {
  const scribe = await getScribe()
  const pdfFile = await loadPdfFile(source)
  const previousProgressHandler = scribe.opt.progressHandler
  try {
    scribe.opt.progressHandler = createProgressReporter(onProgress, 1)
    onProgress?.({ percent: 5, label: 'Loading PDF' })
    const resultBytes = await scribe.extractText([pdfFile], ['eng'], 'docx')
    onProgress?.({ percent: 100, label: 'Conversion complete' })

    return {
      fileName: getOutputFileName(source, 'word'),
      blob: new Blob([resultBytes], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    }
  } finally {
    scribe.opt.progressHandler = previousProgressHandler
  }
}

export async function buildExcelBlob(source: SelectedPdfSource, onProgress?: (progress: PdfConversionProgress) => void) {
  const scribe = await getScribe()
  const pdfFile = await loadPdfFile(source)
  const previousProgressHandler = scribe.opt.progressHandler
  try {
    scribe.opt.progressHandler = createProgressReporter(onProgress, 1)
    onProgress?.({ percent: 5, label: 'Loading PDF' })
    const resultBytes = await scribe.extractText([pdfFile], ['eng'], 'xlsx')
    onProgress?.({ percent: 100, label: 'Conversion complete' })

    return {
      fileName: getOutputFileName(source, 'excel'),
      blob: new Blob([resultBytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    }
  } finally {
    scribe.opt.progressHandler = previousProgressHandler
  }
}

export async function buildPowerPointBlob(source: SelectedPdfSource, onProgress?: (progress: PdfConversionProgress) => void) {
  const PptxGenJSModule = await import('pptxgenjs')
  const PptxGenJS = PptxGenJSModule.default
  const extracted = await extractWithScribe(source, onProgress)
  onProgress?.({ percent: 92, label: 'Building PowerPoint file' })
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'CloudNine ERP'
  pptx.company = 'CloudNine ERP'
  pptx.subject = 'PDF conversion output'
  pptx.title = extracted.title

  extracted.pages.forEach((page) => {
    const slide = pptx.addSlide()
    slide.background = { color: 'F8FAFC' }

    slide.addText(`Page ${page.pageNumber}`, {
      x: 0.6,
      y: 0.45,
      w: 12.2,
      h: 0.4,
      fontFace: 'Aptos',
      fontSize: 20,
      bold: true,
      color: '0F172A',
      margin: 0,
    })

    slide.addText(page.lines.join('\n'), {
      x: 0.7,
      y: 1,
      w: 12,
      h: 5.7,
      fontFace: 'Aptos',
      fontSize: 12,
      color: '334155',
      margin: 0,
      valign: 'top',
    })
  })

  const blob = await pptx.write({ outputType: 'blob' })

  if (!(blob instanceof Blob)) {
    throw new Error('PowerPoint export failed.')
  }

  const result = {
    fileName: getOutputFileName(source, 'powerpoint'),
    blob,
  }
  onProgress?.({ percent: 100, label: 'Conversion complete' })
  return result
}

export async function buildTextWordBlob(source: SelectedPdfSource, onProgress?: (progress: PdfConversionProgress) => void) {
  const { AlignmentType, Document, HeadingLevel, Paragraph, Packer, TextRun } = await import('docx')
  const extracted = await extractTextPdfPages(source, onProgress)
  onProgress?.({ percent: 92, label: 'Building Word file' })
  const children: DocxParagraph[] = []

  extracted.pages.forEach((page, pageIndex) => {
    if (pageIndex > 0) {
      children.push(new Paragraph({ pageBreakBefore: true }))
    }

    children.push(
      new Paragraph({
        text: `Page ${page.pageNumber}`,
        heading: HeadingLevel.HEADING_1,
      }),
    )

    page.lines.forEach((line) => {
      children.push(
        new Paragraph({
          alignment: AlignmentType.LEFT,
          children: [
            new TextRun({
              text: line,
            }),
          ],
        }),
      )
    })
  })

  const document = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  })

  const result = {
    fileName: getOutputFileName(source, 'word'),
    blob: await Packer.toBlob(document),
  }
  onProgress?.({ percent: 100, label: 'Conversion complete' })
  return result
}

export async function buildTextExcelBlob(source: SelectedPdfSource, onProgress?: (progress: PdfConversionProgress) => void) {
  const XLSX = await import('xlsx')
  const extracted = await extractTextPdfPages(source, onProgress)
  onProgress?.({ percent: 92, label: 'Building Excel file' })
  const rows: Array<[string | number, string | number, string]> = [['Page', 'Line', 'Text']]

  extracted.pages.forEach((page) => {
    page.lines.forEach((line, lineIndex) => {
      rows.push([page.pageNumber, lineIndex + 1, line])
    })
  })

  if (rows.length === 1) {
    rows.push([1, 1, 'No extractable text found on this PDF.'])
  }

  const workbook = XLSX.utils.book_new()
  const worksheet = XLSX.utils.aoa_to_sheet(rows)
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Extracted Text')

  const arrayBuffer = XLSX.write(workbook, {
    bookType: 'xlsx',
    compression: true,
    type: 'array',
  })

  const result = {
    fileName: getOutputFileName(source, 'excel'),
    blob: new Blob([arrayBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
  }
  onProgress?.({ percent: 100, label: 'Conversion complete' })
  return result
}

export async function buildTextPowerPointBlob(source: SelectedPdfSource, onProgress?: (progress: PdfConversionProgress) => void) {
  const PptxGenJSModule = await import('pptxgenjs')
  const PptxGenJS = PptxGenJSModule.default
  const extracted = await extractTextPdfPages(source, onProgress)
  onProgress?.({ percent: 92, label: 'Building PowerPoint file' })
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'CloudNine ERP'
  pptx.company = 'CloudNine ERP'
  pptx.subject = 'PDF conversion output'
  pptx.title = extracted.title

  extracted.pages.forEach((page) => {
    const slide = pptx.addSlide()
    slide.background = { color: 'F8FAFC' }

    slide.addText(`Page ${page.pageNumber}`, {
      x: 0.6,
      y: 0.45,
      w: 12.2,
      h: 0.4,
      fontFace: 'Aptos',
      fontSize: 20,
      bold: true,
      color: '0F172A',
      margin: 0,
    })

    slide.addText(page.lines.join('\n'), {
      x: 0.7,
      y: 1,
      w: 12,
      h: 5.7,
      fontFace: 'Aptos',
      fontSize: 12,
      color: '334155',
      margin: 0,
      valign: 'top',
    })
  })

  const blob = await pptx.write({ outputType: 'blob' })

  if (!(blob instanceof Blob)) {
    throw new Error('PowerPoint export failed.')
  }

  const result = {
    fileName: getOutputFileName(source, 'powerpoint'),
    blob,
  }
  onProgress?.({ percent: 100, label: 'Conversion complete' })
  return result
}

export async function convertWithLegacyEngine(
  source: SelectedPdfSource,
  target: PdfConversionTarget,
  onProgress?: (progress: PdfConversionProgress) => void,
) {
  const legacyModule = await import('./pdf-converter')
  return await legacyModule.convertPdfSource(source, target, onProgress)
}

export async function convertPdfSource(
  source: SelectedPdfSource,
  target: PdfConversionTarget,
  onProgress?: (progress: PdfConversionProgress) => void,
): Promise<PdfConversionResult> {
  onProgress?.({ percent: 0, label: 'Starting conversion' })

  if (target === 'excel' || target === 'csv') {
    try {
      const result = await convertWithLegacyEngine(source, target, onProgress)
      onProgress?.({ percent: 100, label: 'Conversion complete' })
      return result
    } catch (localError) {
      console.warn('[pdf-converter-scribe] local spreadsheet conversion failed, trying server engine', localError)

      try {
        const result = await convertWithServerEngine(source, target, onProgress)
        onProgress?.({ percent: 100, label: 'Conversion complete' })
        return result
      } catch (serverError) {
        throw serverError
      }
    }
  }

  const result = await convertWithLegacyEngine(source, target, onProgress)
  onProgress?.({ percent: 100, label: 'Conversion complete' })
  return result
}
