import { ArrowLeft, LogOut } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/context/auth-context'

export function OnboardingShell({
  title,
  subtitle,
  children,
  backTo,
}: {
  title: string
  subtitle: string
  children: ReactNode
  backTo?: string
}) {
  const navigate = useNavigate()
  const { logout } = useAuth()

  return (
    <main className='min-h-screen bg-muted/35'>
      <div className='fixed right-4 top-4 z-20 sm:right-6 sm:top-6'>
        <Button
          variant='outline'
          size='sm'
          className='gap-2 rounded-full bg-background/90 shadow-sm backdrop-blur'
          onClick={async () => {
            await logout()
            navigate('/login')
          }}
        >
          <LogOut className='h-4 w-4' />
          Log out
        </Button>
      </div>

      <div className='grid min-h-screen lg:grid-cols-[minmax(0,560px)_1fr]'>
        <section className='flex flex-col px-5 py-6 sm:px-8 lg:px-10'>
          <div className='mb-8 flex items-center justify-between'>
            <div className='space-y-0.5'>
              <p className='text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground'>Spryar Tech</p>
              <p className='text-sm font-medium text-foreground'>Onboarding</p>
            </div>
            {backTo ? (
              <Button variant='ghost' size='icon' asChild>
                <Link to={backTo} aria-label='Go back'>
                  <ArrowLeft className='h-4 w-4' />
                </Link>
              </Button>
            ) : null}
          </div>

          <div className='mx-auto w-full max-w-[520px] flex-1'>
            <header className='mb-6 space-y-2'>
              <h1 className='text-3xl font-semibold tracking-tight text-foreground'>{title}</h1>
              <p className='text-sm text-muted-foreground'>{subtitle}</p>
            </header>
            {children}
          </div>
        </section>

        <aside className='relative hidden border-l bg-card lg:flex'>
          <div className='absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,hsl(var(--primary)/0.16),transparent_45%),radial-gradient(circle_at_70%_80%,hsl(var(--accent)/0.18),transparent_45%)]' />
          <div className='relative m-auto w-full max-w-md space-y-4 px-8'>
            <div className='rounded-xl border bg-background/70 p-5 backdrop-blur'>
              <p className='text-sm font-semibold text-foreground'>Build with your team from day one</p>
              <p className='mt-2 text-sm text-muted-foreground'>
                Set up your organization profile, connect tools, and invite collaborators so work starts with shared context.
              </p>
            </div>
            <div className='rounded-xl border bg-background/70 p-5 backdrop-blur'>
              <p className='text-xs uppercase tracking-wide text-muted-foreground'>Productivity stack</p>
              <div className='mt-3 grid grid-cols-3 gap-2 text-xs text-muted-foreground'>
                {['Tasks', 'Projects', 'Goals', 'Reports', 'Organization'].map((item) => (
                  <span key={item} className='rounded-md border bg-muted/30 px-2 py-1 text-center'>
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </main>
  )
}
