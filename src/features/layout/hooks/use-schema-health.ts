import { useEffect, useState } from 'react'

import { supabase } from '@/lib/supabase'

type SchemaCheck = {
  key: string
  query: string
}

type SchemaIssue = {
  key: string
  message: string
}

const REQUIRED_SCHEMA_CHECKS: SchemaCheck[] = [
  { key: 'status', query: 'id,project_id,key,label,sort_order,is_default,created_by' },
  { key: 'task_assignees', query: 'task_id,assignee_id,created_at' },
  { key: 'notifications', query: 'id,recipient_id,actor_id,task_id,type,title,message,read_at,created_at' },
  { key: 'projects', query: 'id,name,key,status,description,owner_id,start_date,end_date,created_by' },
  { key: 'tasks', query: 'id,title,status,status_id,board_column,assigned_to,created_by,due_at,start_at,completed_at' },
  { key: 'profiles', query: 'id,full_name,email' },
  { key: 'organization_timeline_events', query: 'id,title,event_type,starts_at' },
  { key: 'user_presence_sessions', query: 'session_key,user_id,is_online,last_seen_at' },
  { key: 'chat_rooms', query: 'id,slug,name,description,room_type,is_public,is_default,created_by,last_message_at' },
  { key: 'chat_room_members', query: 'id,room_id,user_id,member_role,last_read_at,created_at' },
  { key: 'chat_messages', query: 'id,room_id,author_id,body,reply_to_id,edited_at,deleted_at,created_at' },
  { key: 'chat_message_mentions', query: 'id,message_id,mentioned_user_id,created_at' },
  { key: 'chat_message_attachments', query: 'id,message_id,storage_bucket,storage_path,file_name,mime_type,file_size_bytes,attachment_kind,created_at' },
  { key: 'chat_room_typing_states', query: 'id,room_id,user_id,is_typing,created_at,updated_at' },
  { key: 'drive_folders', query: 'id,parent_id,owner_id,visibility,name,sort_order,deleted_at,created_by,created_at,updated_at' },
  { key: 'drive_documents', query: 'id,folder_id,owner_id,visibility,storage_bucket,storage_path,file_name,mime_type,file_size_bytes,sort_order,deleted_at,uploaded_by,created_at,updated_at' },
  { key: 'goals', query: 'id,title,owner_id,cycle,status,health,confidence,department,due_at' },
  { key: 'goal_key_results', query: 'id,goal_id,title,metric_type,current_value,target_value,due_at,owner_id,source' },
  { key: 'goal_checkins', query: 'id,goal_id,author_id,progress_delta,confidence,created_at' },
  { key: 'goal_links', query: 'id,goal_id,link_type,project_id,task_id,created_at' },
]

export function useSchemaHealth() {
  const [loading, setLoading] = useState(true)
  const [issues, setIssues] = useState<SchemaIssue[]>([])

  useEffect(() => {
    let cancelled = false

    void Promise.all(
      REQUIRED_SCHEMA_CHECKS.map(async (check) => {
        const { error } = await supabase.from(check.key).select(check.query).limit(1)
        if (!error) return null
        return {
          key: check.key,
          message: error.message,
        } satisfies SchemaIssue
      }),
    ).then((results) => {
      if (cancelled) return
      setIssues(results.filter((result): result is SchemaIssue => Boolean(result)))
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [])

  return {
    loading,
    hasIssues: issues.length > 0,
    issues,
  }
}
