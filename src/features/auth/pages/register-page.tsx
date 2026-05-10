import { zodResolver } from '@hookform/resolvers/zod'
import { Eye, EyeOff, Mail, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router-dom'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { notify } from '@/lib/notify'

import { AuthInputGroup } from '../components/auth-input-group'
import { AuthLayout } from '../components/auth-layout'
import { SocialAuthButtons } from '../components/social-auth-buttons'
import { useAuth } from '../context/auth-context'

const registerSchema = z
  .object({
    email: z.email('Enter a valid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(8, 'Confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  })

type RegisterFormValues = z.infer<typeof registerSchema>

function EmailSentConfirmation({ email }: { email: string }) {
  return (
    <AuthLayout title='Check your email' subtitle='One more step before you can sign in.'>
      <div className='flex flex-col items-center gap-5 py-2 text-center'>
        <div className='flex h-16 w-16 items-center justify-center rounded-full bg-primary/10'>
          <Mail className='h-8 w-8 text-primary' aria-hidden='true' />
        </div>
        <div className='space-y-2'>
          <p className='text-sm text-foreground'>We sent a confirmation link to</p>
          <p className='rounded-lg bg-muted px-4 py-2 text-sm font-semibold text-foreground break-all'>
            {email}
          </p>
          <p className='text-sm text-muted-foreground'>
            Click the link in that email to activate your account, then sign in to complete your profile setup.
          </p>
        </div>
        <p className='text-xs text-muted-foreground'>
          Didn't receive it? Check your spam folder or{' '}
          <Link className='font-medium text-primary hover:underline' to='/register'>
            try again
          </Link>
          .
        </p>
        <Link className='mt-1 w-full' to='/login'>
          <Button variant='outline' className='w-full'>
            Back to sign in
          </Button>
        </Link>
      </div>
    </AuthLayout>
  )
}

export function RegisterPage() {
  const { register: registerAccount } = useAuth()
  const [submitting, setSubmitting] = useState(false)
  const [confirmedEmail, setConfirmedEmail] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    mode: 'onTouched',
    defaultValues: { email: '', password: '', confirmPassword: '' },
  })

  const onSubmit = async (values: RegisterFormValues) => {
    setSubmitting(true)
    try {
      await registerAccount({ email: values.email, password: values.password })
      // If email confirmation is disabled, registerAccount sets a session and
      // the route guard will redirect to onboarding automatically.
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create your account. Please try again.'

      if (message === 'email_confirmation_required') {
        setConfirmedEmail(values.email)
        return
      }

      notify.error('Account creation failed', { description: message })
    } finally {
      setSubmitting(false)
    }
  }

  if (confirmedEmail) {
    return <EmailSentConfirmation email={confirmedEmail} />
  }

  return (
    <AuthLayout title='Create your account' subtitle='Enter your email and choose a password to get started.'>
      <form className='space-y-3' onSubmit={handleSubmit(onSubmit)}>
        <AuthInputGroup label='Email' htmlFor='email' error={errors.email?.message}>
          <Input id='email' type='email' autoComplete='email' placeholder='name@company.com' {...register('email')} />
        </AuthInputGroup>

        <AuthInputGroup label='Password' htmlFor='password' error={errors.password?.message}>
          <div className='relative'>
            <Input
              id='password'
              type={showPassword ? 'text' : 'password'}
              autoComplete='new-password'
              placeholder='Create a password'
              className='pr-12'
              {...register('password')}
            />
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className='absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground hover:bg-accent hover:text-foreground'
              onClick={() => setShowPassword((current) => !current)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
            >
              {showPassword ? <EyeOff className='h-4 w-4' aria-hidden='true' /> : <Eye className='h-4 w-4' aria-hidden='true' />}
            </Button>
          </div>
        </AuthInputGroup>

        <AuthInputGroup label='Confirm password' htmlFor='confirmPassword' error={errors.confirmPassword?.message}>
          <div className='relative'>
            <Input
              id='confirmPassword'
              type={showConfirmPassword ? 'text' : 'password'}
              autoComplete='new-password'
              placeholder='Re-enter your password'
              className='pr-12'
              {...register('confirmPassword')}
            />
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className='absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground hover:bg-accent hover:text-foreground'
              onClick={() => setShowConfirmPassword((current) => !current)}
              aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
              aria-pressed={showConfirmPassword}
            >
              {showConfirmPassword ? <EyeOff className='h-4 w-4' aria-hidden='true' /> : <Eye className='h-4 w-4' aria-hidden='true' />}
            </Button>
          </div>
        </AuthInputGroup>

        <Button className='w-full' type='submit' disabled={submitting}>
          <UserPlus className='h-4 w-4' aria-hidden='true' />
          {submitting ? 'Creating account...' : 'Create account'}
        </Button>
      </form>

      <div className='mt-6'>
        <SocialAuthButtons intent='signup' disabled={submitting} />
      </div>

      <p className='mt-6 text-center text-sm text-muted-foreground'>
        Already have an account?{' '}
        <Link className='font-medium text-primary hover:underline' to='/login'>
          Sign in
        </Link>
      </p>
    </AuthLayout>
  )
}
