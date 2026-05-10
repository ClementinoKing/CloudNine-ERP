import { createClient } from 'npm:@supabase/supabase-js'
import {
  reminderSubject,
  renderReminderEmail,
  sendResendEmail,
  type ReminderEmailType,
} from '../_shared/email.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type ReminderDispatchPayload = {
  notification_id: string
  task_id: string
  recipient_id: string
  reminder_type: ReminderEmailType
  task_title?: string
  due_at?: string
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const RESEND_FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') ?? ''
const TASK_REMINDER_DISPATCH_TOKEN = Deno.env.get('TASK_REMINDER_DISPATCH_TOKEN') ?? ''
const APP_BASE_URL = Deno.env.get('APP_BASE_URL') ?? 'https://cloudninetech.co.za'

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

function isReminderType(value: string): value is ReminderEmailType {
  return value === 'due_24h' || value === 'due_1h' || value === 'overdue'
}

async function sendReminderEmail(input: {
  to: string
  reminderType: ReminderEmailType
  taskTitle: string
  taskUrl: string
  dueAt?: string
}) {
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
    return { skipped: true as const, reason: 'Resend is not configured.' }
  }

  const sent = await sendResendEmail({
    apiKey: RESEND_API_KEY,
    from: RESEND_FROM_EMAIL,
    to: input.to,
    subject: reminderSubject(input.reminderType),
    html: renderReminderEmail(input),
  })

  return { skipped: false as const, providerMessageId: sent.id }
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
