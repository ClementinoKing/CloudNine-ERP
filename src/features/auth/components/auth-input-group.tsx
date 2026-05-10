import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export function AuthInputGroup({
  label,
  htmlFor,
  error,
  action,
  children,
}: {
  label: string
  htmlFor: string
  error?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className='space-y-1.5'>
      <div className='flex items-center justify-between gap-3'>
        <label htmlFor={htmlFor} className='text-sm font-medium text-foreground'>
          {label}
        </label>
        {action}
      </div>
      {children}
      <p className={cn('min-h-4 text-xs text-destructive', !error && 'invisible')}>{error ?? 'No error'}</p>
    </div>
  )
}
