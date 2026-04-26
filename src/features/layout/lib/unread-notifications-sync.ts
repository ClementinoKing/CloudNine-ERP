const UNREAD_NOTIFICATIONS_CACHE_KEY = 'contas.notifications.unread-count.v1'
const UNREAD_NOTIFICATIONS_EVENT = 'contas:notifications-unread-updated'

export function getCachedUnreadCount() {
  const raw = localStorage.getItem(UNREAD_NOTIFICATIONS_CACHE_KEY)
  if (!raw) return 0
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

export function setCachedUnreadCount(nextCount: number) {
  const normalized = Math.max(0, Math.trunc(nextCount))
  localStorage.setItem(UNREAD_NOTIFICATIONS_CACHE_KEY, String(normalized))
  window.dispatchEvent(
    new CustomEvent<{ count: number }>(UNREAD_NOTIFICATIONS_EVENT, {
      detail: { count: normalized },
    }),
  )
}

export function adjustCachedUnreadCount(delta: number) {
  if (!Number.isFinite(delta) || delta === 0) return
  setCachedUnreadCount(getCachedUnreadCount() + Math.trunc(delta))
}

export function onUnreadCountUpdated(callback: (count: number) => void) {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ count?: number }>).detail
    if (!detail || typeof detail.count !== 'number' || !Number.isFinite(detail.count)) return
    callback(Math.max(0, Math.trunc(detail.count)))
  }
  window.addEventListener(UNREAD_NOTIFICATIONS_EVENT, handler as EventListener)
  return () => {
    window.removeEventListener(UNREAD_NOTIFICATIONS_EVENT, handler as EventListener)
  }
}
