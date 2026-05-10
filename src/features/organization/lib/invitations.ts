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

type InviteResponseStatus = 'available' | 'invited' | 'already_invited' | 'email_taken' | 'error'

type InviteResponse = {
  ok?: boolean
  status?: InviteResponseStatus
  message?: string
  invitationId?: string
  [key: string]: unknown
}

export type InviteMemberPayload = {
  organizationId: string
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

export type InviteEmailAvailabilityResult = {
  email: string
  available: boolean
  status: Exclude<InviteResponseStatus, 'invited'>
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
  const { data, error } = await invokeAdminInvite<InviteResponse>(
    {
      action: 'invite',
      organizationId: payload.organizationId,
      email: payload.email,
      role: payload.role,
      fullName: payload.fullName,
      jobTitle: payload.jobTitle,
      department: payload.department,
      projectIds: payload.projectIds,
    },
    preferredToken,
  )

  if (error || data?.ok === false) {
    return {
      email: payload.email,
      ok: false,
      status: data?.status ?? 'error',
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

type AdminInvitePayload = {
  action: 'invite' | 'list' | 'resend' | 'revoke' | 'check_email'
  organizationId: string
  invitationId?: string
  email?: string
  role?: InvitationRole
  fullName?: string
  jobTitle?: string
  department?: string
  projectIds?: string[]
}

type AdminInviteInvokeResult<T> = {
  data: T | null
  error: Error | null
}

export async function invokeAdminInvite<T extends Record<string, unknown>>(
  payload: AdminInvitePayload,
  preferredToken?: string | null,
): Promise<AdminInviteInvokeResult<T>> {
  const headers = await getAdminFunctionHeaders(preferredToken)
  if (!headers) {
    return {
      data: null,
      error: new Error('Your session expired. Sign in again and retry.'),
    }
  }

  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-invite`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      ...headers,
    },
    body: JSON.stringify(payload),
  })

  const rawText = await response.text()
  let parsed: T | null = null

  if (rawText) {
    try {
      parsed = JSON.parse(rawText) as T
    } catch {
      parsed = null
    }
  }

  if (!response.ok) {
    const message =
      (parsed && typeof parsed.message === 'string' ? parsed.message : null) ??
      (rawText.trim() || `admin-invite failed with status ${response.status}`)

    return {
      data: parsed,
      error: new Error(message),
    }
  }

  return {
    data: parsed,
    error: null,
  }
}

export async function checkInviteEmailAvailability(
  email: string,
  organizationId: string,
): Promise<InviteEmailAvailabilityResult> {
  const normalizedEmail = email.trim().toLowerCase()

  if (!organizationId) {
    return {
      email: normalizedEmail,
      available: false,
      status: 'error',
      message: 'Select an organization before checking email availability.',
    }
  }

  const { data: pendingInvitation, error: invitationError } = await supabase
    .from('organization_invitations')
    .select('id')
    .eq('organization_id', organizationId)
    .ilike('email', normalizedEmail)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (invitationError) {
    return {
      email: normalizedEmail,
      available: false,
      status: 'error',
      message: invitationError.message,
    }
  }

  if (pendingInvitation?.id) {
    return {
      email: normalizedEmail,
      available: false,
      status: 'already_invited',
      message: 'This email address already has a pending invitation.',
      invitationId: pendingInvitation.id,
    }
  }

  const { data: existingProfile, error: profileError } = await supabase
    .from('profiles')
    .select('id')
    .ilike('email', normalizedEmail)
    .limit(1)
    .maybeSingle()

  if (profileError) {
    return {
      email: normalizedEmail,
      available: false,
      status: 'error',
      message: profileError.message,
    }
  }

  if (existingProfile?.id) {
    return {
      email: normalizedEmail,
      available: false,
      status: 'email_taken',
      message: 'This email address has already been taken.',
    }
  }

  return {
    email: normalizedEmail,
    available: true,
    status: 'available',
    message: 'Email address is available.',
  }
}
