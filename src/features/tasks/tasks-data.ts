export type TaskRow = {
  id: string
  parentTaskId?: string
  title: string
  description?: string
  createdById?: string
  owner: string
  assigneeIds: string[]
  due: string
  completed?: boolean
  status: string
  statusId?: string
  statusKey?: string
  priority: 'Low' | 'Medium' | 'High' | 'Urgent'
  boardColumn?: string
  recurrenceId?: string
  projectId: string
  projectName: string
  startDate: string
  endDate: string
}
