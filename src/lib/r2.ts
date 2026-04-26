import { supabase } from '@/lib/supabase'

type UploadAvatarResult = {
  bucket: string
  key: string
  url: string
}
type UploadVoiceResult = {
  bucket: string
  key: string
  url: string
}
type UploadChatAttachmentResult = {
  bucket: string
  key: string
  url: string
}
type UploadChatVoiceResult = {
  bucket: string
  key: string
  url: string
}
type UploadDriveDocumentResult = {
  bucket: string
  key: string
  url: string
}
type DeleteDriveObjectResult = {
  deleted: boolean
}

type UploadProgressCallback = (progress: number) => void

function getFunctionsBaseUrl(
  functionName: 'r2-avatar' | 'r2-chat-attachments' | 'r2-voice-comments' | 'r2-chat-voice-messages' | 'r2-documents' = 'r2-avatar',
) {
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${functionName}`
}

function getSupabaseAnonKey() {
  return import.meta.env.VITE_SUPABASE_ANON_KEY
}

async function getAuthHeaders(accessToken?: string | null) {
  const buildHeaders = (token: string) => ({
    Authorization: `Bearer ${token}`,
    apikey: getSupabaseAnonKey(),
  })

  let {
    data: { session },
  } = await supabase.auth.getSession()

  if (session?.access_token) {
    const { data, error } = await supabase.auth.getUser(session.access_token)
    if (!error && data.user) {
      return buildHeaders(session.access_token)
    }
  }

  if (accessToken) {
    const { data, error } = await supabase.auth.getUser(accessToken)
    if (!error && data.user) {
      return buildHeaders(accessToken)
    }
  }

  const refreshResult = await supabase.auth.refreshSession()
  session = refreshResult.data.session

  if (session?.access_token) {
    const { data, error } = await supabase.auth.getUser(session.access_token)
    if (!error && data.user) {
      return buildHeaders(session.access_token)
    }
  }

  if (!session?.access_token) {
    throw new Error('Your session is no longer valid. Sign in again before uploading images.')
  }

  return buildHeaders(session.access_token)
}

function networkErrorMessage(
  action: 'upload' | 'resolve' | 'delete',
  kind: 'avatar' | 'voice' | 'chat' | 'chatVoice' | 'document' = 'avatar',
) {
  if (action === 'upload') {
    if (kind === 'voice') {
      return 'Voice upload could not reach the Supabase function. Deploy the r2-voice-comments Edge Function and verify its R2 secrets.'
    }
    if (kind === 'chat') {
      return 'Chat attachment upload could not reach the Supabase function. Deploy the r2-chat-attachments Edge Function and verify its R2 secrets.'
    }
    if (kind === 'chatVoice') {
      return 'Chat voice upload could not reach the Supabase function. Deploy the r2-chat-voice-messages Edge Function and verify its R2 secrets.'
    }
    if (kind === 'document') {
      return 'Document upload could not reach the Supabase function. Deploy the r2-documents Edge Function and verify its R2 secrets.'
    }
    return 'Avatar upload could not reach the Supabase function. Deploy the r2-avatar Edge Function and verify its R2 secrets.'
  }

  if (action === 'delete') {
    if (kind === 'document') {
      return 'Document delete could not reach the Supabase function. Deploy the r2-documents Edge Function and verify its R2 secrets.'
    }
    return 'File delete could not reach the Supabase function.'
  }

  if (kind === 'voice') return 'Voice URL could not be resolved because the Supabase function is unavailable.'
  if (kind === 'chat') return 'Chat attachment URL could not be resolved because the Supabase function is unavailable.'
  if (kind === 'chatVoice') return 'Chat voice URL could not be resolved because the Supabase function is unavailable.'
  if (kind === 'document') return 'Document URL could not be resolved because the Supabase function is unavailable.'
  return 'Avatar URL could not be resolved because the Supabase function is unavailable.'
}

async function uploadFileToR2<T>(
  file: File,
  uploadKind: 'avatar' | 'voice' | 'chat' | 'chatVoice' | 'document',
  fallbackType: string,
  accessToken?: string | null,
  functionNameOverride?: 'r2-avatar' | 'r2-chat-attachments' | 'r2-voice-comments' | 'r2-chat-voice-messages' | 'r2-documents',
  onProgress?: UploadProgressCallback,
) {
  const functionName =
    functionNameOverride ??
    (uploadKind === 'chat'
      ? 'r2-chat-attachments'
      : uploadKind === 'voice'
        ? 'r2-voice-comments'
        : uploadKind === 'chatVoice'
        ? 'r2-chat-voice-messages'
          : uploadKind === 'document'
            ? 'r2-documents'
            : 'r2-avatar')
  const headers = await getAuthHeaders(accessToken)
  const performRequest = async (requestHeaders: Record<string, string>) =>
    new Promise<T>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', getFunctionsBaseUrl(functionName))

      for (const [key, value] of Object.entries(requestHeaders)) {
        xhr.setRequestHeader(key, value)
      }

      xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name))
      xhr.setRequestHeader('x-content-type', file.type || fallbackType)
      xhr.setRequestHeader('x-upload-kind', uploadKind)

      xhr.upload.onprogress = (event) => {
        if (!onProgress) return
        if (!event.lengthComputable || event.total <= 0) {
          onProgress(0)
          return
        }
        onProgress(Math.min(100, Math.max(0, (event.loaded / event.total) * 100)))
      }

      xhr.onerror = () => {
        reject(new Error(networkErrorMessage('upload', uploadKind)))
      }

      xhr.onload = () => {
        const raw = xhr.responseText || ''
        let payload: (T & { error?: string }) | null = null

        try {
          payload = raw ? (JSON.parse(raw) as T & { error?: string }) : null
        } catch {
          payload = null
        }

        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(payload?.error || xhr.statusText || `${uploadKind} upload failed.`))
          return
        }

        if (!payload) {
          reject(new Error(`${uploadKind} upload failed.`))
          return
        }

        resolve(payload)
      }

      xhr.send(file)
    })

  try {
    return await performRequest(headers)
  } catch (error) {
    const shouldRetry =
      error instanceof Error &&
      /401|Unauthorized|invalid session|session is no longer valid/i.test(error.message)

    if (!shouldRetry) {
      throw error
    }

    const retryHeaders = await getAuthHeaders(null)
    return await performRequest(retryHeaders)
  }
}

export async function uploadAvatarToR2(file: File): Promise<UploadAvatarResult> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Only image uploads are allowed for avatar uploads.')
  }
  return uploadFileToR2<UploadAvatarResult>(file, 'avatar', 'image/png')
}

export async function uploadTaskCommentVoiceToR2(file: File): Promise<UploadVoiceResult> {
  return uploadFileToR2<UploadVoiceResult>(file, 'voice', 'audio/webm', undefined, 'r2-voice-comments')
}

export async function uploadVoiceToR2(file: File): Promise<UploadVoiceResult> {
  return uploadTaskCommentVoiceToR2(file)
}

export async function uploadChatVoiceToR2(file: File, accessToken?: string | null): Promise<UploadChatVoiceResult> {
  return uploadFileToR2<UploadChatVoiceResult>(file, 'chatVoice', 'audio/webm', accessToken)
}

export async function uploadChatAttachmentToR2(file: File, accessToken?: string | null): Promise<UploadChatAttachmentResult> {
  return uploadFileToR2<UploadChatAttachmentResult>(file, 'chat', 'application/octet-stream', accessToken)
}

export async function uploadDriveDocumentToR2(
  file: File,
  accessToken?: string | null,
  onProgress?: UploadProgressCallback,
): Promise<UploadDriveDocumentResult> {
  return uploadFileToR2<UploadDriveDocumentResult>(file, 'document', 'application/octet-stream', accessToken, 'r2-documents', onProgress)
}

export async function deleteDriveDocumentFromR2(key: string, accessToken?: string | null): Promise<DeleteDriveObjectResult> {
  if (!key || key.startsWith('data:') || key.startsWith('http://') || key.startsWith('https://') || !key.startsWith('documents/')) {
    throw new Error('Invalid R2 key.')
  }

  const headers = await getAuthHeaders(accessToken)
  const functionName = 'r2-documents'

  const performRequest = async (requestHeaders: Record<string, string>) => {
    let response: Response

    try {
      response = await fetch(`${getFunctionsBaseUrl(functionName)}?key=${encodeURIComponent(key)}`, {
        method: 'DELETE',
        headers: requestHeaders,
      })
    } catch {
      throw new Error(networkErrorMessage('delete', 'document'))
    }

    if (!response.ok) {
      const message = await response.text()
      throw new Error(message || 'Could not delete file.')
    }

    return (await response.json()) as DeleteDriveObjectResult
  }

  try {
    return await performRequest(headers)
  } catch (error) {
    const shouldRetry =
      error instanceof Error &&
      /401|Unauthorized|invalid session|session is no longer valid/i.test(error.message)

    if (!shouldRetry) {
      throw error
    }

    const retryHeaders = await getAuthHeaders(null)
    return await performRequest(retryHeaders)
  }
}

export async function resolveR2ObjectUrl(key: string): Promise<string> {
  if (!key || key.startsWith('data:') || key.startsWith('http://') || key.startsWith('https://')) {
    throw new Error('Invalid R2 key.')
  }

  const headers = await getAuthHeaders()
  let response: Response

  try {
    const functionName = key.startsWith('chat-attachments/')
      ? 'r2-chat-attachments'
      : key.startsWith('chat-voice-messages/')
        ? 'r2-chat-voice-messages'
        : key.startsWith('documents/')
          ? 'r2-documents'
        : key.startsWith('voice-comments/')
          ? 'r2-voice-comments'
          : 'r2-avatar'

    response = await fetch(`${getFunctionsBaseUrl(functionName)}?key=${encodeURIComponent(key)}`, {
      method: 'GET',
      headers,
    })
  } catch {
    const kind = key.startsWith('chat-attachments/')
      ? 'chat'
      : key.startsWith('chat-voice-messages/')
        ? 'chatVoice'
        : key.startsWith('documents/')
          ? 'document'
        : key.startsWith('voice-comments/')
          ? 'voice'
          : 'avatar'
    throw new Error(networkErrorMessage('resolve', kind))
  }

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || 'Could not resolve file URL.')
  }

  const data = (await response.json()) as { url: string }
  return data.url
}

export async function resolveAvatarUrl(key: string): Promise<string> {
  return resolveR2ObjectUrl(key)
}

function stripImageExtension(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '')
}

function isOptimizableImage(file: File) {
  if (!file.type.startsWith('image/')) return false
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return false
  return true
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()
    image.decoding = 'async'

    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(image)
    }

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Could not decode image.'))
    }

    image.src = objectUrl
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Could not optimize image.'))
        return
      }
      resolve(blob)
    }, type, quality)
  })
}

export async function optimizeImageFileForUpload(
  file: File,
  options?: {
    maxDimension?: number
    quality?: number
  },
): Promise<File> {
  if (!isOptimizableImage(file)) return file

  const maxDimension = options?.maxDimension ?? 1600
  const quality = options?.quality ?? 0.82
  const image = await loadImage(file)
  const largestEdge = Math.max(image.naturalWidth, image.naturalHeight)
  if (!largestEdge) return file

  const shouldResize = largestEdge > maxDimension
  const shouldReencode = shouldResize || file.size > 1_500_000
  if (!shouldReencode) return file

  const scale = shouldResize ? maxDimension / largestEdge : 1
  const targetWidth = Math.max(1, Math.round(image.naturalWidth * scale))
  const targetHeight = Math.max(1, Math.round(image.naturalHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight

  const context = canvas.getContext('2d')
  if (!context) return file

  context.drawImage(image, 0, 0, targetWidth, targetHeight)

  const blob = await canvasToBlob(canvas, 'image/webp', quality)
  const optimizedName = `${stripImageExtension(file.name)}.webp`
  return new File([blob], optimizedName, {
    type: 'image/webp',
    lastModified: file.lastModified,
  })
}
