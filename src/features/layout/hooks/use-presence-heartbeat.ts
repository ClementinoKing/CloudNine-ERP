import { useEffect } from 'react'

import { useAuth } from '@/features/auth/context/auth-context'
import { supabase } from '@/lib/supabase'

const HEARTBEAT_MS = 30000
const PRESENCE_SESSION_KEY_STORAGE = 'contas.presence.session_key'

export function usePresenceHeartbeat() {
  const { isAuthenticated, currentUser } = useAuth()

  useEffect(() => {
    const userId = currentUser?.id
    if (!isAuthenticated || !userId) return

    let active = true
    const sessionKey =
      sessionStorage.getItem(PRESENCE_SESSION_KEY_STORAGE) ??
      (typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `presence-${Math.random().toString(36).slice(2, 10)}`)
    sessionStorage.setItem(PRESENCE_SESSION_KEY_STORAGE, sessionKey)

    const pushPresence = async (online: boolean) => {
      if (!active) return
      await supabase
        .from('user_presence_sessions')
        .upsert({
          session_key: sessionKey,
          user_id: userId,
          is_online: online,
          last_seen_at: new Date().toISOString(),
          user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        }, { onConflict: 'session_key' })
    }

    void pushPresence(true)

    const heartbeat = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void pushPresence(true)
      }
    }, HEARTBEAT_MS)

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void pushPresence(true)
      }
    }

    const onBeforeUnload = () => {
      void pushPresence(false)
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('beforeunload', onBeforeUnload)

    return () => {
      active = false
      window.clearInterval(heartbeat)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('beforeunload', onBeforeUnload)
      void supabase
        .from('user_presence_sessions')
        .upsert({
          session_key: sessionKey,
          user_id: userId,
          is_online: false,
          last_seen_at: new Date().toISOString(),
          user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        }, { onConflict: 'session_key' })
    }
  }, [currentUser?.id, isAuthenticated])
}
