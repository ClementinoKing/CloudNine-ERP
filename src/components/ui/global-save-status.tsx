import { Check, Loader2, Sparkles, TriangleAlert } from 'lucide-react'

import { cn } from '@/lib/utils'

type SaveState = 'idle' | 'syncing' | 'saved' | 'error'

export function GlobalSaveStatus({ state, className }: { state: SaveState; className?: string }) {
  if (state === 'idle') return null

  return (
    <div
      className={cn(
        'relative inline-flex items-center gap-1.5 overflow-hidden rounded-full border px-2.5 py-1 text-xs sm:text-sm',
        state === 'syncing' && 'border-primary/30 bg-primary/10 text-primary',
        state === 'saved' && 'border-emerald-400/40 bg-emerald-500/10 text-emerald-300',
        state === 'error' && 'border-rose-400/40 bg-rose-500/10 text-rose-300',
        className,
      )}
      aria-live='polite'
    >
      {state === 'syncing' ? (
        <>
          <span className='pointer-events-none absolute right-3 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-primary/70 animate-ping' />
          <span className='pointer-events-none absolute right-6 top-1/2 h-1 w-1 -translate-y-[8px] rounded-full bg-primary/60 animate-pulse' />
          <Sparkles className='h-3.5 w-3.5' />
          <Loader2 className='h-3.5 w-3.5 animate-spin' />
          Saving...
        </>
      ) : null}
      {state === 'saved' ? (
        <>
          <Sparkles className='h-3.5 w-3.5' />
          <Check className='h-3.5 w-3.5' />
          Saved
        </>
      ) : null}
      {state === 'error' ? (
        <>
          <TriangleAlert className='h-3.5 w-3.5' />
          Sync error
        </>
      ) : null}
    </div>
  )
}
