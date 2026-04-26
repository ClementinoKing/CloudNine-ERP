import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export function AuthInputGroup({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string
  htmlFor: string
  error?: string
  children: ReactNode
}) {
  return (
    <div className='space-y-2'>
      <label htmlFor={htmlFor} className='text-sm font-medium text-foreground'>
        {label}
      </label>
      {children}
      <p className={cn('min-h-5 text-xs text-destructive', !error && 'invisible')}>{error ?? 'No error'}</p>
    </div>
  )
}
