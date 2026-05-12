import { S3Client, PutObjectCommand, GetObjectCommand } from 'npm:@aws-sdk/client-s3'
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner'
import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-file-name, x-content-type, x-upload-kind',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const bucket = Deno.env.get('R2_BUCKET') ?? 'cloudnine-erp'
const endpoint = Deno.env.get('R2_S3_ENDPOINT')
const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID')
const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY')
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
const endpointAccountId = endpoint ? new URL(endpoint).hostname.split('.')[0] : null

function getS3Client() {
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    return null
  }

  return new S3Client({
    region: 'auto',
    endpoint,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
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
  if (fallbackType === 'audio/mpeg') return 'mp3'
  if (fallbackType === 'audio/mp4') return 'm4a'
  if (fallbackType === 'audio/ogg') return 'ogg'
  if (fallbackType === 'audio/wav') return 'wav'
  if (fallbackType === 'audio/webm') return 'webm'
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
    return json({ error: 'R2 credentials are missing for the r2-voice-comments function.' }, 500)
  }

  if (endpointAccountId && accessKeyId && accessKeyId === endpointAccountId) {
    return json(
      {
        error:
          'R2_ACCESS_KEY_ID is not valid. Use the Access Key ID from a Cloudflare R2 API token, not the account ID from the endpoint.',
      },
      500,
    )
  }

  if (req.method === 'GET') {
    const key = new URL(req.url).searchParams.get('key')
    if (!key) return json({ error: 'Missing key.' }, 400)
    if (!key.startsWith('voice-comments/')) {
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

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405)
  }

  const contentType = req.headers.get('x-content-type') ?? 'audio/webm'
  if (!contentType.startsWith('audio/')) {
    return json({ error: 'Only audio uploads are allowed for voice uploads.' }, 400)
  }

  const rawFileName = decodeURIComponent(req.headers.get('x-file-name') ?? 'voice')
  const safeFileName = sanitizeFileName(rawFileName)
  const ext = fileExtension(safeFileName, contentType)
  const key = `voice-comments/${user.id}/${crypto.randomUUID()}.${ext}`

  try {
    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
      }),
      { expiresIn: 60 * 15 },
    )

    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
      { expiresIn: 60 * 60 * 24 * 7 },
    )

    return json({ bucket, key, url, uploadUrl }, 201)
  } catch (error) {
    log('error', 'file_upload_failed', {
      userId: user.id,
      key,
      bucket,
      endpoint,
      contentType,
      message: error instanceof Error ? error.message : String(error),
    })
    return json({ error: error instanceof Error ? error.message : 'Failed to upload file to R2.' }, 500)
  }
})
