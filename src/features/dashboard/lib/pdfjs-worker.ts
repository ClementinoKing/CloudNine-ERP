import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'

let workerPortPromise: Promise<Worker> | null = null

export async function ensurePdfJsWorkerPort() {
  if (typeof window === 'undefined') {
    return null
  }

  if (workerPortPromise) {
    return await workerPortPromise
  }

  workerPortPromise = (async () => {
    const { default: workerSource } = await import('pdfjs-dist/legacy/build/pdf.worker.mjs?raw')
    const workerBlob = new Blob([workerSource], { type: 'text/javascript' })
    const workerUrl = URL.createObjectURL(workerBlob)
    const worker = new Worker(workerUrl, { type: 'module' })

    GlobalWorkerOptions.workerPort = worker
    return worker
  })().catch((error) => {
    workerPortPromise = null
    throw error
  })

  return await workerPortPromise
}
