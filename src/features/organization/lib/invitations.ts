import { supabase } from '@/lib/supabase'

export type InvitationRole = 'owner' | 'admin' | 'member' | 'viewer'

export const INVITE_JOB_TITLES = [
  'Managing Director',
  'HR & Compliance Manager',
  'Accounting Manager',
  'Senior Accountant',
  'Junior Accountant',
  'Payroll and Regulatory Support Officer',
  'Junior Business Executive Officer',
] as const

export const INVITE_DEPARTMENTS = [
  'Executive Leadership',
  'Accounting & Financial Services',
  'Payroll & Regulatory Services',
  'Human Resources & Compliance',
  'Business Development & Client Services',
] as const

type InviteResponseStatus = 'invited' | 'already_invited' | 'error'

type InviteResponse = {
  ok?: boolean
  status?: InviteResponseStatus
  message?: string
  invitationId?: string
}

export type InviteMemberPayload = {
  email: string
  fullName: string
  jobTitle: string
  department: string
  role: InvitationRole
  projectIds: string[]
}

export type InviteMemberResult = {
  email: string
  ok: boolean
  status: InviteResponseStatus
  message: string
  invitationId?: string
}

export function splitEmails(input: string) {
  return input
    .split(/[\n,;]+/g)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export async function getAdminFunctionHeaders(preferredToken?: string | null) {
  if (preferredToken) {
    return { Authorization: `Bearer ${preferredToken}` }
  }

  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (session?.access_token) {
    return { Authorization: `Bearer ${session.access_token}` }
  }

  const { data: refreshed, error } = await supabase.auth.refreshSession()
  if (error || !refreshed.session?.access_token) {
    return null
  }

  return { Authorization: `Bearer ${refreshed.session.access_token}` }
}

export async function inviteOrganizationMember(
  payload: InviteMemberPayload,
  preferredToken?: string | null,
): Promise<InviteMemberResult> {
  const headers = await getAdminFunctionHeaders(preferredToken)
  if (!headers) {
    return {
      email: payload.email,
      ok: false,
      status: 'error',
      message: 'Your session expired. Sign in again and retry.',
    }
  }

  const { data, error } = await supabase.functions.invoke<InviteResponse>('admin-invite', {
    body: {
      action: 'invite',
      email: payload.email,
      role: payload.role,
      fullName: payload.fullName,
      jobTitle: payload.jobTitle,
      department: payload.department,
      projectIds: payload.projectIds,
    },
    headers,
  })

  if (error || data?.ok === false) {
    return {
      email: payload.email,
      ok: false,
      status: 'error',
      message: error?.message ?? data?.message ?? 'Invite could not be sent.',
      invitationId: data?.invitationId,
    }
  }

  return {
    email: payload.email,
    ok: true,
    status: data?.status ?? 'invited',
    message: data?.message ?? 'Invite sent.',
    invitationId: data?.invitationId,
  }
}
