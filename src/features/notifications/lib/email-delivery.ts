import { supabase } from '@/lib/supabase'

type NotificationEmailType = 'task_assigned' | 'mention'

type NotificationDispatchItem = {
  notificationId: string
  recipientId: string
  recipientEmail?: string
  type: NotificationEmailType
  actorName: string
  messagePreview?: string
  taskId?: string
  taskTitle?: string
  roomId?: string
  roomName?: string
  contextKind?: 'task' | 'chat'
  appUrl?: string
}

function resolveAppUrl(item: NotificationDispatchItem) {
  if (typeof window === 'undefined') return ''
  if (item.appUrl) return item.appUrl
  if (item.contextKind === 'chat') {
    return `${window.location.origin}/dashboard/home?openGroupChat=1`
  }
  if (item.taskId) {
    return `${window.location.origin}/dashboard/notifications?openTaskId=${encodeURIComponent(item.taskId)}`
  }
  return `${window.location.origin}/dashboard/notifications`
}

export async function dispatchNotificationEmails(items: NotificationDispatchItem[]) {
  if (items.length === 0) return

  const {
    data: { session: initialSession },
  } = await supabase.auth.getSession()
  let accessToken = initialSession?.access_token ?? null

  if (!accessToken) {
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession()
    if (refreshError) {
      console.error('Failed to refresh session before notification dispatch', refreshError)
    }
    accessToken = refreshed.session?.access_token ?? null
  }

  if (!accessToken) {
    console.error('Failed to dispatch notification email: missing active access token')
    return
  }

  await Promise.allSettled(
    items.map((item) =>
      supabase.functions
        .invoke('notify-teammates', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          body: {
            type: item.type,
            recipientId: item.recipientId,
            recipientEmail: item.recipientEmail,
            taskId: item.taskId,
            taskTitle: item.taskTitle,
            roomId: item.roomId,
            roomName: item.roomName,
            actorName: item.actorName,
            messagePreview: item.messagePreview,
            contextKind: item.contextKind,
            appUrl: resolveAppUrl(item),
            notificationId: item.notificationId,
          },
        })
        .then(({ error }) => {
          if (error) {
            console.error('Failed to dispatch notification email', error)
          }
        }),
    ),
  )
}
