import type { ReactNode } from 'react'

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <main className='relative flex min-h-screen items-center justify-center overflow-hidden bg-muted/35 px-4 py-12'>
      <div className='pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_20%,hsl(var(--background)),transparent_35%),radial-gradient(circle_at_85%_15%,hsl(var(--muted)),transparent_35%),radial-gradient(circle_at_40%_80%,hsl(var(--accent)),transparent_40%)]' />
      <div className='relative flex w-full max-w-md flex-col items-center gap-5'>
        <div className='flex items-center justify-center'>
          <img src='/Svg/CN_logo.svg' alt='CloudNine ERP' className='h-14 w-auto dark:hidden' />
          <img src='/Svg/CN_Logo_White.svg' alt='CloudNine ERP' className='hidden h-14 w-auto dark:block' />
        </div>
        <section className='w-full rounded-2xl border bg-card/95 p-8 text-center backdrop-blur-sm'>
          <header className='mb-6 space-y-1'>
            <h1 className='text-2xl font-semibold text-foreground'>{title}</h1>
            <p className='text-sm text-muted-foreground'>{subtitle}</p>
          </header>
          <div className='mx-auto w-full max-w-sm text-left'>{children}</div>
        </section>
      </div>
    </main>
  )
}
