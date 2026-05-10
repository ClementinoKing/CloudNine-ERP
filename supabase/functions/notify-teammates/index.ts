import { createClient } from 'npm:@supabase/supabase-js'
import {
  notificationSubject,
  renderNotificationEmail,
  sendResendEmail as sendBrandedResendEmail,
  type NotificationContextKind,
  type NotificationEmailType,
} from '../_shared/email.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type NotifyPayload = {
  type?: NotificationEmailType
  recipientEmail?: string
  recipientId?: string
  taskId?: string
  taskTitle?: string
  roomId?: string
  roomName?: string
  actorName?: string
  messagePreview?: string
  contextKind?: NotificationContextKind
  appUrl?: string
  notificationId: string
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const RESEND_FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') ?? ''
const APP_BASE_URL = Deno.env.get('APP_BASE_URL') ?? ''
const INTERNAL_EMAIL_DISPATCH_TOKEN = Deno.env.get('NOTIFICATION_EMAIL_DISPATCH_TOKEN') ?? Deno.env.get('TASK_REMINDER_DISPATCH_TOKEN') ?? ''
const FALLBACK_APP_BASE_URL = 'https://cloudninetech.co.za'

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
  return atob(`${normalized}${padding}`)
}

function requesterIdFromBearerToken(token: string) {
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    const payloadJson = decodeBase64Url(parts[1])
    const payload = JSON.parse(payloadJson) as { sub?: unknown }
    return typeof payload.sub === 'string' && payload.sub.length > 0 ? payload.sub : null
  } catch {
    return null
  }
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

async function sendNotificationEmail(input: {
  to: string
  type: NotificationEmailType
  contextKind: NotificationContextKind
  actorName: string
  contextName: string
  messagePreview?: string
  appUrl: string
}) {
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
    throw new Error('Missing RESEND_API_KEY or RESEND_FROM_EMAIL.')
  }

  return sendBrandedResendEmail({
    apiKey: RESEND_API_KEY,
    from: RESEND_FROM_EMAIL,
    to: input.to,
    subject: notificationSubject(input),
    html: renderNotificationEmail(input),
  })
}

function resolveBearerToken(req: Request) {
  const directAuthorization = req.headers.get('Authorization') ?? req.headers.get('authorization') ?? ''
  const forwardedAuthorization = req.headers.get('x-forwarded-authorization') ?? ''
  const candidate = directAuthorization || forwardedAuthorization
  if (!candidate) return ''
  const bearerMatch = candidate.match(/^Bearer\s+(.+)$/i)
  if (bearerMatch?.[1]) return bearerMatch[1].trim()
  return candidate.trim()
}

function isNotificationEmailType(value: unknown): value is NotificationEmailType {
  return value === 'mention' || value === 'task_assigned'
}

function emailTypeFromMetadata(metadata: Record<string, unknown> | null | undefined): NotificationEmailType | null {
  const event = metadata?.event
  if (event === 'task_mentioned') return 'mention'
  if (event === 'task_assigned') return 'task_assigned'
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ ok: false, message: 'Method not allowed.' }, 405)
  }

  const accessToken = resolveBearerToken(req)

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok: false, message: 'Missing Supabase environment variables.' }, 500)
  }

  let payload: NotifyPayload
  try {
    payload = (await req.json()) as NotifyPayload
  } catch {
    return json({ ok: false, message: 'Invalid JSON payload.' }, 400)
  }

  if (!payload.notificationId) {
    return json({ ok: false, message: 'Missing required notification payload fields.' }, 400)
  }

  if (payload.type && !isNotificationEmailType(payload.type)) {
    return json({ ok: false, message: 'Unsupported notification email type.' }, 400)
  }

  const isInternalDispatch = Boolean(INTERNAL_EMAIL_DISPATCH_TOKEN && accessToken === INTERNAL_EMAIL_DISPATCH_TOKEN)

  const requesterId =
    requesterIdFromBearerToken(accessToken) ??
    req.headers.get('x-supabase-auth-user-id') ??
    req.headers.get('x-supabase-auth-user') ??
    null
  if (!isInternalDispatch && !requesterId) {
    return json({ ok: false, message: 'Unauthorized.' }, 401)
  }

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: notificationRow, error: notificationError } = await serviceClient
    .from('notifications')
    .select('id, actor_id, recipient_id, task_id, metadata')
    .eq('id', payload.notificationId)
    .maybeSingle()

  if (notificationError) {
    return json({ ok: false, message: notificationError.message }, 500)
  }

  if (!notificationRow) {
    return json({ ok: false, message: 'Notification not found.' }, 404)
  }

  if (!isInternalDispatch && notificationRow.actor_id !== requesterId) {
    return json({ ok: false, message: 'Only the actor can trigger this email.' }, 403)
  }

  const notificationMetadata = notificationRow.metadata as Record<string, unknown> | null
  const emailType = payload.type ?? emailTypeFromMetadata(notificationMetadata)
  if (!emailType) {
    return json({ ok: false, message: 'Unable to resolve notification email type.' }, 400)
  }

  const contextKind: NotificationContextKind = payload.contextKind ?? 'task'
  let taskTitle = payload.taskTitle
  let actorName = payload.actorName

  if (contextKind === 'task' && notificationRow.task_id && !taskTitle) {
    const { data: taskRow, error: taskError } = await serviceClient
      .from('tasks')
      .select('title')
      .eq('id', notificationRow.task_id)
      .maybeSingle()
    if (taskError) {
      return json({ ok: false, message: taskError.message }, 500)
    }
    taskTitle = taskRow?.title ?? undefined
  }

  if (!actorName && notificationRow.actor_id) {
    const { data: actorProfileRow } = await serviceClient
      .from('profiles')
      .select('full_name, email')
      .eq('id', notificationRow.actor_id)
      .maybeSingle()
    actorName = actorProfileRow?.full_name?.trim() || actorProfileRow?.email?.trim() || undefined
  }

  if (!actorName) {
    actorName = 'A teammate'
  }

  if (contextKind === 'task' && (!notificationRow.task_id || !taskTitle)) {
    return json({ ok: false, message: 'Missing task notification context.' }, 400)
  }

  if (contextKind === 'chat' && !payload.roomName) {
    return json({ ok: false, message: 'Missing chat notification context.' }, 400)
  }

  if (contextKind === 'task') {
    if (payload.taskId && notificationRow.task_id !== payload.taskId) {
      return json({ ok: false, message: 'Task mismatch for this notification.' }, 400)
    }
  } else {
    const roomId = payload.roomId ?? null
    const metadataRoomId = typeof notificationRow.metadata?.chat_room_id === 'string' ? notificationRow.metadata.chat_room_id : null
    if (roomId && metadataRoomId !== roomId) {
      return json({ ok: false, message: 'Chat room mismatch for this notification.' }, 400)
    }
  }

  const recipientId = payload.recipientId ?? notificationRow.recipient_id ?? undefined
  let recipientEmail = payload.recipientEmail?.trim().toLowerCase()

  if (!recipientEmail && recipientId) {
    const { data: profileRow } = await serviceClient
      .from('profiles')
      .select('email')
      .eq('id', recipientId)
      .maybeSingle()
    recipientEmail = profileRow?.email?.trim().toLowerCase()
  }

  if (!recipientEmail) {
    return json({ ok: false, message: 'Recipient email is missing.' }, 400)
  }

  const idempotencyType = emailType

  const { data: existingDelivery } = await serviceClient
    .from('notification_email_deliveries')
    .select('id, status')
    .eq('notification_id', payload.notificationId)
    .eq('recipient_email', recipientEmail)
    .eq('type', idempotencyType)
    .maybeSingle()

  if (existingDelivery?.status === 'sent') {
    return json({ ok: true, status: 'already_sent', deliveryId: existingDelivery.id })
  }

  const appBaseUrl = (APP_BASE_URL || FALLBACK_APP_BASE_URL).replace(/\/+$/, '')
  const appUrl =
    payload.appUrl ??
    (contextKind === 'chat'
      ? `${appBaseUrl}/dashboard/home?openGroupChat=1`
      : `${appBaseUrl}/dashboard/notifications?openTaskId=${encodeURIComponent(payload.taskId ?? notificationRow.task_id ?? '')}`)
  const contextName = contextKind === 'chat' ? payload.roomName ?? 'Group Chat' : taskTitle ?? 'a task'

  try {
    const sent = await sendNotificationEmail({
      to: recipientEmail,
      type: emailType,
      contextKind,
      actorName,
      contextName,
      messagePreview: payload.messagePreview,
      appUrl,
    })

    if (existingDelivery?.id) {
      await serviceClient
        .from('notification_email_deliveries')
        .update({
          status: 'sent',
          provider: 'resend',
          provider_message_id: sent.id,
          error: null,
        })
        .eq('id', existingDelivery.id)
      return json({ ok: true, status: 'sent', deliveryId: existingDelivery.id })
    }

    const { data: createdDelivery, error: deliveryInsertError } = await serviceClient
      .from('notification_email_deliveries')
      .insert({
        notification_id: payload.notificationId,
        recipient_email: recipientEmail,
        type: idempotencyType,
        status: 'sent',
        provider: 'resend',
        provider_message_id: sent.id,
      })
      .select('id')
      .single()

    if (deliveryInsertError) {
      return json({ ok: false, message: deliveryInsertError.message }, 500)
    }

    return json({ ok: true, status: 'sent', deliveryId: createdDelivery.id })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to send notification email.'
    console.error('notify-teammates provider error', {
      notificationId: payload.notificationId,
      recipientEmail,
      type: idempotencyType,
      message,
    })

    if (existingDelivery?.id) {
      await serviceClient
        .from('notification_email_deliveries')
        .update({
          status: 'failed',
          provider: 'resend',
          error: message,
        })
        .eq('id', existingDelivery.id)
      return json({ ok: true, status: 'provider_error_recorded', message, deliveryId: existingDelivery.id }, 200)
    }

    await serviceClient.from('notification_email_deliveries').insert({
      notification_id: payload.notificationId,
      recipient_email: recipientEmail,
      type: idempotencyType,
      status: 'failed',
      provider: 'resend',
      error: message,
    })

    return json({ ok: true, status: 'provider_error_recorded', message }, 200)
  }
})
