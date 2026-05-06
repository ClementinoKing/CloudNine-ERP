import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type ReminderType = 'due_24h' | 'due_1h' | 'overdue'

type ReminderDispatchPayload = {
  notification_id: string
  task_id: string
  recipient_id: string
  reminder_type: ReminderType
  task_title?: string
  due_at?: string
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const RESEND_FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') ?? ''
const TASK_REMINDER_DISPATCH_TOKEN = Deno.env.get('TASK_REMINDER_DISPATCH_TOKEN') ?? ''
const APP_BASE_URL = Deno.env.get('APP_BASE_URL') ?? 'https://cloudninetech.co.za'
const BRAND_LOGO_URL = 'https://pub-7d1e5686dccc4c4b82b655d5aed298ae.r2.dev/images/Spryar_Tech.png'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

function normalizeBearerToken(value: string) {
  const token = value.trim()
  if (!token) return ''
  const match = token.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() ?? token
}

function isReminderType(value: string): value is ReminderType {
  return value === 'due_24h' || value === 'due_1h' || value === 'overdue'
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function getSubject(reminderType: ReminderType) {
  if (reminderType === 'due_24h') return 'Task due in 24 hours'
  if (reminderType === 'due_1h') return 'Task due in 1 hour'
  return 'Task overdue'
}

function formatDueAtLabel(value?: string) {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(parsed)
}

function buildMessage(reminderType: ReminderType, taskTitle: string, taskUrl: string, dueAt?: string) {
  const safeTaskTitle = escapeHtml(taskTitle)
  const safeTaskUrl = escapeHtml(taskUrl)
  const safeDueAt = escapeHtml(formatDueAtLabel(dueAt))
  const isOverdue = reminderType === 'overdue'
  const hoursLabel = reminderType === 'due_1h' ? '1 hour' : '24 hours'
  const title = isOverdue ? 'Task overdue' : `Task due in ${hoursLabel}`
  const intro = isOverdue
    ? `The task <strong>${safeTaskTitle}</strong> is now overdue.`
    : `The task <strong>${safeTaskTitle}</strong> is due in <strong>${hoursLabel}</strong>.`
  const dueCardStyle = isOverdue
    ? 'margin:0 0 16px 0;padding:12px;background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;font-size:14px;color:#9a3412;'
    : 'margin:0 0 16px 0;padding:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;font-size:14px;'
  const dueCard = safeDueAt
    ? `<div style="${dueCardStyle}"><strong>Due at:</strong> ${safeDueAt}</div>`
    : ''

  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;">
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
            <td style="padding:32px 28px;">
              <h1 style="margin:0 0 14px 0;font-size:24px;">${title}</h1>
              <p style="margin:0 0 16px 0;font-size:15px;">${intro}</p>
              ${dueCard}
              <p style="margin:0;font-size:15px;">Open the task to review the details and stay on schedule.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px;">
              <a href="${safeTaskUrl}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#1a8fe3;color:#ffffff;text-decoration:none;font-weight:700;">
                Open task
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px 28px 28px;border-top:1px solid #e2e8f0;">
              <p style="font-size:12px;color:#94a3b8;margin:0;">This reminder was sent by CloudNine ERP based on the task due date.</p>
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

async function sendReminderEmail(input: {
  to: string
  reminderType: ReminderType
  taskTitle: string
  taskUrl: string
  dueAt?: string
}) {
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
    return { skipped: true as const, reason: 'Resend is not configured.' }
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
      subject: getSubject(input.reminderType),
      html: buildMessage(input.reminderType, input.taskTitle, input.taskUrl, input.dueAt),
    }),
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = typeof data?.message === 'string' ? data.message : `Resend failed with status ${response.status}`
    throw new Error(message)
  }

  return {
    skipped: false as const,
    providerMessageId: typeof data?.id === 'string' ? data.id : null,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ ok: false, message: 'Method not allowed.' }, 405)
  }

  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization') ?? ''
  const receivedToken = normalizeBearerToken(authHeader)
  if (!TASK_REMINDER_DISPATCH_TOKEN || receivedToken !== TASK_REMINDER_DISPATCH_TOKEN) {
    return json({ ok: false, message: 'Unauthorized.' }, 401)
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok: false, message: 'Missing Supabase environment variables.' }, 500)
  }

  let payload: ReminderDispatchPayload
  try {
    payload = (await req.json()) as ReminderDispatchPayload
  } catch {
    return json({ ok: false, message: 'Invalid JSON payload.' }, 400)
  }

  if (
    !payload.notification_id ||
    !payload.task_id ||
    !payload.recipient_id ||
    !payload.reminder_type ||
    !isReminderType(payload.reminder_type)
  ) {
    return json({ ok: false, message: 'Missing or invalid reminder payload fields.' }, 400)
  }

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: profileRow, error: profileError } = await serviceClient
    .from('profiles')
    .select('email')
    .eq('id', payload.recipient_id)
    .maybeSingle()

  if (profileError) {
    return json({ ok: false, message: profileError.message }, 500)
  }

  const recipientEmail = profileRow?.email?.trim().toLowerCase()
  if (!recipientEmail) {
    console.warn('task-reminder-dispatch missing recipient email', {
      notificationId: payload.notification_id,
      recipientId: payload.recipient_id,
      taskId: payload.task_id,
    })
    return json({ ok: true, status: 'skipped_missing_email' })
  }

  const taskTitle = payload.task_title?.trim() || 'Task'
  const dueAt = payload.due_at
  const appBaseUrl = APP_BASE_URL.replace(/\/+$/, '')
  const taskUrl = `${appBaseUrl}/dashboard/notifications?openTaskId=${encodeURIComponent(payload.task_id)}`

  try {
    const delivery = await sendReminderEmail({
      to: recipientEmail,
      reminderType: payload.reminder_type,
      taskTitle,
      taskUrl,
      dueAt,
    })

    if (delivery.skipped) {
      console.info('task-reminder-dispatch email skipped', {
        notificationId: payload.notification_id,
        reason: delivery.reason,
      })
      return json({ ok: true, status: 'email_skipped', reason: delivery.reason })
    }

    console.info('task-reminder-dispatch email sent', {
      notificationId: payload.notification_id,
      recipientEmail,
      providerMessageId: delivery.providerMessageId,
      reminderType: payload.reminder_type,
    })

    return json({ ok: true, status: 'sent', providerMessageId: delivery.providerMessageId })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to send reminder email.'
    console.error('task-reminder-dispatch send failed', {
      notificationId: payload.notification_id,
      recipientEmail,
      reminderType: payload.reminder_type,
      message,
    })

    return json({ ok: true, status: 'provider_error_recorded', message }, 200)
  }
})
