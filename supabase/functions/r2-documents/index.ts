import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from 'npm:@aws-sdk/client-s3'
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner'
import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-file-name, x-content-type, x-upload-kind',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
}

const bucket = Deno.env.get('R2_BUCKET') ?? 'contas'
const endpoint = Deno.env.get('R2_S3_ENDPOINT')
const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID')
const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY')
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!

function getS3Client() {
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    return null
  }

  return new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  })
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

function log(level: 'log' | 'error', event: string, details: Record<string, unknown> = {}) {
  console[level](JSON.stringify({ event, ...details }))
}

function sanitizeFileName(fileName: string) {
  return fileName.toLowerCase().replace(/[^a-z0-9.\-_]/g, '-')
}

function fileExtension(fileName: string, fallbackType: string) {
  const ext = fileName.split('.').pop()?.toLowerCase()
  if (ext && ext.length <= 10) return ext
  if (fallbackType === 'image/png') return 'png'
  if (fallbackType === 'image/webp') return 'webp'
  if (fallbackType === 'image/gif') return 'gif'
  if (fallbackType === 'image/jpeg') return 'jpg'
  if (fallbackType === 'image/jpg') return 'jpg'
  if (fallbackType === 'image/svg+xml') return 'svg'
  if (fallbackType === 'application/pdf') return 'pdf'
  if (fallbackType === 'application/msword') return 'doc'
  if (fallbackType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx'
  if (fallbackType === 'application/vnd.ms-powerpoint') return 'ppt'
  if (fallbackType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return 'pptx'
  if (fallbackType === 'application/vnd.ms-excel') return 'xls'
  if (fallbackType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx'
  if (fallbackType === 'application/rtf') return 'rtf'
  if (fallbackType === 'text/plain') return 'txt'
  if (fallbackType === 'text/csv') return 'csv'
  return 'bin'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const authorization = req.headers.get('Authorization') ?? ''
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i)
  const accessToken = tokenMatch?.[1]?.trim() ?? ''

  if (!accessToken) {
    log('error', 'auth_missing_bearer', {
      method: req.method,
      hasAuthorizationHeader: Boolean(authorization),
    })
    return json({ error: 'Missing bearer token.' }, 401)
  }

  const requestApiKey = req.headers.get('apikey')?.trim()
  const supabaseKey = requestApiKey || supabaseAnonKey
  if (!supabaseKey) {
    log('error', 'auth_missing_supabase_key', {
      method: req.method,
      hasRequestApiKey: Boolean(requestApiKey),
      hasEnvAnonKey: Boolean(supabaseAnonKey),
    })
    return json({ error: 'Missing Supabase API key for auth validation.' }, 500)
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  })

  const { data, error: authError } = await supabase.auth.getUser(accessToken)
  const user = data.user

  if (authError || !user) {
    log('error', 'auth_invalid_token', {
      method: req.method,
      message: authError?.message ?? 'No user returned from Supabase auth.',
    })
    return json({ error: authError?.message ?? 'Unauthorized' }, 401)
  }

  const s3 = getS3Client()
  if (!s3) {
    log('error', 'r2_missing_credentials', {
      hasEndpoint: Boolean(endpoint),
      hasAccessKeyId: Boolean(accessKeyId),
      hasSecretAccessKey: Boolean(secretAccessKey),
      bucket,
    })
    return json({ error: 'R2 credentials are missing for the r2-documents function.' }, 500)
  }

  if (req.method === 'GET') {
    const key = new URL(req.url).searchParams.get('key')
    if (!key) return json({ error: 'Missing key.' }, 400)
    if (!key.startsWith('documents/')) {
      return json({ error: 'Forbidden' }, 403)
    }

    try {
      const url = await getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
        { expiresIn: 60 * 60 * 24 * 7 },
      )

      return json({ url })
    } catch (error) {
      log('error', 'file_url_sign_failed', {
        userId: user.id,
        key,
        message: error instanceof Error ? error.message : String(error),
      })
      return json({ error: error instanceof Error ? error.message : 'Failed to sign file URL.' }, 500)
    }
  }

  if (req.method === 'DELETE') {
    const key = new URL(req.url).searchParams.get('key')
    if (!key) return json({ error: 'Missing key.' }, 400)
    if (!key.startsWith('documents/')) {
      return json({ error: 'Forbidden' }, 403)
    }

    try {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      )

      return json({ deleted: true })
    } catch (error) {
      log('error', 'file_delete_failed', {
        userId: user.id,
        key,
        bucket,
        endpoint,
        message: error instanceof Error ? error.message : String(error),
      })
      return json({ error: error instanceof Error ? error.message : 'Failed to delete file from R2.' }, 500)
    }
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405)
  }

  const contentType = req.headers.get('x-content-type') ?? 'application/octet-stream'
  const rawFileName = decodeURIComponent(req.headers.get('x-file-name') ?? 'document')
  const safeFileName = sanitizeFileName(rawFileName)
  const ext = fileExtension(safeFileName, contentType)
  const key = `documents/${user.id}/${crypto.randomUUID()}.${ext}`
  const body = new Uint8Array(await req.arrayBuffer())

  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
        Metadata: {
          original_name: safeFileName,
          uploaded_by: user.id,
        },
      }),
    )
  } catch (error) {
    log('error', 'file_upload_failed', {
      userId: user.id,
      key,
      bucket,
      endpoint,
      contentType,
      size: body.byteLength,
      message: error instanceof Error ? error.message : String(error),
    })
    return json({ error: error instanceof Error ? error.message : 'Failed to upload file to R2.' }, 500)
  }

  try {
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
      { expiresIn: 60 * 60 * 24 * 7 },
    )

    return json({ bucket, key, url }, 201)
  } catch (error) {
    log('error', 'file_sign_after_upload_failed', {
      userId: user.id,
      key,
      message: error instanceof Error ? error.message : String(error),
    })
    return json({ error: error instanceof Error ? error.message : 'File uploaded but signing URL failed.' }, 500)
  }
})
