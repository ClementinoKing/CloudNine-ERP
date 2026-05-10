import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft, MailCheck, Send } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router-dom'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { notify } from '@/lib/notify'

import { AuthInputGroup } from '../components/auth-input-group'
import { AuthLayout } from '../components/auth-layout'
import { useAuth } from '../context/auth-context'

const forgotPasswordSchema = z.object({
  email: z.email('Enter a valid email address'),
})

type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>

export function ForgotPasswordPage() {
  const { sendPasswordResetEmail } = useAuth()
  const [submitting, setSubmitting] = useState(false)
  const [sentEmail, setSentEmail] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: '',
    },
  })

  const onSubmit = async (values: ForgotPasswordFormValues) => {
    setSubmitting(true)
    try {
      await sendPasswordResetEmail(values.email)
      setSentEmail(values.email)
      notify.success('Reset link sent', {
        description: 'If the email exists, a secure reset link is on its way.',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to send the reset link. Please try again.'
      notify.error('Reset email failed', { description: message })
    } finally {
      setSubmitting(false)
    }
  }

  if (sentEmail) {
    return (
      <AuthLayout title='Check your email' subtitle='Use the secure link to choose a new password.'>
        <div className='flex flex-col items-center gap-5 py-2 text-center'>
          <div className='flex h-16 w-16 items-center justify-center rounded-full bg-primary/10'>
            <MailCheck className='h-8 w-8 text-primary' aria-hidden='true' />
          </div>
          <div className='space-y-2'>
            <p className='text-sm text-foreground'>We sent password reset instructions to</p>
            <p className='break-all rounded-lg bg-muted px-4 py-2 text-sm font-semibold text-foreground'>{sentEmail}</p>
            <p className='text-sm text-muted-foreground'>
              The link opens a secure password update screen. If you are already signed in, you can still continue using the app.
            </p>
          </div>
          <Link className='w-full' to='/login'>
            <Button variant='outline' className='w-full'>
              <ArrowLeft className='h-4 w-4' aria-hidden='true' />
              Back to sign in
            </Button>
          </Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title='Reset your password' subtitle='Enter your email and we will send a secure reset link.'>
      <form className='space-y-4' onSubmit={handleSubmit(onSubmit)}>
        <AuthInputGroup label='Email' htmlFor='email' error={errors.email?.message}>
          <Input id='email' type='email' autoComplete='email' placeholder='name@company.com' {...register('email')} />
        </AuthInputGroup>

        <Button className='w-full' type='submit' disabled={submitting}>
          <Send className='h-4 w-4' aria-hidden='true' />
          {submitting ? 'Sending reset link...' : 'Send reset link'}
        </Button>
      </form>

      <Link className='mt-6 flex items-center justify-center gap-2 text-sm font-medium text-primary hover:underline' to='/login'>
        <ArrowLeft className='h-4 w-4' aria-hidden='true' />
        Back to sign in
      </Link>
    </AuthLayout>
  )
}
