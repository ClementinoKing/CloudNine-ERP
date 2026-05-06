import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type NotificationEmailType = 'task_assigned' | 'mention'

type NotifyPayload = {
  type: NotificationEmailType
  recipientEmail?: string
  recipientId?: string
  taskId?: string
  taskTitle?: string
  roomId?: string
  roomName?: string
  actorName: string
  messagePreview?: string
  contextKind?: 'task' | 'chat'
  appUrl?: string
  notificationId: string
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const RESEND_FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') ?? ''
const APP_BASE_URL = Deno.env.get('APP_BASE_URL') ?? ''
const FALLBACK_APP_BASE_URL = 'https://cloudninetech.co.za'
const BRAND_LOGO_URL = 'https://pub-7d1e5686dccc4c4b82b655d5aed298ae.r2.dev/images/Spryar_Tech.png'

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

function subjectForType(type: NotificationEmailType, contextKind: 'task' | 'chat', contextName: string) {
  if (type === 'task_assigned') return 'You were assigned a task'
  return contextKind === 'chat' ? `You were mentioned in ${contextName}` : 'You were mentioned in a task'
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function bodyForType(
  type: NotificationEmailType,
  contextKind: 'task' | 'chat',
  actorName: string,
  contextName: string,
  messagePreview: string | undefined,
  appUrl: string,
) {
  const safeActorName = escapeHtml(actorName)
  const safeContextName = escapeHtml(contextName)
  const safeAppUrl = escapeHtml(appUrl)
  const safeMessagePreview = messagePreview?.trim() ? escapeHtml(messagePreview.trim()) : ''
  const messageBlock = safeMessagePreview
    ? `
          <tr>
            <td style="padding:0 28px 16px 28px;">
              <div style="border:1px solid #dbe4f0;border-radius:12px;background:#f8fbff;padding:16px;">
                <p style="margin:0 0 8px 0;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#64748b;">Message</p>
                <p style="margin:0;font-size:14px;line-height:1.7;color:#334155;white-space:pre-wrap;">${safeMessagePreview}</p>
              </div>
            </td>
          </tr>
        `
    : ''
  const heading =
    type === 'mention' ? (contextKind === 'chat' ? 'You were mentioned in group chat' : 'You were mentioned') : 'You were assigned a task'
  const intro =
    type === 'mention'
      ? contextKind === 'chat'
        ? `<strong>${safeActorName}</strong> mentioned you in <strong>${safeContextName}</strong>.`
        : `<strong>${safeActorName}</strong> mentioned you in <strong>${safeContextName}</strong>.`
      : `<strong>${safeActorName}</strong> assigned you to <strong>${safeContextName}</strong>.`
  const bodyText =
    type === 'mention'
      ? contextKind === 'chat'
        ? 'Open the dashboard to read the full message and reply in the group chat.'
        : 'Open the task to view the comment and respond.'
      : 'Open the task to review the details and begin work.'
  const footerText =
    type === 'mention'
      ? contextKind === 'chat'
        ? 'This notification was sent by CloudNine ERP because a group chat mention requires your attention.'
        : 'This notification was sent by CloudNine ERP because a task update requires your attention.'
      : 'This notification was sent by CloudNine ERP because a new task was assigned to you.'

  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
  <table width="100%" style="background:#f4f7fb;padding:24px 12px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:600px;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
          <tr>
            <td style="padding:28px;border-bottom:1px solid #e2e8f0;text-align:center;">
              <img src="${BRAND_LOGO_URL}" alt="CloudNine ERP" style="height:42px;">
            </td>
          </tr>
          <tr>
            <td style="padding:32px 28px 16px 28px;">
              <h1 style="margin:0 0 12px 0;font-size:24px;color:#0f172a;">${heading}</h1>
              <p style="margin:0 0 16px 0;font-size:15px;line-height:1.7;color:#334155;">${intro}</p>
              <p style="margin:0;font-size:15px;color:#334155;">${bodyText}</p>
            </td>
          </tr>
          ${messageBlock}
          <tr>
            <td style="padding:8px 28px;">
              <a href="${safeAppUrl}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#1a8fe3;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">
                Open CloudNine ERP
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px;">
              <p style="font-size:13px;color:#64748b;margin:0;">Direct link:</p>
              <p style="font-size:13px;margin:6px 0 0 0;">
                <a href="${safeAppUrl}" style="color:#b77900;text-decoration:underline;">${safeAppUrl}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px 28px 28px;border-top:1px solid #e2e8f0;">
              <p style="font-size:12px;color:#94a3b8;margin:0;">${footerText}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `
}

async function sendResendEmail(input: {
  to: string
  type: NotificationEmailType
  contextKind: 'task' | 'chat'
  actorName: string
  contextName: string
  messagePreview?: string
  appUrl: string
}) {
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
    throw new Error('Missing RESEND_API_KEY or RESEND_FROM_EMAIL.')
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: [input.to],
      subject: subjectForType(input.type, input.contextKind, input.contextName),
      html: bodyForType(input.type, input.contextKind, input.actorName, input.contextName, input.messagePreview, input.appUrl),
    }),
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = typeof data?.message === 'string' ? data.message : `Resend failed with status ${response.status}`
    throw new Error(message)
  }

  return {
    id: typeof data?.id === 'string' ? data.id : null,
  }
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

  if (!payload.type || !payload.notificationId || !payload.actorName) {
    return json({ ok: false, message: 'Missing required notification payload fields.' }, 400)
  }

  if (payload.type !== 'mention' && payload.type !== 'task_assigned') {
    return json({ ok: false, message: 'Unsupported notification email type.' }, 400)
  }

  const contextKind = payload.contextKind ?? 'task'
  if (contextKind === 'task' && (!payload.taskId || !payload.taskTitle)) {
    return json({ ok: false, message: 'Missing task notification context.' }, 400)
  }

  if (contextKind === 'chat' && !payload.roomName) {
    return json({ ok: false, message: 'Missing chat notification context.' }, 400)
  }

  const requesterId =
    requesterIdFromBearerToken(accessToken) ??
    req.headers.get('x-supabase-auth-user-id') ??
    req.headers.get('x-supabase-auth-user') ??
    null
  if (!requesterId) {
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

  if (notificationRow.actor_id !== requesterId) {
    return json({ ok: false, message: 'Only the actor can trigger this email.' }, 403)
  }

  if (contextKind === 'task') {
    if (notificationRow.task_id !== payload.taskId) {
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

  const idempotencyType = payload.type

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
      : `${appBaseUrl}/dashboard/notifications?openTaskId=${encodeURIComponent(payload.taskId ?? '')}`)
  const contextName = contextKind === 'chat' ? payload.roomName ?? 'Group Chat' : payload.taskTitle ?? 'a task'

  try {
    const sent = await sendResendEmail({
      to: recipientEmail,
      type: payload.type,
      contextKind,
      actorName: payload.actorName,
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
