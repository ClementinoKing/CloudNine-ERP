import { createClient } from 'npm:@supabase/supabase-js'
import { CLOUDNINE_BRAND, renderInviteEmail, sendResendEmail } from '../_shared/email.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type InviteRole = 'owner' | 'admin' | 'member' | 'viewer'
type InviteAction = 'invite' | 'list' | 'resend' | 'revoke' | 'check_email'

type InvitePayload = {
  action: InviteAction
  organizationId?: string
  invitationId?: string
  email?: string
  fullName?: string
  jobTitle?: string
  department?: string
  role?: InviteRole
  projectIds?: string[]
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const RESEND_FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') ?? ''
const TEMP_PASSWORD = '12345678'
const FALLBACK_APP_BASE_URL = 'https://cloudninetech.co.za'

function getAppBaseUrl() {
  return (Deno.env.get('APP_BASE_URL') ?? FALLBACK_APP_BASE_URL).replace(/\/+$/, '')
}

function loginUrl() {
  return `${getAppBaseUrl()}/`
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function isAlreadyExistsError(message: string) {
  return /already been registered|already exists|already invited|user already exists|duplicate/i.test(message)
}

function isMissingColumnError(message: string) {
  return /column .* does not exist|Could not find the .* column|schema cache/i.test(message)
}

function emailTakenResponse(email: string) {
  return json({
    ok: false,
    status: 'email_taken',
    email,
    message: 'This email address has already been taken.',
  })
}

async function updateInvitationDelivery(
  serviceClient: ReturnType<typeof createClient>,
  invitationId: string,
  updates: Record<string, unknown>,
) {
  const { error } = await serviceClient
    .from('organization_invitations')
    .update(updates)
    .eq('id', invitationId)

  if (error) {
    console.error('Failed to update invitation delivery state', {
      invitationId,
      updates,
      error: error.message,
    })
  }
}

async function upsertInvitedProfile(
  serviceClient: ReturnType<typeof createClient>,
  input: {
    id: string
    organizationId: string
    fullName: string
    email: string
    role: InviteRole
    jobTitle: string
    department: string
  },
) {
  const baseProfile = {
    id: input.id,
    organization_id: input.organizationId,
    active_organization_id: input.organizationId,
    full_name: input.fullName,
    username: input.fullName
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9._-]/g, ''),
    email: input.email,
    role_label: input.role,
    job_title: input.jobTitle,
    department: input.department,
    onboarding_completed: true,
    onboarding_step: 'tools',
  }

  const profileWithReset = {
    ...baseProfile,
    must_reset_password: true,
  }

  let result = await serviceClient.from('profiles').upsert(profileWithReset)
  if (!result.error || !isMissingColumnError(result.error.message)) {
    return result
  }

  console.warn('profiles upsert fallback without must_reset_password', { message: result.error.message })
  result = await serviceClient.from('profiles').upsert(baseProfile)
  return result
}

async function createInvitationRecord(
  serviceClient: ReturnType<typeof createClient>,
  input: {
    organizationId: string
    email: string
    role: InviteRole
    invitedBy: string
    invitedUserId: string
    fullName: string
    jobTitle: string
    department: string
    projectIds: string[]
  },
) {
  const basePayload = {
    organization_id: input.organizationId,
    email: input.email,
    role: input.role,
    invited_by: input.invitedBy,
    status: 'pending',
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  }

  const payloadWithInvitedUser = {
    ...basePayload,
    invited_user_id: input.invitedUserId,
  }

  const payloadWithMetadata = {
    ...payloadWithInvitedUser,
    metadata: {
      full_name: input.fullName,
      job_title: input.jobTitle,
      department: input.department,
      project_ids: input.projectIds,
      invited_via: 'admin-invite',
      app_base_url: getAppBaseUrl(),
    },
  }

  let result = await serviceClient
    .from('organization_invitations')
    .insert(payloadWithMetadata)
    .select('id')
    .single()

  if (!result.error || !isMissingColumnError(result.error.message)) {
    return result
  }

  console.warn('organization_invitations insert fallback without metadata', { message: result.error.message })
  result = await serviceClient
    .from('organization_invitations')
    .insert(payloadWithInvitedUser)
    .select('id')
    .single()

  if (!result.error || !isMissingColumnError(result.error.message)) {
    return result
  }

  console.warn('organization_invitations insert fallback without invited_user_id', { message: result.error.message })
  result = await serviceClient
    .from('organization_invitations')
    .insert(basePayload)
    .select('id')
    .single()

  return result
}

async function checkEmailAvailability(
  serviceClient: ReturnType<typeof createClient>,
  organizationId: string,
  email: string,
) {
  const { data: existingPending, error: pendingError } = await serviceClient
    .from('organization_invitations')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('email', email)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (pendingError) {
    return json({ ok: false, status: 'error', message: pendingError.message }, 500)
  }

  if (existingPending?.id) {
    return json({
      ok: false,
      status: 'already_invited',
      invitationId: existingPending.id,
      email,
      message: 'This email address already has a pending invitation.',
    })
  }

  const { data: existingProfile, error: profileError } = await serviceClient
    .from('profiles')
    .select('id')
    .ilike('email', email)
    .maybeSingle()

  if (profileError) {
    return json({ ok: false, status: 'error', message: profileError.message }, 500)
  }

  if (existingProfile?.id) {
    return emailTakenResponse(email)
  }

  return json({
    ok: true,
    status: 'available',
    email,
    message: 'Email address is available.',
  })
}

async function sendResendInviteEmail(input: {
  to: string
  invitedByName: string
  fullName: string
  organizationName: string
  role: InviteRole
}) {
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
    throw new Error('Missing RESEND_API_KEY or RESEND_FROM_EMAIL.')
  }

  const appUrl = loginUrl()
  return sendResendEmail({
    apiKey: RESEND_API_KEY,
    from: RESEND_FROM_EMAIL,
    to: input.to,
    subject: `You have been invited to ${input.organizationName} on ${CLOUDNINE_BRAND.name}`,
    html: renderInviteEmail({
      invitedByName: input.invitedByName,
      fullName: input.fullName,
      organizationName: input.organizationName,
      role: input.role,
      appUrl,
      temporaryPassword: TEMP_PASSWORD,
    }),
  })
}

async function requireAdmin(req: Request, organizationId: string) {
  const authorization = req.headers.get('Authorization') ?? ''
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i)
  const accessToken = tokenMatch?.[1]?.trim() ?? ''
  if (!accessToken) {
    return { error: json({ ok: false, status: 'error', message: 'Missing bearer token.' }, 401) }
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return { error: json({ ok: false, status: 'error', message: 'Missing Supabase environment variables.' }, 500) }
  }

  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  })

  const { data: authData, error: authError } = await authClient.auth.getUser(accessToken)
  if (authError || !authData.user) {
    return { error: json({ ok: false, status: 'error', message: authError?.message ?? 'Unauthorized.' }, 401) }
  }

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data: profile, error: profileError } = await serviceClient
    .from('profiles')
    .select('id, full_name, email')
    .eq('id', authData.user.id)
    .maybeSingle()

  if (profileError) {
    return { error: json({ ok: false, status: 'error', message: profileError.message }, 500) }
  }

  const { data: membership, error: membershipError } = await serviceClient
    .from('organization_members')
    .select('organization_id, role')
    .eq('user_id', authData.user.id)
    .eq('organization_id', organizationId)
    .in('role', ['owner', 'admin'])
    .maybeSingle()

  if (membershipError) {
    return { error: json({ ok: false, status: 'error', message: membershipError.message }, 500) }
  }

  if (!membership?.organization_id) {
    return { error: json({ ok: false, status: 'error', message: 'Admin or owner access is required for this organization.' }, 403) }
  }

  const { data: organization, error: organizationError } = await serviceClient
    .from('organizations')
    .select('id, name')
    .eq('id', organizationId)
    .maybeSingle()

  if (organizationError) {
    return { error: json({ ok: false, status: 'error', message: organizationError.message }, 500) }
  }

  if (!organization?.id) {
    return { error: json({ ok: false, status: 'error', message: 'Organization not found.' }, 404) }
  }

  return {
    serviceClient,
    user: {
      id: authData.user.id,
      fullName: profile?.full_name ?? authData.user.email ?? 'Admin',
      organizationId,
      organizationName: organization.name?.trim() || 'Your organization',
      membershipRole: membership.role as InviteRole,
    },
  }
}

Deno.serve(async (req) => {
  let stage = 'request:start'

  try {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders })
    }

    if (req.method !== 'POST') {
      return json({ ok: false, status: 'error', message: 'Method not allowed.' }, 405)
    }

    stage = 'request:parse-json'
    let payload: InvitePayload
    try {
      payload = (await req.json()) as InvitePayload
    } catch {
      return json({ ok: false, status: 'error', message: 'Invalid JSON payload.' }, 400)
    }

    const action = payload.action
    if (!action) {
      return json({ ok: false, status: 'error', message: 'Missing action.' }, 400)
    }

    const organizationId = payload.organizationId?.trim() ?? ''
    if (!organizationId) {
      return json({ ok: false, status: 'error', message: 'Missing organizationId.' }, 400)
    }

    stage = 'auth:require-admin'
    const adminCheck = await requireAdmin(req, organizationId)
    if ('error' in adminCheck) return adminCheck.error

    const { serviceClient, user } = adminCheck

    if (action === 'list') {
      stage = 'invite:list'
      const { data, error } = await serviceClient
        .from('organization_invitations')
        .select('id, email, role, status, created_at, expires_at')
        .eq('organization_id', user.organizationId)
        .order('created_at', { ascending: false })
        .limit(200)

      if (error) return json({ ok: false, status: 'error', message: error.message }, 500)

      return json({
        ok: true,
        status: 'invited',
        invitations: (data ?? []).map((row) => ({
          id: row.id,
          email: row.email,
          role: row.role,
          status: row.status,
          createdAt: row.created_at,
          expiresAt: row.expires_at,
        })),
      })
    }

    if (action === 'revoke') {
      stage = 'invite:revoke'
      if (!payload.invitationId) return json({ ok: false, status: 'error', message: 'Missing invitationId.' }, 400)
      const { data, error } = await serviceClient
        .from('organization_invitations')
        .update({ status: 'revoked', revoked_at: new Date().toISOString() })
        .eq('id', payload.invitationId)
        .eq('organization_id', user.organizationId)
        .select('id')
        .maybeSingle()

      if (error) return json({ ok: false, status: 'error', message: error.message }, 500)
      if (!data) return json({ ok: false, status: 'error', message: 'Invitation not found.' }, 404)
      return json({ ok: true, status: 'invited', invitationId: data.id, message: 'Invitation revoked.' })
    }

    if (action === 'resend') {
      stage = 'invite:resend:load'
      if (!payload.invitationId) return json({ ok: false, status: 'error', message: 'Missing invitationId.' }, 400)
      const { data: invitation, error: invitationError } = await serviceClient
        .from('organization_invitations')
        .select('id, email, role, status, metadata')
        .eq('id', payload.invitationId)
        .eq('organization_id', user.organizationId)
        .maybeSingle()

      if (invitationError) return json({ ok: false, status: 'error', message: invitationError.message }, 500)
      if (!invitation) return json({ ok: false, status: 'error', message: 'Invitation not found.' }, 404)

      const fullName = (invitation.metadata as { full_name?: string } | null)?.full_name?.trim()
      if (!fullName) {
        return json({ ok: false, status: 'error', message: 'Invitation record missing full_name.' }, 400)
      }

      try {
        stage = 'invite:resend:send-email'
        const sent = await sendResendInviteEmail({
          to: invitation.email,
          invitedByName: user.fullName,
          fullName,
          organizationName: user.organizationName,
          role: invitation.role as InviteRole,
        })

        stage = 'invite:resend:update-delivery'
        await updateInvitationDelivery(serviceClient, invitation.id, {
          status: invitation.status === 'revoked' ? 'pending' : invitation.status,
          delivery_status: 'sent',
          delivery_error: null,
          resend_message_id: sent.id,
          last_sent_at: new Date().toISOString(),
          invited_by: user.id,
        })

        return json({ ok: true, status: 'invited', invitationId: invitation.id, message: 'Invite resent.' })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to send invite email.'
        stage = 'invite:resend:email-failed'
        await updateInvitationDelivery(serviceClient, invitation.id, {
          delivery_status: 'failed',
          delivery_error: message,
        })
        return json({ ok: false, status: 'error', invitationId: invitation.id, message }, 502)
      }
    }

    const email = payload.email ? normalizeEmail(payload.email) : ''

    if (action === 'check_email') {
      stage = 'invite:check-email'
      if (!email || !isEmail(email)) {
        return json({ ok: false, status: 'error', message: 'A valid email is required.' }, 400)
      }

      return checkEmailAvailability(serviceClient, user.organizationId, email)
    }

    const role = payload.role ?? 'member'
    const projectIds = Array.isArray(payload.projectIds) ? payload.projectIds.filter(Boolean) : []
    const fullName = payload.fullName?.trim() ?? ''
    const jobTitle = payload.jobTitle?.trim() ?? ''
    const department = payload.department?.trim() ?? ''

    if (!email || !isEmail(email)) {
      return json({ ok: false, status: 'error', message: 'A valid email is required.' }, 400)
    }
    if (!fullName) {
      return json({ ok: false, status: 'error', message: 'Full name is required.' }, 400)
    }
    if (!jobTitle) {
      return json({ ok: false, status: 'error', message: 'Job title is required.' }, 400)
    }
    if (!department) {
      return json({ ok: false, status: 'error', message: 'Department is required.' }, 400)
    }

    stage = 'invite:validate-department'
    const { data: departmentRecord, error: departmentError } = await serviceClient
      .from('departments')
      .select('id')
      .eq('organization_id', user.organizationId)
      .eq('name', department)
      .eq('is_active', true)
      .is('archived_at', null)
      .limit(1)
      .maybeSingle()

    if (departmentError || !departmentRecord?.id) {
      return json({ ok: false, status: 'error', message: 'Invalid department selected.' }, 400)
    }

    stage = 'invite:validate-job'
    const { data: jobRecord, error: jobError } = await serviceClient
      .from('jobs')
      .select('id')
      .eq('organization_id', user.organizationId)
      .eq('department_id', departmentRecord.id)
      .eq('name', jobTitle)
      .eq('is_active', true)
      .is('archived_at', null)
      .limit(1)
      .maybeSingle()

    if (jobError || !jobRecord?.id) {
      return json({ ok: false, status: 'error', message: 'Invalid job title selected.' }, 400)
    }

    stage = 'invite:check-availability'
    const availability = await checkEmailAvailability(serviceClient, user.organizationId, email)
    const availabilityPayload = await availability.clone().json() as { ok?: boolean }
    if (availabilityPayload.ok !== true) {
      return availability
    }

    stage = 'invite:create-auth-user'
    const createUserResult = await serviceClient.auth.admin.createUser({
      email,
      password: TEMP_PASSWORD,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        organization_id: user.organizationId,
        organization_name: user.organizationName,
        role_label: role,
        job_title: jobTitle,
        department,
        project_ids: projectIds,
        onboarding: {
          completed: true,
          currentStep: 'tools',
          fullName,
          organizationId: user.organizationId,
          organizationName: user.organizationName,
        },
        must_reset_password: true,
      },
    })

    if (createUserResult.error || !createUserResult.data.user) {
      if (createUserResult.error && isAlreadyExistsError(createUserResult.error.message)) {
        return emailTakenResponse(email)
      }
      return json({ ok: false, status: 'error', message: createUserResult.error?.message ?? 'Failed to create user.' }, 400)
    }

    const invitedUser = createUserResult.data.user

    stage = 'invite:upsert-profile'
    const { error: profileUpsertError } = await upsertInvitedProfile(serviceClient, {
      id: invitedUser.id,
      organizationId: user.organizationId,
      fullName,
      email,
      role,
      jobTitle,
      department,
    })

    if (profileUpsertError) {
      return json({ ok: false, status: 'error', message: profileUpsertError.message }, 500)
    }

    stage = 'invite:upsert-membership'
    const { error: membershipUpsertError } = await serviceClient.from('organization_members').upsert(
      {
        organization_id: user.organizationId,
        user_id: invitedUser.id,
        role,
      },
      { onConflict: 'organization_id,user_id' },
    )

    if (membershipUpsertError) {
      return json({ ok: false, status: 'error', message: membershipUpsertError.message }, 500)
    }

    stage = 'invite:create-record'
    const { data: invitation, error: invitationError } = await createInvitationRecord(serviceClient, {
      organizationId: user.organizationId,
      email,
      role,
      invitedBy: user.id,
      invitedUserId: invitedUser.id,
      fullName,
      jobTitle,
      department,
      projectIds,
    })

    if (invitationError || !invitation) {
      return json({ ok: false, status: 'error', message: invitationError?.message ?? 'Failed to create invitation record.' }, 500)
    }

    try {
      stage = 'invite:send-email'
      const sent = await sendResendInviteEmail({
        to: email,
        invitedByName: user.fullName,
        fullName,
        organizationName: user.organizationName,
        role,
      })

      stage = 'invite:update-delivery-sent'
      await updateInvitationDelivery(serviceClient, invitation.id, {
        delivery_status: 'sent',
        delivery_error: null,
        resend_message_id: sent.id,
        last_sent_at: new Date().toISOString(),
      })

      return json({ ok: true, status: 'invited', invitationId: invitation.id })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invite email failed.'
      stage = 'invite:update-delivery-failed'
      await updateInvitationDelivery(serviceClient, invitation.id, {
        delivery_status: 'failed',
        delivery_error: message,
      })

      return json({ ok: true, status: 'invited', invitationId: invitation.id, message: 'Invitation created but email delivery failed.' })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error.'
    console.error('admin-invite unexpected failure', { stage, message, error })
    return json({ ok: false, status: 'error', message: `Invite failed at ${stage}: ${message}` }, 500)
  }
})
