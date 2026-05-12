import { supabase } from '@/lib/supabase'

export async function reassignTaskAssignees(taskIds: string[], assigneeIds: string[]) {
  return supabase.rpc('reassign_task_assignees', {
    p_task_ids: taskIds,
    p_assignee_ids: assigneeIds,
  })
}
