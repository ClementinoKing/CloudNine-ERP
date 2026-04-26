const PENDING_TASK_MODAL_KEY = 'contas.pending-task-details-id'

export function openTaskDetailsModal(taskId: string) {
  if (!taskId) return
  sessionStorage.setItem(PENDING_TASK_MODAL_KEY, taskId)
  window.dispatchEvent(new CustomEvent('contas:open-task-modal', { detail: { taskId } }))
}

export function consumePendingTaskDetailsModalId() {
  const taskId = sessionStorage.getItem(PENDING_TASK_MODAL_KEY)
  if (!taskId) return null
  sessionStorage.removeItem(PENDING_TASK_MODAL_KEY)
  return taskId
}

export function peekPendingTaskDetailsModalId() {
  return sessionStorage.getItem(PENDING_TASK_MODAL_KEY)
}
