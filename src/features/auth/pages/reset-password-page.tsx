import { zodResolver } from '@hookform/resolvers/zod'
import { KeyRound } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const { currentUser, updateCurrentUser } = useAuth()
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

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
    if (!currentUser?.id) return
    setSubmitting(true)
    setFormError(null)

    const { error: updateAuthError } = await supabase.auth.updateUser({
      password: values.password,
      data: {
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
      .update({ must_reset_password: false })
      .eq('id', currentUser.id)

    if (updateProfileError) {
      setFormError(updateProfileError.message)
      setSubmitting(false)
      return
    }

    updateCurrentUser({ mustResetPassword: false })
    navigate('/dashboard/home', { replace: true })
  }

  return (
    <AuthLayout title='Reset your password' subtitle='You must change your temporary password before continuing.'>
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
