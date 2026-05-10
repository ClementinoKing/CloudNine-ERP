import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

const STAR_POINTS = [
  { left: '8%', top: '14%', size: 'h-1 w-1', opacity: 'opacity-80', delay: '0s' },
  { left: '16%', top: '68%', size: 'h-1.5 w-1.5', opacity: 'opacity-60', delay: '0.8s' },
  { left: '25%', top: '25%', size: 'h-1 w-1', opacity: 'opacity-50', delay: '1.4s' },
  { left: '38%', top: '12%', size: 'h-1.5 w-1.5', opacity: 'opacity-75', delay: '0.3s' },
  { left: '47%', top: '78%', size: 'h-1 w-1', opacity: 'opacity-55', delay: '1.1s' },
  { left: '59%', top: '20%', size: 'h-1 w-1', opacity: 'opacity-70', delay: '1.8s' },
  { left: '68%', top: '62%', size: 'h-1.5 w-1.5', opacity: 'opacity-65', delay: '0.5s' },
  { left: '76%', top: '34%', size: 'h-1 w-1', opacity: 'opacity-50', delay: '1.6s' },
  { left: '86%', top: '18%', size: 'h-1.5 w-1.5', opacity: 'opacity-80', delay: '0.9s' },
  { left: '91%', top: '72%', size: 'h-1 w-1', opacity: 'opacity-55', delay: '1.2s' },
] as const

const ORBIT_MARKERS = [
  { label: 'Tasks', className: 'left-[8%] top-[18%]' },
  { label: 'Goals', className: 'right-[6%] top-[26%]' },
  { label: 'Docs', className: 'bottom-[18%] left-[12%]' },
  { label: 'Team', className: 'bottom-[22%] right-[10%]' },
] as const

type ErrorSpacePageProps = {
  eyebrow: string
  title: string
  description: string
  icon: LucideIcon
  actions: ReactNode
}

export function ErrorSpacePage({ eyebrow, title, description, icon: Icon, actions }: ErrorSpacePageProps) {
  return (
    <main className='relative isolate flex min-h-screen overflow-hidden bg-background px-5 py-8 text-foreground sm:px-8'>
      <div className='absolute inset-0 -z-30 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.14),transparent_34%),radial-gradient(circle_at_82%_20%,hsl(var(--muted)/0.52),transparent_30%),linear-gradient(135deg,hsl(var(--background))_0%,hsl(var(--muted)/0.6)_52%,hsl(var(--background))_100%)]' />
      <div className='absolute inset-0 -z-20 opacity-50 [background-image:linear-gradient(hsl(var(--border)/0.7)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--border)/0.7)_1px,transparent_1px)] [background-size:72px_72px]' />
      <div className='absolute left-1/2 top-1/2 -z-20 h-[36rem] w-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-border/70 bg-card/20 shadow-[0_0_120px_hsl(var(--primary)/0.12)]' />
      <div className='absolute left-1/2 top-1/2 -z-20 h-[24rem] w-[24rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-border/80' />

      {STAR_POINTS.map((star, index) => (
        <span
          key={`${star.left}-${star.top}`}
          className={`absolute rounded-full bg-primary shadow-[0_0_18px_hsl(var(--primary)/0.55)] ${star.size} ${star.opacity} animate-pulse`}
          style={{
            left: star.left,
            top: star.top,
            animationDelay: star.delay,
          }}
          aria-hidden='true'
        >
          {index % 3 === 0 ? <span className='absolute -inset-1 rounded-full bg-primary/20 blur-sm' /> : null}
        </span>
      ))}

      <span className='absolute right-[12%] top-[16%] h-px w-28 -rotate-12 bg-gradient-to-r from-transparent via-primary/60 to-transparent shadow-[0_0_22px_hsl(var(--primary)/0.35)]' aria-hidden='true' />
      <span className='absolute bottom-[18%] left-[14%] h-px w-20 rotate-12 bg-gradient-to-r from-transparent via-foreground/40 to-transparent shadow-[0_0_20px_hsl(var(--foreground)/0.18)]' aria-hidden='true' />

      <section className='relative mx-auto flex w-full max-w-6xl items-center justify-center'>
        {ORBIT_MARKERS.map((marker) => (
          <div
            key={marker.label}
            className={`pointer-events-none absolute hidden rounded-full border border-border/70 bg-card/55 px-3 py-1 text-[11px] font-medium text-muted-foreground shadow-[var(--elevation-sm)] backdrop-blur-md md:block ${marker.className}`}
          >
            {marker.label}
          </div>
        ))}

        <div className='relative w-full max-w-2xl overflow-hidden rounded-[2rem] border border-border/80 bg-card/70 p-6 text-card-foreground shadow-[var(--elevation-lg)] backdrop-blur-2xl sm:p-10'>
          <div className='absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-foreground/25 to-transparent' />
          <div className='absolute -right-20 -top-20 h-48 w-48 rounded-full bg-primary/10 blur-3xl' />
          <div className='absolute -bottom-24 -left-20 h-56 w-56 rounded-full bg-muted/50 blur-3xl' />

          <div className='relative space-y-8 text-center'>
            <div className='mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-background/45 shadow-[inset_0_1px_0_hsl(var(--foreground)/0.08)] backdrop-blur-xl'>
              <Icon className='h-6 w-6 text-primary' aria-hidden='true' />
            </div>

            <div className='space-y-4'>
              <p className='text-sm font-semibold uppercase tracking-[0.28em] text-muted-foreground'>{eyebrow}</p>
              <h1 className='text-6xl font-semibold leading-none tracking-normal text-foreground sm:text-8xl'>{title}</h1>
              <p className='mx-auto max-w-xl text-balance text-base leading-7 text-muted-foreground sm:text-lg'>{description}</p>
            </div>

            <div className='grid gap-3 sm:grid-cols-2'>{actions}</div>
          </div>
        </div>
      </section>
    </main>
  )
}
