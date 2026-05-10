import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft, KeyRound } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { STORAGE_KEYS } from '@/lib/storage'
import { notify } from '@/lib/notify'
import { supabase } from '@/lib/supabase'

import { AuthInputGroup } from '../components/auth-input-group'
import { AuthLayout } from '../components/auth-layout'
import { useAuth } from '../context/auth-context'

const resetSchema = z
  .object({
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(8, 'Confirm your password'),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

type ResetFormValues = z.infer<typeof resetSchema>

type ProfileOrganizationContext = {
  organization_id: string | null
  active_organization_id: string | null
}

function getMetadataObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

async function resolveProfileOrganizationContext(userId: string): Promise<ProfileOrganizationContext> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, active_organization_id')
    .eq('id', userId)
    .maybeSingle()

  if (profile?.organization_id) {
    return {
      organization_id: profile.organization_id,
      active_organization_id: profile.active_organization_id ?? profile.organization_id,
    }
  }

  const { data: membership } = await supabase
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  return {
    organization_id: membership?.organization_id ?? null,
    active_organization_id: membership?.organization_id ?? null,
  }
}

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const { currentUser, updateCurrentUser } = useAuth()
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const mustResetBeforeContinuing = Boolean(currentUser?.mustResetPassword) && sessionStorage.getItem(STORAGE_KEYS.passwordRecoveryActive) !== 'true'

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetFormValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: {
      password: '',
      confirmPassword: '',
    },
  })

  const onSubmit = async (values: ResetFormValues) => {
    if (!currentUser?.id) {
      setFormError('Your reset session is no longer active. Please request a new password reset link.')
      return
    }
    setSubmitting(true)
    setFormError(null)

    const organizationContext = await resolveProfileOrganizationContext(currentUser.id)
    const completesInvitedUserOnboarding = Boolean(currentUser.mustResetPassword && organizationContext.organization_id)
    const { data: authUserResult } = await supabase.auth.getUser()
    const currentMetadata = authUserResult.user?.user_metadata ?? {}
    const currentMetadataOnboarding = getMetadataObject(currentMetadata.onboarding)
    const completedInvitationOnboarding = organizationContext.organization_id
      ? {
          ...(currentUser.onboarding ?? {
            completed: false,
            currentStep: 'organization' as const,
            fullName: currentUser.name,
            organizationId: organizationContext.organization_id,
            organizationName: '',
            organizationIndustry: '',
            role: '',
            workFunction: '',
            useCase: '',
            tools: [],
          }),
          completed: true,
          currentStep: 'tools' as const,
          organizationId: organizationContext.active_organization_id ?? organizationContext.organization_id,
        }
      : undefined

    const { error: updateAuthError } = await supabase.auth.updateUser({
      password: values.password,
      data: {
        ...currentMetadata,
        ...(organizationContext.organization_id ? { organization_id: organizationContext.organization_id } : {}),
        ...(completesInvitedUserOnboarding && completedInvitationOnboarding
          ? {
              onboarding: {
                ...currentMetadataOnboarding,
                completed: true,
                currentStep: 'tools',
                organizationId: completedInvitationOnboarding.organizationId,
                organizationName: completedInvitationOnboarding.organizationName,
                fullName: completedInvitationOnboarding.fullName,
              },
            }
          : {}),
        must_reset_password: false,
      },
    })

    if (updateAuthError) {
      setFormError(updateAuthError.message)
      setSubmitting(false)
      return
    }

    const { error: updateProfileError } = await supabase
      .from('profiles')
      .update({
        must_reset_password: false,
        ...(organizationContext.organization_id
          ? {
              organization_id: organizationContext.organization_id,
              active_organization_id: organizationContext.active_organization_id ?? organizationContext.organization_id,
            }
          : {}),
        ...(completesInvitedUserOnboarding
          ? {
              onboarding_completed: true,
              onboarding_step: 'tools',
            }
          : {}),
      })
      .eq('id', currentUser.id)

    if (updateProfileError) {
      setFormError(updateProfileError.message)
      setSubmitting(false)
      return
    }

    sessionStorage.removeItem(STORAGE_KEYS.passwordRecoveryActive)
    updateCurrentUser({
      mustResetPassword: false,
      ...(completesInvitedUserOnboarding && completedInvitationOnboarding ? { onboarding: completedInvitationOnboarding } : {}),
    })
    notify.success('Password updated', {
      description: 'Your new password is ready to use.',
    })
    navigate('/dashboard/home', { replace: true })
  }

  return (
    <AuthLayout
      title='Reset your password'
      subtitle={
        mustResetBeforeContinuing
          ? 'You must change your temporary password before continuing.'
          : 'Choose a new password for your account. You can keep using CloudNine while this session is active.'
      }
    >
      {!mustResetBeforeContinuing ? (
        <Link className='mb-5 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline' to='/dashboard/home'>
          <ArrowLeft className='h-4 w-4' aria-hidden='true' />
          Back to dashboard
        </Link>
      ) : null}
      <form className='space-y-4' onSubmit={handleSubmit(onSubmit)}>
        <AuthInputGroup label='New password' htmlFor='password' error={errors.password?.message}>
          <Input id='password' type='password' autoComplete='new-password' placeholder='Enter a secure password' {...register('password')} />
        </AuthInputGroup>

        <AuthInputGroup label='Confirm password' htmlFor='confirmPassword' error={errors.confirmPassword?.message}>
          <Input
            id='confirmPassword'
            type='password'
            autoComplete='new-password'
            placeholder='Confirm your password'
            {...register('confirmPassword')}
          />
        </AuthInputGroup>

        {formError ? <p className='text-sm text-destructive'>{formError}</p> : null}

        <Button className='w-full' type='submit' disabled={submitting}>
          <KeyRound className='h-4 w-4' aria-hidden='true' />
          {submitting ? 'Updating password...' : 'Update password'}
        </Button>
      </form>
    </AuthLayout>
  )
}
