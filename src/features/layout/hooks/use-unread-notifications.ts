import { useEffect, useState } from 'react'

import { useAuth } from '@/features/auth/context/auth-context'
import { getCachedUnreadCount, onUnreadCountUpdated, setCachedUnreadCount } from '@/features/layout/lib/unread-notifications-sync'
import { supabase } from '@/lib/supabase'

export function useUnreadNotifications() {
  const { currentUser } = useAuth()
  const [unreadCount, setUnreadCount] = useState(() => getCachedUnreadCount())

  useEffect(() => {
    const unsubscribe = onUnreadCountUpdated((count) => setUnreadCount(count))
    return unsubscribe
  }, [])

  useEffect(() => {
    if (!currentUser?.id) {
      return
    }

    let cancelled = false

    const loadUnreadCount = async () => {
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_id', currentUser.id)
        .is('read_at', null)

      if (cancelled || error) return
      const next = count ?? 0
      setUnreadCount(next)
      setCachedUnreadCount(next)
    }

    void loadUnreadCount()
    const pollId = window.setInterval(() => {
      void loadUnreadCount()
    }, 15000)

    const channel = supabase
      .channel(`notifications-unread-${currentUser.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_id=eq.${currentUser.id}`,
        },
        () => {
          void loadUnreadCount()
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      window.clearInterval(pollId)
      void supabase.removeChannel(channel)
    }
  }, [currentUser?.id])

  return { unreadCount }
}
