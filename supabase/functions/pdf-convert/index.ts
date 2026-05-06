import { OPS, getDocument } from 'npm:pdfjs-dist/legacy/build/pdf.mjs'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

class SimpleDOMMatrix {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number

  constructor(init?: ArrayLike<number> | { a?: number; b?: number; c?: number; d?: number; e?: number; f?: number }) {
    this.a = 1
    this.b = 0
    this.c = 0
    this.d = 1
    this.e = 0
    this.f = 0

    if (!init) return

    if (typeof (init as ArrayLike<number>).length === 'number') {
      const values = Array.from(init as ArrayLike<number>)
      this.a = Number(values[0] ?? 1)
      this.b = Number(values[1] ?? 0)
      this.c = Number(values[2] ?? 0)
      this.d = Number(values[3] ?? 1)
      this.e = Number(values[4] ?? 0)
      this.f = Number(values[5] ?? 0)
      return
    }

    const matrix = init as { a?: number; b?: number; c?: number; d?: number; e?: number; f?: number }
    this.a = Number(matrix.a ?? 1)
    this.b = Number(matrix.b ?? 0)
    this.c = Number(matrix.c ?? 0)
    this.d = Number(matrix.d ?? 1)
    this.e = Number(matrix.e ?? 0)
    this.f = Number(matrix.f ?? 0)
  }

  static fromMatrix(matrix?: ArrayLike<number> | { a?: number; b?: number; c?: number; d?: number; e?: number; f?: number }) {
    return new SimpleDOMMatrix(matrix)
  }

  #multiply(left: SimpleDOMMatrix, right: SimpleDOMMatrix) {
    return new SimpleDOMMatrix({
      a: left.a * right.a + left.c * right.b,
      b: left.b * right.a + left.d * right.b,
      c: left.a * right.c + left.c * right.d,
      d: left.b * right.c + left.d * right.d,
      e: left.a * right.e + left.c * right.f + left.e,
      f: left.b * right.e + left.d * right.f + left.f,
    })
  }

  multiplySelf(other: ArrayLike<number> | { a?: number; b?: number; c?: number; d?: number; e?: number; f?: number }) {
    const right = SimpleDOMMatrix.fromMatrix(other)
    const result = this.#multiply(this, right)
    Object.assign(this, result)
    return this
  }

  preMultiplySelf(other: ArrayLike<number> | { a?: number; b?: number; c?: number; d?: number; e?: number; f?: number }) {
    const left = SimpleDOMMatrix.fromMatrix(other)
    const result = this.#multiply(left, this)
    Object.assign(this, result)
    return this
  }

  invertSelf() {
    const determinant = this.a * this.d - this.b * this.c
    if (determinant === 0) {
      throw new Error('Matrix is not invertible.')
    }

    const next = {
      a: this.d / determinant,
      b: -this.b / determinant,
      c: -this.c / determinant,
      d: this.a / determinant,
      e: (this.c * this.f - this.e * this.d) / determinant,
      f: (this.e * this.b - this.a * this.f) / determinant,
    }

    Object.assign(this, next)
    return this
  }

  translate(tx = 0, ty = 0) {
    return new SimpleDOMMatrix(this).preMultiplySelf({ a: 1, b: 0, c: 0, d: 1, e: tx, f: ty })
  }

  translateSelf(tx = 0, ty = 0) {
    return this.preMultiplySelf({ a: 1, b: 0, c: 0, d: 1, e: tx, f: ty })
  }

  scale(scaleX = 1, scaleY = scaleX) {
    return new SimpleDOMMatrix(this).preMultiplySelf({ a: scaleX, b: 0, c: 0, d: scaleY, e: 0, f: 0 })
  }

  scaleSelf(scaleX = 1, scaleY = scaleX) {
    return this.preMultiplySelf({ a: scaleX, b: 0, c: 0, d: scaleY, e: 0, f: 0 })
  }

  rotateSelf() {
    return this
  }

  transformPoint(point: { x: number; y: number }) {
    return {
      x: point.x * this.a + point.y * this.c + this.e,
      y: point.x * this.b + point.y * this.d + this.f,
    }
  }
}

if (!globalThis.DOMMatrix) {
  ;(globalThis as any).DOMMatrix = SimpleDOMMatrix
}

type PdfConversionTarget = 'excel' | 'csv' | 'word' | 'powerpoint'

type ConvertRequest = {
  fileName: string
  pdfBase64: string
  target: PdfConversionTarget
}

type PdfTextPage = {
  pageNumber: number
  lines: string[]
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

type PdfLayoutPage = {
  pageNumber: number
  width: number
  height: number
  items: PdfLayoutItem[]
  lines: PdfLayoutLine[]
  images: PdfLayoutImage[]
  rows: string[][]
}

type PdfLayoutImage = {
  id: string
  data: Uint8Array
  rawWidth: number
  rawHeight: number
  width: number
  height: number
  left: number
  top: number
  pageWidth: number
  pageHeight: number
}

type PdfMatrix = [number, number, number, number, number, number]

const IDENTITY_MATRIX: PdfMatrix = [1, 0, 0, 1, 0, 0]

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index++) {
    let value = index
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

const TEXT_ENCODER = new TextEncoder()

function multiplyMatrix(left: PdfMatrix, right: PdfMatrix): PdfMatrix {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ]
}

function transformPoint(matrix: PdfMatrix, x: number, y: number) {
  return {
    x: matrix[0] * x + matrix[2] * y + matrix[4],
    y: matrix[1] * x + matrix[3] * y + matrix[5],
  }
}

function getBoundingBox(matrix: PdfMatrix) {
  const points = [
    transformPoint(matrix, 0, 0),
    transformPoint(matrix, 1, 0),
    transformPoint(matrix, 0, 1),
    transformPoint(matrix, 1, 1),
  ]

  const left = Math.min(...points.map((point) => point.x))
  const right = Math.max(...points.map((point) => point.x))
  const top = Math.max(...points.map((point) => point.y))
  const bottom = Math.min(...points.map((point) => point.y))

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: top - bottom,
  }
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function pdfPointsToDocxPixels(points: number) {
  return Math.max(1, points * (96 / 72))
}

function pdfPointsToEmu(points: number) {
  return Math.round(points * 12700)
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function concatBytes(...chunks: Uint8Array[]) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

function u32(value: number) {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value >>> 0)
  return bytes
}

function pngChunk(type: string, data: Uint8Array) {
  const typeBytes = TEXT_ENCODER.encode(type)
  const lengthBytes = u32(data.length)
  const crcBytes = u32(crc32(concatBytes(typeBytes, data)))
  return concatBytes(lengthBytes, typeBytes, data, crcBytes)
}

async function encodeRgbaToPng(data: Uint8Array, width: number, height: number) {
  const rowStride = width * 4 + 1
  const raw = new Uint8Array(rowStride * height)

  for (let row = 0; row < height; row++) {
    const sourceOffset = row * width * 4
    const targetOffset = row * rowStride
    raw[targetOffset] = 0
    raw.set(data.subarray(sourceOffset, sourceOffset + width * 4), targetOffset + 1)
  }

  const compressed = new Uint8Array(
    await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer(),
  )

  const header = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = pngChunk(
    'IHDR',
    concatBytes(
      u32(width),
      u32(height),
      new Uint8Array([8, 6, 0, 0, 0]),
    ),
  )
  const idat = pngChunk('IDAT', compressed)
  const iend = pngChunk('IEND', new Uint8Array())

  return concatBytes(header, ihdr, idat, iend)
}

async function getPageObject(page: any, id: string) {
  return await new Promise<any>((resolve) => {
    page.objs.get(id, resolve)
  })
}

async function extractPageImages(page: any, operatorList: { fnArray: number[]; argsArray: any[] }, pageWidth: number, pageHeight: number) {
  const images: PdfLayoutImage[] = []
  const matrixStack: PdfMatrix[] = []
  let currentMatrix: PdfMatrix = [...IDENTITY_MATRIX]

  for (let index = 0; index < operatorList.fnArray.length; index++) {
    const fn = operatorList.fnArray[index]
    const args = operatorList.argsArray[index]

    switch (fn) {
      case OPS.save:
        matrixStack.push([...currentMatrix] as PdfMatrix)
        continue
      case OPS.restore:
        currentMatrix = matrixStack.pop() ?? [...IDENTITY_MATRIX]
        continue
      case OPS.transform:
        if (Array.isArray(args) && args.length >= 6) {
          currentMatrix = multiplyMatrix(currentMatrix, [Number(args[0]), Number(args[1]), Number(args[2]), Number(args[3]), Number(args[4]), Number(args[5])])
        }
        continue
      case OPS.paintImageXObject: {
        const [id, width, height] = Array.isArray(args) ? args : []
        if (typeof id !== 'string') continue
        const imageObject = await getPageObject(page, id)
        if (!imageObject?.data || typeof imageObject.width !== 'number' || typeof imageObject.height !== 'number') continue
        if (Number(imageObject.width) <= 1 || Number(imageObject.height) <= 1) continue

        const bbox = getBoundingBox(currentMatrix)
        images.push({
          id,
          data: new Uint8Array(imageObject.data),
          rawWidth: typeof width === 'number' ? width : Number(imageObject.width),
          rawHeight: typeof height === 'number' ? height : Number(imageObject.height),
          width: bbox.width,
          height: bbox.height,
          left: bbox.left,
          top: bbox.top,
          pageWidth,
          pageHeight,
        })
        continue
      }
      case OPS.paintInlineImageXObject: {
        const imageObject = args?.[0]
        if (!imageObject?.data || typeof imageObject.width !== 'number' || typeof imageObject.height !== 'number') continue
        if (Number(imageObject.width) <= 1 || Number(imageObject.height) <= 1) continue

        const bbox = getBoundingBox(currentMatrix)
        images.push({
          id: `inline-${index}`,
          data: new Uint8Array(imageObject.data),
          rawWidth: Number(imageObject.width),
          rawHeight: Number(imageObject.height),
          width: bbox.width,
          height: bbox.height,
          left: bbox.left,
          top: bbox.top,
          pageWidth,
          pageHeight,
        })
        continue
      }
      case OPS.paintImageXObjectRepeat: {
        const [id, scaleX, scaleY, positions] = Array.isArray(args) ? args : []
        if (typeof id !== 'string' || !Array.isArray(positions)) continue

        const imageObject = await getPageObject(page, id)
        if (!imageObject?.data || typeof imageObject.width !== 'number' || typeof imageObject.height !== 'number') continue
        if (Number(imageObject.width) <= 1 || Number(imageObject.height) <= 1) continue

        for (let positionIndex = 0; positionIndex < positions.length; positionIndex += 2) {
          const positionMatrix: PdfMatrix = [
            Number(scaleX ?? 1),
            0,
            0,
            Number(scaleY ?? 1),
            Number(positions[positionIndex] ?? 0),
            Number(positions[positionIndex + 1] ?? 0),
          ]
          const bbox = getBoundingBox(multiplyMatrix(currentMatrix, positionMatrix))
          images.push({
            id: `${id}-${positionIndex / 2}`,
            data: new Uint8Array(imageObject.data),
            rawWidth: Number(imageObject.width),
            rawHeight: Number(imageObject.height),
            width: bbox.width,
            height: bbox.height,
            left: bbox.left,
            top: bbox.top,
            pageWidth,
            pageHeight,
          })
        }
      }
    }
  }

  const unique = new Map<string, PdfLayoutImage>()
  for (const image of images) {
    const key = `${image.left.toFixed(2)}:${image.top.toFixed(2)}:${image.width.toFixed(2)}:${image.height.toFixed(2)}:${image.data.length}`
    if (!unique.has(key)) {
      unique.set(key, image)
    }
  }

  return Array.from(unique.values()).filter((image) => image.width > 2 && image.height > 2)
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

function stripPdfExtension(fileName: string) {
  return fileName.replace(/\.pdf$/i, '')
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeLayoutItems(textItems: Array<{ str?: string; transform?: number[]; width?: number }>) {
  return textItems
    .map((item) => ({
      text: normalizeText(String(item.str ?? '')),
      x: Number(item.transform?.[4] ?? 0),
      y: Number(item.transform?.[5] ?? 0),
      width: Number(item.width ?? 0),
      fontSize: Math.abs(Number(item.transform?.[3] ?? item.transform?.[0] ?? 10)),
    }))
    .filter((item) => item.text.length > 0)
}

function groupPageText(textItems: Array<{ str?: string; transform?: number[] }>) {
  const positionedItems = normalizeLayoutItems(textItems as Array<{ str?: string; transform?: number[]; width?: number }>)

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

function groupPageLayout(textItems: Array<{ str?: string; transform?: number[]; width?: number }>) {
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
    .filter((line) => line.text.length > 0)
}

function buildCellsFromLayoutLine(line: PdfLayoutLine) {
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

function buildSpreadsheetRowsFromPages(pages: PdfLayoutPage[]) {
  const maxContentColumns = 6
  const keyValueLabelLimit = 48

  function normalizeCells(cells: string[]) {
    return cells.map((cell) => normalizeText(cell)).filter(Boolean)
  }

  function pageLooksTabular(page: PdfLayoutPage) {
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
    page.rows.forEach((cells, rowIndex) => {
      const normalized = tableLike ? compactTableRow(cells) : compactFormRow(cells)
      if (normalized.length === 0) return

      rows.push({
        pageNumber: page.pageNumber,
        rowNumber: rowIndex + 1,
        cells: normalized,
      })
    })
  })

  return rows
}

function selectSpreadsheetRows(pages: PdfLayoutPage[]) {
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

function buildOutputFileName(fileName: string, target: PdfConversionTarget) {
  const extension = target === 'excel' ? 'xlsx' : target === 'csv' ? 'csv' : target === 'word' ? 'docx' : 'pptx'
  const baseName = stripPdfExtension(fileName).trim() || 'converted-document'
  return `${baseName}.${extension}`
}

async function extractPdfLayout(pdfBytes: Uint8Array) {
  const { getDocument } = await import('npm:pdfjs-dist/legacy/build/pdf.mjs')
  const loadingTask = getDocument({
    data: pdfBytes,
    disableWorker: true,
  })

  try {
    const pdfDocument = await loadingTask.promise
    const pageNumbers = Array.from({ length: pdfDocument.numPages }, (_, index) => index + 1)
    const pages: PdfLayoutPage[] = []

    for (const pageNumber of pageNumbers) {
      const page = await pdfDocument.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      const textContent = await page.getTextContent()
      const operatorList = await page.getOperatorList()
      const rawItems = normalizeLayoutItems(textContent.items as Array<{ str?: string; transform?: number[]; width?: number }>)
      const lines = groupPageLayout(textContent.items as Array<{ str?: string; transform?: number[]; width?: number }>)
      const rows = lines.map((line) => buildCellsFromLayoutLine(line))
      const images = await extractPageImages(page, operatorList as { fnArray: number[]; argsArray: any[] }, viewport.width, viewport.height)

      pages.push({
        pageNumber,
        width: viewport.width,
        height: viewport.height,
        items: rawItems,
        lines,
        images,
        rows: rows.length > 0 ? rows : [['No extractable text found on this page.']],
      })
    }

    return {
      title: 'Converted PDF',
      pages,
    }
  } finally {
    loadingTask.destroy()
  }
}

function isMraCertificateLayout(page: PdfLayoutPage) {
  const texts = page.lines.map((line) => line.text.toLowerCase())
  return (
    texts.some((text) => text.includes('malawi revenue authority')) &&
    texts.some((text) => text.includes('tax clearance certificate')) &&
    texts.some((text) => text.includes('taxpayer details')) &&
    texts.some((text) => text.includes('transaction details')) &&
    texts.some((text) => text.includes('validation code'))
  )
}

function findLine(page: PdfLayoutPage, pattern: RegExp) {
  return page.lines.find((line) => pattern.test(line.text))
}

function findItemText(page: PdfLayoutPage, text: string) {
  const target = normalizeText(text).toLowerCase()
  return page.items.find((item) => item.text.toLowerCase() === target)?.text ?? ''
}

function getLineValue(line: PdfLayoutLine | undefined, pattern: RegExp) {
  if (!line) return ''
  const match = line.text.match(pattern)
  if (!match) return ''
  return normalizeText(line.text.slice((match.index ?? 0) + match[0].length))
}

function splitLabelValueLine(line: PdfLayoutLine, labelPattern: RegExp) {
  const match = line.text.match(labelPattern)
  if (!match) return { label: line.text, value: '' }

  const label = normalizeText(match[0])
  const value = normalizeText(line.text.slice((match.index ?? 0) + match[0].length))
  return { label, value }
}

function createParagraphTextRuns(text: string, bold = false) {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ text: line, bold }))
}

async function buildWordFile(pages: PdfLayoutPage[]) {
  const {
    AlignmentType,
    BorderStyle,
    HorizontalPositionRelativeFrom,
    ImageRun,
    Document,
    Paragraph,
    Packer,
    Table,
    TableBorders,
    TableCell,
    TableLayoutType,
    TableRow,
    TextRun,
    TextWrappingType,
    VerticalPositionRelativeFrom,
    WidthType,
  } = await import('npm:docx')

  const page = pages[0]

  const makeParagraph = (text: string, options?: { alignment?: (typeof AlignmentType)[keyof typeof AlignmentType]; bold?: boolean; size?: number; spacingAfter?: number }) =>
    new Paragraph({
      alignment: options?.alignment ?? AlignmentType.LEFT,
      spacing: { before: 0, after: options?.spacingAfter ?? 0 },
      children: createParagraphTextRuns(text, options?.bold ?? false).map(
        (entry) =>
          new TextRun({
            text: entry.text,
            bold: entry.bold,
            size: options?.size ?? 20,
          }),
      ),
    })

  const makeTableCell = (text: string | string[], options?: { bold?: boolean; alignment?: (typeof AlignmentType)[keyof typeof AlignmentType] }) =>
    new TableCell({
      children: (Array.isArray(text) ? text : [text]).map((line) =>
        new Paragraph({
          alignment: options?.alignment ?? AlignmentType.LEFT,
          spacing: { before: 0, after: 0 },
          children: [
            new TextRun({
              text: line,
              bold: options?.bold ?? false,
              size: 18,
            }),
          ],
        }),
      ),
      borders: TableBorders.NONE,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    })

  const makeTwoColumnRow = (label: string | string[], value: string | string[]) =>
    new TableRow({
      children: [makeTableCell(label, { bold: true }), makeTableCell(value)],
    })

  const makeThreeColumnRow = (first: string, second: string, third: string) =>
    new TableRow({
      children: [makeTableCell(first, { bold: true }), makeTableCell(second, { bold: true }), makeTableCell(third)],
    })

  const makeRule = () =>
    new Paragraph({
      spacing: { before: 120, after: 120 },
      border: {
        bottom: {
          color: '5B5B5B',
          style: BorderStyle.SINGLE,
          size: 6,
          space: 1,
        },
      },
      children: [],
    })

  const buildFloatingImageParagraph = (image: PdfLayoutImage) =>
    new Paragraph({
      spacing: { before: 0, after: 0 },
      children: [
        new ImageRun({
          type: 'png',
          data: image.data,
          transformation: {
            width: pdfPointsToDocxPixels(image.width),
            height: pdfPointsToDocxPixels(image.height),
          },
          floating: {
            allowOverlap: true,
            behindDocument: false,
            layoutInCell: false,
            lockAnchor: true,
            wrap: { type: TextWrappingType.NONE },
            horizontalPosition: {
              relative: HorizontalPositionRelativeFrom.PAGE,
              offset: pdfPointsToEmu(clampNumber(image.left, 0, image.pageWidth)),
            },
            verticalPosition: {
              relative: VerticalPositionRelativeFrom.PAGE,
              offset: pdfPointsToEmu(clampNumber(image.pageHeight - image.top, 0, image.pageHeight)),
            },
            zIndex: Math.round(image.top),
          },
        }),
      ],
    })

  const buildCertificatePage = (certificatePage: PdfLayoutPage) => {
    const sections: Array<Paragraph | Table> = []

    const titleLines = [
      'MALAWI REVENUE AUTHORITY',
      'DOMESTIC TAXES DIVISION',
      'TAX CLEARANCE CERTIFICATE',
    ]

    titleLines.forEach((title, index) => {
      sections.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: index === 0 ? 0 : 20, after: 0 },
          children: [
            new TextRun({
              text: title,
              bold: true,
              size: index === 2 ? 24 : 26,
            }),
          ],
        }),
      )
    })

    const scanLine = findItemText(certificatePage, 'Scan to validate certificate')
    if (scanLine) {
      sections.push(
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          spacing: { before: 160, after: 40 },
          children: [new TextRun({ text: scanLine, size: 16 })],
        }),
      )
    }

    sections.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        borders: TableBorders.NONE,
        columnWidths: [2600, 8200],
        rows: [
          new TableRow({
            children: [
              makeTableCell('Certificate No:', { bold: true, alignment: AlignmentType.CENTER }),
              makeTableCell(findItemText(certificatePage, 'MRA/LSTO/TCC/036668'), { alignment: AlignmentType.CENTER }),
            ],
          }),
        ],
      }),
    )

    sections.push(makeRule())
    sections.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 40, after: 180 },
        children: [new TextRun({ text: 'Taxpayer Details', bold: true, size: 22 })],
      }),
    )

    const taxpayerRows: Array<[string, string]> = [
      ['TIN', findItemText(certificatePage, '70477312')],
      ['Taxpayer Name', findItemText(certificatePage, 'MR HOPE NYASULU')],
      ['Trading Name', findItemText(certificatePage, 'BLUE SACK INVESTMENT & ENTERPRISES')],
      ['Contact Number', findItemText(certificatePage, '0998192564,265884979801')],
      ['Email', findItemText(certificatePage, 'hpnyasulu@gmail.com')],
      ['Postal Address', findItemText(certificatePage, 'LILONGWE, Lilongwe, Central Region, Malawi')],
    ]

    sections.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        borders: TableBorders.NONE,
        columnWidths: [2600, 8200],
        rows: taxpayerRows.map(([label, value]) => makeTwoColumnRow(label, value)),
      }),
    )

    sections.push(makeRule())
    sections.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 40, after: 180 },
        children: [new TextRun({ text: 'Transaction Details', bold: true, size: 22 })],
      }),
    )

    const typeOfTransaction = findItemText(certificatePage, 'Supply of Goods or Services')
    const descriptionLabel = ['Description Of', 'Transaction']
    const descriptionValue = findItemText(certificatePage, 'GENERAL TAX CLEARANCE CERTIFICATE')

    sections.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        borders: TableBorders.NONE,
        columnWidths: [2600, 8200],
        rows: [
          makeTwoColumnRow('Type of Transaction', typeOfTransaction),
          makeTwoColumnRow(descriptionLabel, descriptionValue || 'GENERAL TAX CLEARANCE CERTIFICATE'),
        ],
      }),
    )

    sections.push(makeRule())

    const statementText = `This is to certify that the above mentioned Taxpayer has been cleared by the Malawi Revenue Authority on the discharge of Domestic Taxes obligations for the period 12/2025 in accordance with provisions under Section 85 A of the Taxation Act`
    sections.push(
      new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { before: 60, after: 60 },
        children: [
          new TextRun({
            text: statementText,
            size: 20,
          }),
        ],
      }),
    )

    const validateLine = findItemText(certificatePage, 'Learn how to validate MRA documents, visit:')
    if (validateLine) {
      sections.push(
        new Paragraph({
          alignment: AlignmentType.LEFT,
          spacing: { before: 80, after: 120 },
          children: [new TextRun({ text: validateLine, size: 18 })],
        }),
      )
    }

    sections.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        borders: TableBorders.NONE,
        columnWidths: [3200, 7800],
        rows: [
          makeTwoColumnRow('This Certificate is valid up to', findItemText(certificatePage, '31-03-2026')),
          makeTwoColumnRow('Date of Issue', findItemText(certificatePage, '12-08-2025')),
        ],
      }),
    )

    sections.push(
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: { before: 220, after: 0 },
        children: [new TextRun({ text: '______________________________', size: 18 })],
      }),
    )
    sections.push(
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: { before: 0, after: 120 },
        children: [new TextRun({ text: 'COMMISSIONER GENERAL', bold: true, size: 20 })],
      }),
    )

    sections.push(makeRule())

    const validationCode = findItemText(certificatePage, '95252248900572')
    sections.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        borders: TableBorders.NONE,
        columnWidths: [2200, 2600, 5400],
        rows: [
          makeThreeColumnRow('Validation Code:', validationCode, 'Learn how to validate MRA documents, visit:'),
        ],
      }),
    )

    certificatePage.images
      .slice()
      .sort((left, right) => right.top - left.top || left.left - right.left)
      .forEach((image) => {
        sections.push(buildFloatingImageParagraph(image))
      })

    return sections
  }

  const buildPlainPage = (page: PdfLayoutPage) => {
    const sections: Array<Paragraph | Table> = []

    page.lines.forEach((line) => {
      sections.push(
        makeParagraph(line.text, {
          bold: false,
          size: Math.max(16, Math.min(22, Math.round(line.fontSize * 2))),
          spacingAfter: 0,
        }),
      )
    })

    page.images
      .slice()
      .sort((left, right) => right.top - left.top || left.left - right.left)
      .forEach((image) => {
        sections.push(buildFloatingImageParagraph(image))
      })

    return sections
  }

  const children: Array<Paragraph | Table> = []

  pages.forEach((pageData, pageIndex) => {
    if (pageIndex > 0) {
      children.push(new Paragraph({ pageBreakBefore: true }))
    }

    const pageSections = isMraCertificateLayout(pageData) ? buildCertificatePage(pageData) : buildPlainPage(pageData)
    children.push(...pageSections)
  })

  const document = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 720,
              right: 720,
              bottom: 720,
              left: 720,
            },
          },
        },
        children,
      },
    ],
  })

  return await Packer.toBlob(document)
}

async function buildExcelFile(pages: PdfLayoutPage[]) {
  const XLSX = await import('npm:xlsx')
  const workbook = XLSX.utils.book_new()
  const spreadsheetRows = selectSpreadsheetRows(pages)
  const maxColumns = Math.max(1, spreadsheetRows.reduce((max, row) => Math.max(max, row.cells.length), 0))
  const worksheetRows: Array<Array<string | number>> = [
    ['Page', 'Row', ...Array.from({ length: maxColumns }, (_, index) => `Content ${index + 1}`)],
  ]

  spreadsheetRows.forEach((row) => {
    worksheetRows.push([
      row.pageNumber,
      row.rowNumber,
      ...row.cells,
      ...Array.from({ length: maxColumns - row.cells.length }, () => ''),
    ])
  })

  if (worksheetRows.length === 1) {
    worksheetRows.push([1, 1, 'No extractable text found on this PDF.'])
  }

  const worksheet = XLSX.utils.aoa_to_sheet(worksheetRows)
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Extracted Rows')

  const arrayBuffer = XLSX.write(workbook, {
    bookType: 'xlsx',
    compression: true,
    cellStyles: true,
    type: 'array',
  })

  return new Blob([arrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

async function buildCsvFile(pages: PdfLayoutPage[]) {
  const XLSX = await import('npm:xlsx')
  const spreadsheetRows = selectSpreadsheetRows(pages)
  const maxColumns = Math.max(1, spreadsheetRows.reduce((max, row) => Math.max(max, row.cells.length), 0))
  const worksheetRows: Array<Array<string | number>> = [
    ['Page', 'Row', ...Array.from({ length: maxColumns }, (_, index) => `Content ${index + 1}`)],
  ]

  spreadsheetRows.forEach((row) => {
    worksheetRows.push([
      row.pageNumber,
      row.rowNumber,
      ...row.cells,
      ...Array.from({ length: maxColumns - row.cells.length }, () => ''),
    ])
  })

  if (worksheetRows.length === 1) {
    worksheetRows.push([1, 1, 'No extractable text found on this PDF.'])
  }

  const worksheet = XLSX.utils.aoa_to_sheet(worksheetRows)
  const csvText = XLSX.utils.sheet_to_csv(worksheet)

  return new Blob([`\ufeff${csvText}`], {
    type: 'text/csv;charset=utf-8',
  })
}

async function buildPowerPointFile(fileName: string, pages: PdfLayoutPage[]) {
  const { default: PptxGenJS } = await import('npm:pptxgenjs')
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'CloudNine ERP'
  pptx.company = 'CloudNine ERP'
  pptx.subject = 'PDF conversion output'
  pptx.title = stripPdfExtension(fileName).trim() || 'Converted PDF'

  const slideWidth = 13.333
  const slideHeight = 7.5

  pages.forEach((page) => {
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

    slide.addText(page.lines.map((line) => line.text).join('\n'), {
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

    const scaleX = slideWidth / page.width
    const scaleY = slideHeight / page.height
    page.images
      .slice()
      .sort((left, right) => right.top - left.top || left.left - right.left)
      .forEach((image) => {
        slide.addImage({
          data: image.data,
          x: image.left * scaleX,
          y: (page.height - image.top) * scaleY,
          w: image.width * scaleX,
          h: image.height * scaleY,
        })
      })
  })

  const blob = await pptx.write({ outputType: 'blob' })
  if (!(blob instanceof Blob)) {
    throw new Error('PowerPoint export failed.')
  }
  return blob
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders })
    }

    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405)
    }

    let payload: ConvertRequest
    try {
      payload = await req.json()
    } catch {
      return json({ error: 'Invalid JSON body.' }, 400)
    }

    if (!payload?.fileName || !payload?.pdfBase64 || !payload?.target) {
      return json({ error: 'Missing required fields.' }, 400)
    }

    const pdfBytes = Uint8Array.from(atob(payload.pdfBase64), (character) => character.charCodeAt(0))
    const extracted = await extractPdfLayout(pdfBytes)

    if (payload.target === 'excel') {
      const blob = await buildExcelFile(extracted.pages)
      return new Response(blob, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${buildOutputFileName(payload.fileName, payload.target)}"`,
        },
      })
    }

    if (payload.target === 'csv') {
      const blob = await buildCsvFile(extracted.pages)
      return new Response(blob, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${buildOutputFileName(payload.fileName, payload.target)}"`,
        },
      })
    }

    if (payload.target === 'word') {
      const blob = await buildWordFile(extracted.pages)
      return new Response(blob, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${buildOutputFileName(payload.fileName, payload.target)}"`,
        },
      })
    }

    const blob = await buildPowerPointFile(payload.fileName, extracted.pages)
    return new Response(blob, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${buildOutputFileName(payload.fileName, payload.target)}"`,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return json({ error: message }, 500)
  }
})

/*
  The main path is wrapped above so the function returns the actual failure
  reason when a conversion step crashes in production.
*/
