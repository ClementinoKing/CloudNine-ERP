import { useEffect } from 'react'

import { supabase } from '@/lib/supabase'

const REALTIME_TABLES = [
  'tasks',
  'projects',
  'notifications',
  'task_assignees',
  'task_comments',
  'status',
  'goals',
  'goal_key_results',
  'goal_checkins',
  'goal_links',
  'organization_timeline_events',
  'user_presence_sessions',
] as const

type RealtimePayload = {
  table: (typeof REALTIME_TABLES)[number]
  eventType: string
}

export function useAppRealtime() {
  useEffect(() => {
    const channel = supabase.channel('contas-app-realtime')

    for (const table of REALTIME_TABLES) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        (payload) => {
          window.dispatchEvent(
            new CustomEvent<RealtimePayload>('contas:realtime-change', {
              detail: { table, eventType: payload.eventType },
            }),
          )
        },
      )
    }

    channel.subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [])
}
