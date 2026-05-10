export type ResendEmailInput = {
  apiKey: string
  from: string
  to: string
  subject: string
  html: string
}

export type NotificationEmailType = 'task_assigned' | 'mention'
export type NotificationContextKind = 'task' | 'chat'
export type ReminderEmailType = 'due_24h' | 'due_1h' | 'overdue'

export type InviteEmailInput = {
  invitedByName: string
  fullName: string
  organizationName: string
  role: string
  appUrl: string
  temporaryPassword: string
}

export type NotificationEmailInput = {
  type: NotificationEmailType
  contextKind: NotificationContextKind
  actorName: string
  contextName: string
  messagePreview?: string
  appUrl: string
}

export type ReminderEmailInput = {
  reminderType: ReminderEmailType
  taskTitle: string
  taskUrl: string
  dueAt?: string
}

export const CLOUDNINE_BRAND = {
  name: 'CloudNine ERP',
  logoUrl: 'https://pub-a46f5051137d4371b468ede26ed2c03c.r2.dev/assest/CN_logo.svg',
  colors: {
    page: '#f9fafb',
    panel: '#ffffff',
    border: '#eef2f6',
    text: '#111827',
    muted: '#5b677a',
    subtle: '#f8fafc',
    primary: '#1f93ff',
    primarySoft: '#eff6ff',
    warningText: '#9a3412',
    warningBg: '#fff7ed',
    warningBorder: '#fed7aa',
  },
} as const

export function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function renderEmailShell(input: {
  title: string
  previewText: string
  body: string
  footer: string
}) {
  const safeTitle = escapeHtml(input.title)
  const safePreviewText = escapeHtml(input.previewText)

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
  <style>
    body{margin:0;padding:0;background:${CLOUDNINE_BRAND.colors.page};font-family:Arial,Helvetica,sans-serif;color:${CLOUDNINE_BRAND.colors.text};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
    table{border-spacing:0;border-collapse:collapse;}
    img{border:0;display:block;max-width:100%;}
    a{text-decoration:none;}
    .email-wrapper{width:100%;background:${CLOUDNINE_BRAND.colors.page};padding:32px 16px;}
    .email-container{width:100%;max-width:640px;margin:0 auto;background:${CLOUDNINE_BRAND.colors.panel};border-radius:14px;overflow:hidden;box-shadow:0 14px 34px rgba(15,23,42,0.10);}
    .header{background:${CLOUDNINE_BRAND.colors.panel};padding:28px 40px 20px;text-align:center;border-bottom:1px solid ${CLOUDNINE_BRAND.colors.border};}
    .logo{max-width:220px;width:100%;height:auto;margin:0 auto;}
    .hero{background:linear-gradient(180deg,#f1f7ff 0%,#ffffff 100%);padding:34px 40px 20px;}
    .hero h1{margin:0 0 14px;font-size:30px;line-height:1.2;color:${CLOUDNINE_BRAND.colors.text};font-weight:700;}
    .hero p{margin:0;font-size:15px;line-height:1.6;color:${CLOUDNINE_BRAND.colors.muted};}
    .content{padding:0 40px 36px;}
    .content p{margin:0 0 16px;font-size:15px;line-height:1.6;color:${CLOUDNINE_BRAND.colors.muted};}
    .content strong{color:${CLOUDNINE_BRAND.colors.text};}
    .info-card{background:${CLOUDNINE_BRAND.colors.subtle};border:1px solid ${CLOUDNINE_BRAND.colors.border};border-radius:10px;padding:16px 18px;margin:24px 0;}
    .info-row{margin-bottom:12px;font-size:14px;line-height:1.5;color:${CLOUDNINE_BRAND.colors.muted};}
    .info-row:last-child{margin-bottom:0;}
    .label{display:block;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${CLOUDNINE_BRAND.colors.primary};margin-bottom:4px;}
    .message-box{border:1px solid #dbe4f0;border-radius:10px;background:#f8fbff;padding:16px;margin:20px 0;}
    .message-box p{margin:0;font-size:14px;line-height:1.7;color:#334155;white-space:pre-wrap;}
    .password-box{display:inline-block;margin-top:6px;background:${CLOUDNINE_BRAND.colors.primarySoft};border:1px solid #bfdbfe;padding:8px 14px;border-radius:6px;font-weight:700;font-size:16px;color:${CLOUDNINE_BRAND.colors.text};letter-spacing:1px;}
    .cta-wrap{margin:28px 0 20px;}
    .cta-button{display:inline-block;background:${CLOUDNINE_BRAND.colors.primary};color:#ffffff !important;text-decoration:none;font-size:15px;font-weight:700;padding:14px 26px;border-radius:8px;}
    .helper-text{font-size:13px;line-height:1.6;color:${CLOUDNINE_BRAND.colors.muted};}
    .helper-text a{color:${CLOUDNINE_BRAND.colors.primary};text-decoration:underline;word-break:break-word;}
    .note{margin-top:20px;padding:14px 16px;background:${CLOUDNINE_BRAND.colors.subtle};border-left:3px solid ${CLOUDNINE_BRAND.colors.primary};border-radius:6px;font-size:13px;line-height:1.6;color:${CLOUDNINE_BRAND.colors.muted};}
    .due-card{margin:24px 0 16px;padding:14px 16px;background:${CLOUDNINE_BRAND.colors.subtle};border:1px solid ${CLOUDNINE_BRAND.colors.border};border-radius:10px;font-size:14px;line-height:1.5;color:${CLOUDNINE_BRAND.colors.muted};}
    .due-card.overdue{background:${CLOUDNINE_BRAND.colors.warningBg};border-color:${CLOUDNINE_BRAND.colors.warningBorder};color:${CLOUDNINE_BRAND.colors.warningText};}
    .footer{border-top:1px solid ${CLOUDNINE_BRAND.colors.border};padding:22px 40px 28px;text-align:center;background:${CLOUDNINE_BRAND.colors.panel};font-size:12px;line-height:1.6;color:${CLOUDNINE_BRAND.colors.muted};}
    @media only screen and (max-width:640px){
      .email-wrapper{padding:20px 10px !important;}
      .header,.hero,.content,.footer{padding-left:24px !important;padding-right:24px !important;}
      .hero h1{font-size:24px !important;}
      .cta-button{display:block !important;text-align:center !important;}
    }
  </style>
</head>
<body>
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${safePreviewText}</div>
  <div class="email-wrapper">
    <table role="presentation" width="100%">
      <tr>
        <td align="center">
          <table role="presentation" class="email-container" width="100%">
            <tr>
              <td class="header">
                <img src="${CLOUDNINE_BRAND.logoUrl}" alt="${CLOUDNINE_BRAND.name}" class="logo" />
              </td>
            </tr>
            ${input.body}
            <tr>
              <td class="footer">
                ${input.footer}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </div>
</body>
</html>
  `
}

export function notificationSubject(input: Pick<NotificationEmailInput, 'type' | 'contextKind' | 'contextName'>) {
  if (input.type === 'task_assigned') return 'You were assigned a task'
  return input.contextKind === 'chat' ? `You were mentioned in ${input.contextName}` : 'You were mentioned in a task'
}

export function renderNotificationEmail(input: NotificationEmailInput) {
  const safeActorName = escapeHtml(input.actorName)
  const safeContextName = escapeHtml(input.contextName)
  const safeAppUrl = escapeHtml(input.appUrl)
  const safeMessagePreview = input.messagePreview?.trim() ? escapeHtml(input.messagePreview.trim()) : ''
  const heading =
    input.type === 'mention'
      ? input.contextKind === 'chat'
        ? 'You were mentioned in group chat'
        : 'You were mentioned'
      : 'You were assigned a task'
  const intro =
    input.type === 'mention'
      ? `<strong>${safeActorName}</strong> mentioned you in <strong>${safeContextName}</strong>.`
      : `<strong>${safeActorName}</strong> assigned you to <strong>${safeContextName}</strong>.`
  const bodyText =
    input.type === 'mention'
      ? input.contextKind === 'chat'
        ? 'Open the dashboard to read the full message and reply in the group chat.'
        : 'Open the task to view the comment and respond.'
      : 'Open the task to review the details and begin work.'
  const footerText =
    input.type === 'mention'
      ? input.contextKind === 'chat'
        ? `This notification was sent by ${CLOUDNINE_BRAND.name} because a group chat mention requires your attention.`
        : `This notification was sent by ${CLOUDNINE_BRAND.name} because a task update requires your attention.`
      : `This notification was sent by ${CLOUDNINE_BRAND.name} because a new task was assigned to you.`
  const messageBlock = safeMessagePreview
    ? `
                <div class="message-box">
                  <span class="label">Message</span>
                  <p>${safeMessagePreview}</p>
                </div>
      `
    : ''

  return renderEmailShell({
    title: `${CLOUDNINE_BRAND.name} Notification`,
    previewText: `${input.actorName} sent you a ${input.type === 'mention' ? 'mention' : 'task assignment'} notification.`,
    body: `
            <tr>
              <td class="hero">
                <h1>${heading}</h1>
                <p>${intro}</p>
              </td>
            </tr>
            <tr>
              <td class="content">
                <p>${bodyText}</p>
                ${messageBlock}
                <div class="cta-wrap">
                  <a href="${safeAppUrl}" class="cta-button">Open ${CLOUDNINE_BRAND.name}</a>
                </div>
                <p class="helper-text">
                  If the button does not work, copy and paste this link into your browser:<br />
                  <a href="${safeAppUrl}">${safeAppUrl}</a>
                </p>
              </td>
            </tr>
    `,
    footer: escapeHtml(footerText),
  })
}

export function reminderSubject(reminderType: ReminderEmailType) {
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

export function renderReminderEmail(input: ReminderEmailInput) {
  const safeTaskTitle = escapeHtml(input.taskTitle)
  const safeTaskUrl = escapeHtml(input.taskUrl)
  const safeDueAt = escapeHtml(formatDueAtLabel(input.dueAt))
  const isOverdue = input.reminderType === 'overdue'
  const hoursLabel = input.reminderType === 'due_1h' ? '1 hour' : '24 hours'
  const heading = isOverdue ? 'Task overdue' : `Task due in ${hoursLabel}`
  const intro = isOverdue
    ? `The task <strong>${safeTaskTitle}</strong> is now overdue.`
    : `The task <strong>${safeTaskTitle}</strong> is due in <strong>${hoursLabel}</strong>.`
  const dueCard = safeDueAt
    ? `<div class="due-card${isOverdue ? ' overdue' : ''}"><strong>Due at:</strong> ${safeDueAt}</div>`
    : ''

  return renderEmailShell({
    title: `${CLOUDNINE_BRAND.name} Task Reminder`,
    previewText: `${heading}: ${input.taskTitle}`,
    body: `
            <tr>
              <td class="hero">
                <h1>${heading}</h1>
                <p>${intro}</p>
              </td>
            </tr>
            <tr>
              <td class="content">
                ${dueCard}
                <p>Open the task to review the details and stay on schedule.</p>
                <div class="cta-wrap">
                  <a href="${safeTaskUrl}" class="cta-button">Open task</a>
                </div>
                <p class="helper-text">
                  If the button does not work, copy and paste this link into your browser:<br />
                  <a href="${safeTaskUrl}">${safeTaskUrl}</a>
                </p>
              </td>
            </tr>
    `,
    footer: escapeHtml(`This reminder was sent by ${CLOUDNINE_BRAND.name} based on the task due date.`),
  })
}

export function renderInviteEmail(input: InviteEmailInput) {
  const safeInvitedBy = escapeHtml(input.invitedByName)
  const safeFullName = escapeHtml(input.fullName)
  const safeOrganizationName = escapeHtml(input.organizationName)
  const safeRole = escapeHtml(input.role.charAt(0).toUpperCase() + input.role.slice(1))
  const safeAppUrl = escapeHtml(input.appUrl)
  const safeTemporaryPassword = escapeHtml(input.temporaryPassword)

  return renderEmailShell({
    title: `${CLOUDNINE_BRAND.name} Invitation`,
    previewText: `You have been invited to ${input.organizationName} on ${CLOUDNINE_BRAND.name}.`,
    body: `
            <tr>
              <td class="hero">
                <h1>You are invited to ${safeOrganizationName}</h1>
                <p>Access your workspace securely and complete your account setup to begin collaborating with your organization in ${CLOUDNINE_BRAND.name}.</p>
              </td>
            </tr>
            <tr>
              <td class="content">
                <p>
                  <strong>${safeInvitedBy}</strong> has invited
                  <strong>${safeFullName}</strong> to join
                  <strong>${safeOrganizationName}</strong> as a
                  <strong>${safeRole.toLowerCase()}</strong>.
                </p>
                <div class="info-card">
                  <div class="info-row">
                    <span class="label">Organization</span>
                    ${safeOrganizationName}
                  </div>
                  <div class="info-row">
                    <span class="label">Invited by</span>
                    ${safeInvitedBy}
                  </div>
                  <div class="info-row">
                    <span class="label">Role</span>
                    ${safeRole}
                  </div>
                  <div class="info-row">
                    <span class="label">Temporary Password</span>
                    <div class="password-box">${safeTemporaryPassword}</div>
                  </div>
                </div>
                <p>For security reasons, you will be required to reset this password immediately after your first login.</p>
                <div class="cta-wrap">
                  <a href="${safeAppUrl}" class="cta-button">Open ${CLOUDNINE_BRAND.name}</a>
                </div>
                <p class="helper-text">
                  If the button does not work, copy and paste this link into your browser:<br />
                  <a href="${safeAppUrl}">${safeAppUrl}</a>
                </p>
                <div class="note">If you were not expecting this invitation, you can safely ignore this email or contact your administrator for assistance.</div>
              </td>
            </tr>
    `,
    footer: `&copy; 2026 ${CLOUDNINE_BRAND.name}. All rights reserved.<br />This invitation was sent to give you access to the ${safeOrganizationName} workspace.`,
  })
}

export async function sendResendEmail(input: ResendEmailInput) {
  if (!input.apiKey || !input.from) {
    throw new Error('Missing RESEND_API_KEY or RESEND_FROM_EMAIL.')
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: input.from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
    }),
  })

  const data = await response.json().catch(() => ({})) as { id?: unknown; message?: unknown }
  if (!response.ok) {
    const message = typeof data.message === 'string' ? data.message : `Resend failed with status ${response.status}`
    throw new Error(message)
  }

  return {
    id: typeof data.id === 'string' ? data.id : null,
  }
}
