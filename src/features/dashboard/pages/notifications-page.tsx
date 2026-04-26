import { AtSign, Bell, Check, CheckCheck, Circle, Filter, MessageSquareText, ShieldAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/features/auth/context/auth-context'
import { setCachedUnreadCount } from '@/features/layout/lib/unread-notifications-sync'
import { openTaskDetailsModal } from '@/features/tasks/lib/open-task-details-modal'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

type NotificationType = 'mention' | 'task' | 'system'
type NotificationFilter = 'all' | 'unread' | 'mentions' | 'system'
const NOTIFICATIONS_CACHE_KEY = 'contas.notifications.cache.v1'

type NotificationItem = {
  id: string
  title: string
  message: string
  taskId?: string
  chatRoomId?: string
  time: string
  type: NotificationType
  read: boolean
}

const FILTERS: Array<{ key: NotificationFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'mentions', label: 'Mentions' },
  { key: 'system', label: 'System' },
]

function relativeTimeLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Just now'
  const diffMs = Date.now() - date.getTime()
  const diffMinutes = Math.floor(diffMs / (1000 * 60))
  if (diffMinutes < 1) return 'Just now'
  if (diffMinutes < 60) return `${diffMinutes} min ago`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date)
}

function NotificationIcon({ type }: { type: NotificationType }) {
  if (type === 'mention') return <AtSign className='h-4 w-4 text-blue-400' aria-hidden='true' />
  if (type === 'system') return <ShieldAlert className='h-4 w-4 text-amber-400' aria-hidden='true' />
  return <MessageSquareText className='h-4 w-4 text-emerald-400' aria-hidden='true' />
}

function NotificationsListSkeleton() {
  return (
    <div className='space-y-2'>
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={`notification-skeleton-${index}`} className='rounded-md border bg-muted/10 px-3 py-3'>
          <div className='flex items-start justify-between gap-3'>
            <div className='flex min-w-0 items-start gap-2.5'>
              <div className='mt-0.5 h-8 w-8 rounded-md bg-muted/60 animate-pulse' />
              <div className='min-w-0 space-y-2 pt-0.5'>
                <div className='h-3.5 w-36 rounded bg-muted/60 animate-pulse' />
                <div className='h-3 w-56 max-w-[70vw] rounded bg-muted/50 animate-pulse' />
                <div className='h-2.5 w-28 rounded bg-muted/40 animate-pulse' />
              </div>
            </div>
            <div className='h-8 w-8 rounded-md bg-muted/50 animate-pulse' />
          </div>
        </div>
      ))}
    </div>
  )
}

export function NotificationsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const handledNotificationRedirectRef = useRef<string | null>(null)
  const { currentUser } = useAuth()
  const [filter, setFilter] = useState<NotificationFilter>('all')
  const [items, setItems] = useState<NotificationItem[]>(() => {
    const raw = localStorage.getItem(NOTIFICATIONS_CACHE_KEY)
    if (!raw) return []
    try {
      return JSON.parse(raw) as NotificationItem[]
    } catch {
      return []
    }
  })
  const [loading, setLoading] = useState(() => items.length === 0)

  useEffect(() => {
    if (!currentUser?.id) return

    let cancelled = false

    const fetchNotifications = async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('id, title, message, task_id, type, read_at, created_at, metadata')
        .eq('recipient_id', currentUser.id)
        .order('created_at', { ascending: false })
      if (cancelled) return
      if (error) {
        console.error('Failed to load notifications', error)
        setLoading(false)
        return
      }

      const mapped: NotificationItem[] = Array.from(
        new Map(
          (data ?? []).map((row) => [
            row.id,
            {
              id: row.id,
              title: row.title,
              message: row.message,
              taskId: row.task_id ?? undefined,
              chatRoomId: typeof row.metadata?.chat_room_id === 'string' ? row.metadata.chat_room_id : undefined,
              time: relativeTimeLabel(row.created_at),
              type: row.type === 'mention' || row.type === 'system' ? row.type : 'task',
              read: Boolean(row.read_at),
            },
          ]),
        ).values(),
      )
      setItems(mapped)
      localStorage.setItem(NOTIFICATIONS_CACHE_KEY, JSON.stringify(mapped))
      setCachedUnreadCount(mapped.filter((item) => !item.read).length)
      setLoading(false)
    }

    void fetchNotifications()

    const onRealtimeChange = (event: Event) => {
      const detail = (event as CustomEvent<{ table?: string }>).detail
      if (detail?.table !== 'notifications') return
      void fetchNotifications()
    }
    window.addEventListener('contas:realtime-change', onRealtimeChange as EventListener)

    return () => {
      cancelled = true
      window.removeEventListener('contas:realtime-change', onRealtimeChange as EventListener)
    }
  }, [currentUser?.id])

  const unreadCount = useMemo(() => items.filter((item) => !item.read).length, [items])

  const visibleItems = useMemo(() => {
    if (filter === 'all') return items
    if (filter === 'unread') return items.filter((item) => !item.read)
    if (filter === 'mentions') return items.filter((item) => item.type === 'mention')
    return items.filter((item) => item.type === 'system')
  }, [filter, items])

  const markAllRead = async () => {
    const now = new Date().toISOString()
    const unreadIds = items.filter((item) => !item.read).map((item) => item.id)
    if (unreadIds.length === 0) return

    setItems((current) => {
      const next = current.map((item) => ({ ...item, read: true }))
      localStorage.setItem(NOTIFICATIONS_CACHE_KEY, JSON.stringify(next))
      setCachedUnreadCount(0)
      return next
    })
    const { error } = await supabase.from('notifications').update({ read_at: now }).in('id', unreadIds)
    if (error) {
      console.error('Failed to mark all notifications as read', error)
      setItems((current) => {
        const next = current.map((item) => (unreadIds.includes(item.id) ? { ...item, read: false } : item))
        localStorage.setItem(NOTIFICATIONS_CACHE_KEY, JSON.stringify(next))
        setCachedUnreadCount(next.filter((item) => !item.read).length)
        return next
      })
    }
  }

  const toggleRead = async (id: string) => {
    const currentItem = items.find((item) => item.id === id)
    if (!currentItem) return
    const nextRead = !currentItem.read

    setItems((current) => {
      const next = current.map((item) => (item.id === id ? { ...item, read: nextRead } : item))
      localStorage.setItem(NOTIFICATIONS_CACHE_KEY, JSON.stringify(next))
      setCachedUnreadCount(next.filter((item) => !item.read).length)
      return next
    })
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: nextRead ? new Date().toISOString() : null })
      .eq('id', id)

    if (error) {
      console.error('Failed to toggle notification read state', error)
      setItems((current) => {
        const next = current.map((item) => (item.id === id ? { ...item, read: currentItem.read } : item))
        localStorage.setItem(NOTIFICATIONS_CACHE_KEY, JSON.stringify(next))
        setCachedUnreadCount(next.filter((item) => !item.read).length)
        return next
      })
    }
  }

  const cacheNotificationItems = (next: NotificationItem[]) => {
    localStorage.setItem(NOTIFICATIONS_CACHE_KEY, JSON.stringify(next))
  }

  const markReadAndPersist = useCallback(
    async (id: string) => {
      const item = items.find((entry) => entry.id === id)
      if (!item || item.read) return

      setItems((current) => {
        const next = current.map((entry) => (entry.id === id ? { ...entry, read: true } : entry))
        cacheNotificationItems(next)
        setCachedUnreadCount(next.filter((entry) => !entry.read).length)
        return next
      })

      const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id)
      if (error) {
        console.error('Failed to mark notification as read', error)
        setItems((current) => {
          const next = current.map((entry) => (entry.id === id ? { ...entry, read: false } : entry))
          cacheNotificationItems(next)
          setCachedUnreadCount(next.filter((entry) => !entry.read).length)
          return next
        })
      }
    },
    [items],
  )

  const resolveTaskId = useCallback(async (item: NotificationItem) => {
    if (item.taskId) return item.taskId
    const { data, error } = await supabase.from('notifications').select('task_id').eq('id', item.id).single()
    if (error) {
      console.error('Failed to resolve notification task id', error)
      return null
    }
    const resolvedTaskId = data?.task_id ?? null
    if (!resolvedTaskId) return null

    setItems((current) => {
      const next = current.map((entry) => (entry.id === item.id ? { ...entry, taskId: resolvedTaskId } : entry))
      cacheNotificationItems(next)
      return next
    })
    return resolvedTaskId
  }, [])

  const openNotificationItem = async (item: NotificationItem) => {
    if (!item.read) {
      await markReadAndPersist(item.id)
    }
    if (item.taskId) {
      openTaskDetailsModal(item.taskId)
      return
    }
    if (item.chatRoomId) {
      navigate('/dashboard/home?openGroupChat=1')
      return
    }

    const taskId = await resolveTaskId(item)
    if (taskId) {
      openTaskDetailsModal(taskId)
    }
  }

  useEffect(() => {
    const redirectNotificationId = searchParams.get('openNotificationId')
    const redirectTaskId = searchParams.get('openTaskId')
    if (!redirectNotificationId && !redirectTaskId) {
      handledNotificationRedirectRef.current = null
      return
    }
    const redirectKey = `${redirectNotificationId ?? 'none'}:${redirectTaskId ?? 'none'}`
    if (handledNotificationRedirectRef.current === redirectKey) return

    if (redirectTaskId) {
      handledNotificationRedirectRef.current = redirectKey
      if (redirectNotificationId) {
        window.setTimeout(() => {
          void markReadAndPersist(redirectNotificationId)
        }, 0)
      }
      openTaskDetailsModal(redirectTaskId)
      const nextParams = new URLSearchParams(searchParams)
      nextParams.delete('openNotificationId')
      nextParams.delete('openTaskId')
      setSearchParams(nextParams, { replace: true })
      return
    }

    if (loading) return

    const target = redirectNotificationId ? items.find((item) => item.id === redirectNotificationId) : null
    if (!target) return
    handledNotificationRedirectRef.current = redirectKey
    if (!target.read) {
      window.setTimeout(() => {
        void markReadAndPersist(target.id)
      }, 0)
    }
    void (async () => {
      if (target.chatRoomId) {
        navigate('/dashboard/home?openGroupChat=1')
        return
      }
      const taskId = target.taskId ?? (await resolveTaskId(target))
      if (taskId) {
        openTaskDetailsModal(taskId)
      }
    })()

    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete('openNotificationId')
    nextParams.delete('openTaskId')
    setSearchParams(nextParams, { replace: true })
  }, [items, loading, markReadAndPersist, navigate, resolveTaskId, searchParams, setSearchParams])

  return (
    <div className='space-y-4'>
      <Card>
        <CardContent className='flex flex-wrap items-center justify-between gap-3 p-3'>
          <div className='inline-flex flex-wrap gap-1 rounded-md bg-muted/35 p-1'>
            {FILTERS.map((item) => (
              <button
                key={item.key}
                type='button'
                onClick={() => setFilter(item.key)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  filter === item.key
                    ? 'border bg-card text-foreground shadow-[inset_0_0_0_1px_hsl(var(--border))]'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className='flex items-center gap-2'>
            <Badge variant='outline' className='gap-1.5'>
              <Bell className='h-3.5 w-3.5' aria-hidden='true' />
              {unreadCount} unread
            </Badge>
            <Button
              type='button'
              size='icon'
              variant='outline'
              className='h-8 w-8'
              onClick={markAllRead}
              aria-label='Mark all read'
              title='Mark all read'
            >
              <CheckCheck className='h-4 w-4' aria-hidden='true' />
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className='pb-3'>
          <CardTitle>Notifications</CardTitle>
          <CardDescription>Keep up with mentions, task updates, and organization alerts.</CardDescription>
        </CardHeader>
        <CardContent className='space-y-2'>
          {loading ? (
            <NotificationsListSkeleton />
          ) : null}
          {!loading && visibleItems.length === 0 ? (
            <div className='rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground'>
              No notifications in this filter.
            </div>
          ) : null}
          {!loading ? (
            visibleItems.map((item) => (
              <article
                key={item.id}
                className={cn(
                  'rounded-md border px-3 py-3 transition-colors',
                  item.taskId || item.chatRoomId ? 'cursor-pointer hover:border-primary/50 hover:bg-primary/10' : '',
                  !item.read ? 'border-primary/30 bg-primary/5' : 'bg-muted/10',
                )}
                onClick={() => {
                  void openNotificationItem(item)
                }}
              >
                <div className='flex items-start justify-between gap-3'>
                  <div className='flex min-w-0 items-start gap-2.5'>
                    <div className='mt-0.5 rounded-md border bg-background p-1.5'>
                      <NotificationIcon type={item.type} />
                    </div>
                    <div className='min-w-0 space-y-1'>
                      <p className='text-sm font-semibold text-foreground'>{item.title}</p>
                      <p className='text-sm text-muted-foreground'>{item.message}</p>
                      <div className='flex items-center gap-2 text-xs text-muted-foreground'>
                        <span>{item.time}</span>
                        <span>•</span>
                        <span className='capitalize'>{item.type}</span>
                        {!item.read ? (
                          <>
                            <span>•</span>
                            <span className='text-primary'>Unread</span>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <Button
                    type='button'
                    size='icon'
                    variant='ghost'
                    className='h-8 w-8'
                    aria-label={item.read ? 'Mark unread' : 'Mark read'}
                    title={item.read ? 'Mark unread' : 'Mark read'}
                    onClick={(event) => {
                      event.stopPropagation()
                      void toggleRead(item.id)
                    }}
                  >
                    {item.read ? <Circle className='h-4 w-4' aria-hidden='true' /> : <Check className='h-4 w-4' aria-hidden='true' />}
                  </Button>
                </div>
              </article>
            ))
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className='flex items-center justify-between p-3 text-xs text-muted-foreground'>
          <span className='inline-flex items-center gap-1.5'>
            <Filter className='h-3.5 w-3.5' aria-hidden='true' />
            Filter: {FILTERS.find((item) => item.key === filter)?.label}
          </span>
          <span>{visibleItems.length} item(s)</span>
        </CardContent>
      </Card>
    </div>
  )
}
