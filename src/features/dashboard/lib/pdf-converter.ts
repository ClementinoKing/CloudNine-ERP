import { resolveR2ObjectUrl } from '@/lib/r2'
import type { PDFPageProxy } from 'pdfjs-dist'

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
  rows: string[][]
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

function getOutputFileName(source: SelectedPdfSource, target: PdfConversionTarget) {
  const sourceName = source.kind === 'drive' ? source.document.name : source.file.name
  const baseName = stripPdfExtension(sourceName).trim() || 'converted-document'
  const extension = target === 'excel' ? 'xlsx' : target === 'csv' ? 'csv' : target === 'word' ? 'docx' : 'pptx'
  return `${baseName}.${extension}`
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function debugConverter(step: string, detail?: Record<string, unknown>) {
  if (import.meta.env.PROD) return
  console.log(`[pdf-converter] ${step}`, detail ?? '')
}

const PDFJS_STANDARD_FONT_DATA_URL = `${import.meta.env.BASE_URL}pdfjs/standard_fonts/`
const TESSERACT_WORKER_PATH = `${import.meta.env.BASE_URL}tesseract/worker.min.js`
const TESSERACT_CORE_PATH = `${import.meta.env.BASE_URL}tesseract/core`
const TESSERACT_LANG_PATH = `${import.meta.env.BASE_URL}tesseract/lang-data/eng/4.0.0_best_int`

type PdfTextItem = {
  str: string
  transform: number[]
  width?: number
}

function isTextItem(item: unknown): item is PdfTextItem {
  return (
    typeof item === 'object' &&
    item !== null &&
    'str' in item &&
    typeof (item as { str?: unknown }).str === 'string' &&
    'transform' in item &&
    Array.isArray((item as { transform?: unknown }).transform)
  )
}

type PdfLayoutItem = {
  text: string
  x: number
  y: number
  width: number
  fontSize: number
}

type PdfLayoutLine = {
  text: string
  items: PdfLayoutItem[]
  y: number
  left: number
  right: number
  fontSize: number
}

function normalizeLayoutItems(textItems: PdfTextItem[]) {
  return textItems
    .map((item) => ({
      text: normalizeText(item.str),
      x: Number(item.transform?.[4] ?? 0),
      y: Number(item.transform?.[5] ?? 0),
      width: Number(item.width ?? 0),
      fontSize: Math.abs(Number(item.transform?.[3] ?? item.transform?.[0] ?? 10)),
    }))
    .filter((item) => item.text.length > 0)
}

function groupPageLayout(textItems: PdfTextItem[]) {
  const positionedItems = normalizeLayoutItems(textItems)

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
    .map((line) => {
      const items = line.items.sort((left, right) => left.x - right.x)
      const left = items[0]?.x ?? 0
      const right = items.reduce((max, item) => Math.max(max, item.x + item.width), left)
      const fontSize = items.reduce((max, item) => Math.max(max, item.fontSize), 0)
      return {
        text: items.map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim(),
        items,
        y: line.y,
        left,
        right,
        fontSize,
      }
    })
    .filter((line): line is PdfLayoutLine => line.text.length > 0)
}

function buildCellsFromLine(line: PdfLayoutLine) {
  const cells: string[] = []
  const cellEnds: number[] = []
  const threshold = Math.max(18, line.fontSize * 1.5)

  for (const item of line.items) {
    const cellText = item.text.replace(/\s+/g, ' ').trim()
    if (!cellText) continue

    const cellEnd = item.x + Math.max(item.width, 1)
    const lastIndex = cells.length - 1

    if (lastIndex < 0) {
      cells.push(cellText)
      cellEnds.push(cellEnd)
      continue
    }

    const gap = item.x - cellEnds[lastIndex]
    if (gap > threshold) {
      cells.push(cellText)
      cellEnds.push(cellEnd)
      continue
    }

    cells[lastIndex] = `${cells[lastIndex]} ${cellText}`.replace(/\s+/g, ' ').trim()
    cellEnds[lastIndex] = Math.max(cellEnds[lastIndex], cellEnd)
  }

  return cells.filter(Boolean)
}

function buildSpreadsheetRowsFromPages(pages: ExtractedPdfPage[]) {
  const maxContentColumns = 6
  const keyValueLabelLimit = 48

  function normalizeCells(cells: string[]) {
    return cells.map((cell) => normalizeText(cell)).filter(Boolean)
  }

  function pageLooksTabular(page: ExtractedPdfPage) {
    const rows = page.rows.map(normalizeCells).filter((row) => row.length > 0)

    if (rows.length === 0) return false

    const wideRows = rows.filter((row) => row.length >= 3).length
    const dataRows = rows.filter((row) => {
      const text = row.join(' ')
      return /(?:\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{1,3}(?:,\d{3})*(?:\.\d{2})\b)/.test(text)
    }).length

    return wideRows >= 2 || dataRows >= 3 || (wideRows >= 1 && dataRows >= 2)
  }

  function compactFormRow(cells: string[]) {
    const normalized = normalizeCells(cells)
    if (normalized.length <= 1) return normalized

    const [first, ...rest] = normalized
    const remainder = rest.join(' ').trim()

    if (!remainder) return [first]

    if (first.length <= keyValueLabelLimit) {
      return [first.replace(/:\s*$/, ''), remainder]
    }

    return [normalized.join(' ')]
  }

  function compactTableRow(cells: string[]) {
    const normalized = normalizeCells(cells)

    if (normalized.length <= maxContentColumns) return normalized

    return [
      ...normalized.slice(0, maxContentColumns - 1),
      normalized.slice(maxContentColumns - 1).join(' '),
    ]
  }

  const rows: Array<{ pageNumber: number; rowNumber: number; cells: string[] }> = []

  pages.forEach((page) => {
    const tableLike = pageLooksTabular(page)
    page.rows.forEach((cells, index) => {
      const normalized = tableLike ? compactTableRow(cells) : compactFormRow(cells)
      if (normalized.length === 0) return

      rows.push({
        pageNumber: page.pageNumber,
        rowNumber: index + 1,
        cells: normalized,
      })
    })
  })

  return rows
}

function selectSpreadsheetRows(pages: ExtractedPdfPage[]) {
  const rows = buildSpreadsheetRowsFromPages(pages)
  if (rows.length === 0) return rows

  const frequency = new Map<number, number>()
  rows.forEach((row) => {
    const count = row.cells.length
    frequency.set(count, (frequency.get(count) ?? 0) + 1)
  })

  const dominantEntry = Array.from(frequency.entries()).sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1]
    return right[0] - left[0]
  })[0]

  const dominantColumnCount = dominantEntry?.[0] ?? 1
  const dominantShare = (dominantEntry?.[1] ?? 0) / rows.length
  const tableLike = dominantColumnCount >= 4 && dominantShare >= 0.25

  if (!tableLike) {
    return rows
  }

  const filteredRows = rows.filter((row) => row.cells.length >= Math.max(2, dominantColumnCount - 1))
  return filteredRows.length > 0 ? filteredRows : rows
}

async function loadPdfBytes(source: SelectedPdfSource) {
  debugConverter('loadPdfBytes:start', {
    source: source.kind,
    name: source.kind === 'drive' ? source.document.name : source.file.name,
  })
  if (source.kind === 'local') {
    const bytes = new Uint8Array(await source.file.arrayBuffer())
    debugConverter('loadPdfBytes:end', { byteLength: bytes.byteLength })
    return bytes
  }

  const objectUrl = await resolveR2ObjectUrl(source.document.storagePath)
  const response = await fetch(objectUrl)
  if (!response.ok) {
    throw new Error(`Could not load "${source.document.name}" from My Drive.`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  debugConverter('loadPdfBytes:end', { byteLength: bytes.byteLength })
  return bytes
}

let ocrWorkerPromise: Promise<import('tesseract.js').Worker> | null = null
let ocrProgressReporter: ((progress: PdfConversionProgress) => void) | null = null

async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      const { createWorker } = await import('tesseract.js')
      const worker = await createWorker('eng', 1, {
        workerPath: TESSERACT_WORKER_PATH,
        corePath: TESSERACT_CORE_PATH,
        langPath: TESSERACT_LANG_PATH,
        logger: (message) => {
          const baseProgress = typeof message.progress === 'number' ? Math.max(0, Math.min(1, message.progress)) : 0
          const percent = 72 + Math.round(baseProgress * 28)
          const status = message.status.toLowerCase()
          let label = 'OCR fallback'

          if (status.includes('loading tesseract core')) {
            label = 'Loading OCR engine'
          } else if (status.includes('loading') && status.includes('traineddata')) {
            label = 'Loading OCR language'
          } else if (status.includes('initializing')) {
            label = 'Initializing OCR'
          } else if (status.includes('recognizing')) {
            label = 'Recognizing text'
          } else if (status.includes('loading language')) {
            label = 'Loading OCR language'
          }

          ocrProgressReporter?.({
            percent,
            label,
            detail: message.status,
          })
        },
      })
      await worker.setParameters({
        preserve_interword_spaces: '1',
        user_defined_dpi: '220',
      })
      return worker
    })().catch((error) => {
      ocrWorkerPromise = null
      throw error
    })
  }

  return await ocrWorkerPromise
}

async function ocrPageText(page: PDFPageProxy, pageNumber: number, totalPages: number, onProgress?: (progress: PdfConversionProgress) => void) {
  onProgress?.({
    percent: 72 + Math.round((pageNumber / totalPages) * 10),
    label: 'OCR fallback',
    detail: `Rendering scanned page ${pageNumber} of ${totalPages}`,
  })

  const viewport = page.getViewport({ scale: 1.75 })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const context = canvas.getContext('2d', { alpha: false })

  if (!context) {
    throw new Error('OCR fallback could not create a canvas.')
  }

  await page.render({ canvasContext: context, canvas, viewport }).promise

  onProgress?.({
    percent: 82 + Math.round((pageNumber / totalPages) * 8),
    label: 'OCR fallback',
    detail: `Reading scanned page ${pageNumber} of ${totalPages}`,
  })

  const worker = await getOcrWorker()
  const result = await worker.recognize(canvas)
  const text = result.data.text ?? ''
  return text
    .split(/\r?\n/)
    .map((line) => normalizeText(line))
  .filter(Boolean)
}

async function extractPdfPages(source: SelectedPdfSource, onProgress?: (progress: PdfConversionProgress) => void) {
  debugConverter('extractPdfPages:start', {
    source: source.kind,
    name: source.kind === 'drive' ? source.document.name : source.file.name,
  })
  const data = await loadPdfBytes(source)
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdfjs/pdf.worker.mjs`
  onProgress?.({ percent: 5, label: 'Loading PDF' })
  const loadingTask = getDocument({
    data,
    standardFontDataUrl: PDFJS_STANDARD_FONT_DATA_URL,
  })
  ocrProgressReporter = onProgress ?? null

  try {
    const pdfDocument = await loadingTask.promise
    const pageNumbers = Array.from({ length: pdfDocument.numPages }, (_, index) => index + 1)
    const pages: ExtractedPdfPage[] = []
    let usedOcrFallback = false
    debugConverter('extractPdfPages:loaded', { pageCount: pageNumbers.length })

    for (const pageNumber of pageNumbers) {
      const pageStartedAt = Date.now()
      onProgress?.({
        percent: 10 + Math.round(((pageNumber - 1) / pageNumbers.length) * 70),
        label: 'Extracting text',
        detail: `Reading page ${pageNumber} of ${pageNumbers.length}`,
      })

      const page = await pdfDocument.getPage(pageNumber)
      const textContent = await page.getTextContent()
      const lineLayouts = groupPageLayout((textContent.items as unknown[]).filter(isTextItem))
      const lines = lineLayouts.map((line) => line.text)
      const rows = lineLayouts.map((line) => buildCellsFromLine(line))

      if (lines.length === 0) {
        const ocrLines = await ocrPageText(page, pageNumber, pageNumbers.length, onProgress)
        usedOcrFallback = true
        pages.push({
          pageNumber,
          lines: ocrLines.length > 0 ? ocrLines : ['No extractable text found on this page.'],
          rows: ocrLines.length > 0 ? ocrLines.map((line) => [line]) : [['No extractable text found on this page.']],
        })
        onProgress?.({
          percent: 10 + Math.round((pageNumber / pageNumbers.length) * 70),
          label: 'OCR fallback',
          detail: `${pageNumber} of ${pageNumbers.length} pages complete`,
        })
        continue
      }

      pages.push({
        pageNumber,
        lines: lines.length > 0 ? lines : ['No extractable text found on this page.'],
        rows: rows.length > 0 ? rows : [['No extractable text found on this page.']],
      })
      debugConverter('extractPdfPages:pageComplete', {
        pageNumber,
        lineCount: lines.length,
        rowCount: rows.length,
        elapsedMs: Date.now() - pageStartedAt,
      })

      onProgress?.({
        percent: 10 + Math.round((pageNumber / pageNumbers.length) * 70),
        label: 'Extracting text',
        detail: `${pageNumber} of ${pageNumbers.length} pages complete`,
      })
    }

    return {
      title: source.kind === 'drive' ? source.document.name : source.file.name,
      pages,
      usedOcrFallback,
    }
  } finally {
    ocrProgressReporter = null
    loadingTask.destroy()
  }
}

async function buildWordBlob(source: SelectedPdfSource, onProgress?: (progress: PdfConversionProgress) => void) {
  const { AlignmentType, Document, HeadingLevel, Paragraph, Packer, TextRun } = await import('docx')
  const extracted = await extractPdfPages(source, onProgress)
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
    engine: extracted.usedOcrFallback ? ('local-ocr' as const) : ('local-text' as const),
  }
  onProgress?.({ percent: 100, label: 'Conversion complete' })
  return result
}

async function buildExcelBlob(source: SelectedPdfSource, onProgress?: (progress: PdfConversionProgress) => void) {
  const XLSX = await import('xlsx')
  const extracted = await extractPdfPages(source, onProgress)
  onProgress?.({ percent: 92, label: 'Building Excel file' })
  debugConverter('buildExcelBlob:buildRows', {
    pageCount: extracted.pages.length,
    rowCount: extracted.pages.reduce((count, page) => count + page.rows.length, 0),
  })
  const spreadsheetRows = selectSpreadsheetRows(extracted.pages)
  const maxColumns = Math.max(1, spreadsheetRows.reduce((max, row) => Math.max(max, row.cells.length), 0))
  const rows: Array<Array<string | number>> = [
    ['Page', 'Row', ...Array.from({ length: maxColumns }, (_, index) => `Content ${index + 1}`)],
  ]

  spreadsheetRows.forEach((row) => {
    rows.push([
      row.pageNumber,
      row.rowNumber,
      ...row.cells,
      ...Array.from({ length: maxColumns - row.cells.length }, () => ''),
    ])
  })

  if (rows.length === 1) {
    rows.push([1, 1, 'No extractable text found on this PDF.'])
  }

  const workbook = XLSX.utils.book_new()
  const worksheet = XLSX.utils.aoa_to_sheet(rows)
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Extracted Text')

  const writeStartedAt = Date.now()
  const arrayBuffer = XLSX.write(workbook, {
    bookType: 'xlsx',
    compression: true,
    type: 'array',
  })
  debugConverter('buildExcelBlob:writeComplete', {
    elapsedMs: Date.now() - writeStartedAt,
    byteLength: arrayBuffer.byteLength,
  })

  const result = {
    fileName: getOutputFileName(source, 'excel'),
    blob: new Blob([arrayBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    engine: extracted.usedOcrFallback ? ('local-ocr' as const) : ('local-text' as const),
  }
  onProgress?.({ percent: 100, label: 'Conversion complete' })
  return result
}

async function buildCsvBlob(source: SelectedPdfSource, onProgress?: (progress: PdfConversionProgress) => void) {
  const XLSX = await import('xlsx')
  const extracted = await extractPdfPages(source, onProgress)
  onProgress?.({ percent: 92, label: 'Building CSV file' })
  const spreadsheetRows = selectSpreadsheetRows(extracted.pages)
  const maxColumns = Math.max(1, spreadsheetRows.reduce((max, row) => Math.max(max, row.cells.length), 0))
  const rows: Array<Array<string | number>> = [
    ['Page', 'Row', ...Array.from({ length: maxColumns }, (_, index) => `Content ${index + 1}`)],
  ]

  spreadsheetRows.forEach((row) => {
    rows.push([
      row.pageNumber,
      row.rowNumber,
      ...row.cells,
      ...Array.from({ length: maxColumns - row.cells.length }, () => ''),
    ])
  })

  if (rows.length === 1) {
    rows.push([1, 1, 'No extractable text found on this PDF.'])
  }

  const worksheet = XLSX.utils.aoa_to_sheet(rows)
  const csvText = XLSX.utils.sheet_to_csv(worksheet)

  const result = {
    fileName: getOutputFileName(source, 'csv'),
    blob: new Blob([`\ufeff${csvText}`], {
      type: 'text/csv;charset=utf-8',
    }),
    engine: extracted.usedOcrFallback ? ('local-ocr' as const) : ('local-text' as const),
  }
  onProgress?.({ percent: 100, label: 'Conversion complete' })
  return result
}

async function buildPowerPointBlob(source: SelectedPdfSource, onProgress?: (progress: PdfConversionProgress) => void) {
  const PptxGenJSModule = await import('pptxgenjs')
  const PptxGenJS = PptxGenJSModule.default
  const extracted = await extractPdfPages(source, onProgress)
  onProgress?.({ percent: 92, label: 'Building PowerPoint file' })
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Spryar Tech'
  pptx.company = 'Spryar Tech'
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

    slide.addText(
      page.lines.join('\n'),
      {
        x: 0.7,
        y: 1.0,
        w: 12.0,
        h: 5.7,
        fontFace: 'Aptos',
        fontSize: 12,
        color: '334155',
        margin: 0,
        valign: 'top',
      },
    )
  })

  const blob = await pptx.write({ outputType: 'blob' })

  if (!(blob instanceof Blob)) {
    throw new Error('PowerPoint export failed.')
  }

  const result = {
    fileName: getOutputFileName(source, 'powerpoint'),
    blob,
    engine: extracted.usedOcrFallback ? ('local-ocr' as const) : ('local-text' as const),
  }
  onProgress?.({ percent: 100, label: 'Conversion complete' })
  return result
}

export async function convertPdfSource(
  source: SelectedPdfSource,
  target: PdfConversionTarget,
  onProgress?: (progress: PdfConversionProgress) => void,
): Promise<PdfConversionResult> {
  onProgress?.({ percent: 0, label: 'Starting conversion' })

  if (target === 'excel') return await buildExcelBlob(source, onProgress)
  if (target === 'csv') return await buildCsvBlob(source, onProgress)
  if (target === 'word') return await buildWordBlob(source, onProgress)
  return await buildPowerPointBlob(source, onProgress)
}
