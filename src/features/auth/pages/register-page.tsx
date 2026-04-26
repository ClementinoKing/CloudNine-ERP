import { zodResolver } from '@hookform/resolvers/zod'
import { UserPlus } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { useAuth } from '../context/auth-context'
import { AuthInputGroup } from '../components/auth-input-group'
import { AuthLayout } from '../components/auth-layout'

const registerSchema = z
  .object({
    name: z.string().min(2, 'Name must be at least 2 characters'),
    email: z.email('Enter a valid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(8, 'Confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  })

type RegisterFormValues = z.infer<typeof registerSchema>

export function RegisterPage() {
  const { register: registerAccount } = useAuth()
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      confirmPassword: '',
    },
  })

  const onSubmit = async (values: RegisterFormValues) => {
    setSubmitting(true)
    try {
      await registerAccount({
        name: values.name,
        email: values.email,
        password: values.password,
      })
      navigate('/dashboard/home', { replace: true })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout title='Create your organization' subtitle='Set up your account to organize projects, goals, and delivery.'>
      <form className='space-y-4' onSubmit={handleSubmit(onSubmit)}>
        <AuthInputGroup label='Full name' htmlFor='name' error={errors.name?.message}>
          <Input id='name' type='text' autoComplete='name' placeholder='Alex Johnson' {...register('name')} />
        </AuthInputGroup>

        <AuthInputGroup label='Email' htmlFor='email' error={errors.email?.message}>
          <Input id='email' type='email' autoComplete='email' placeholder='name@company.com' {...register('email')} />
        </AuthInputGroup>

        <AuthInputGroup label='Password' htmlFor='password' error={errors.password?.message}>
          <Input id='password' type='password' autoComplete='new-password' placeholder='Create a password' {...register('password')} />
        </AuthInputGroup>

        <AuthInputGroup label='Confirm password' htmlFor='confirmPassword' error={errors.confirmPassword?.message}>
          <Input
            id='confirmPassword'
            type='password'
            autoComplete='new-password'
            placeholder='Re-enter your password'
            {...register('confirmPassword')}
          />
        </AuthInputGroup>

        <Button className='w-full' type='submit' disabled={submitting}>
          <UserPlus className='h-4 w-4' aria-hidden='true' />
          {submitting ? 'Creating account...' : 'Create account'}
        </Button>
      </form>

      <p className='mt-6 text-sm text-muted-foreground'>
        Already have an account?{' '}
        <Link className='font-medium text-primary hover:underline' to='/login'>
          Sign in
        </Link>
      </p>
    </AuthLayout>
  )
}
