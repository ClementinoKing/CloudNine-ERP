import { FaApple } from 'react-icons/fa'
import { FcGoogle } from 'react-icons/fc'
import type { IconType } from 'react-icons'

import { Button } from '@/components/ui/button'
import { notify } from '@/lib/notify'
import type { SocialAuthProvider } from '@/types/auth'

import { useAuth } from '../context/auth-context'

type SocialAuthButtonsProps = {
  disabled?: boolean
  intent: 'signin' | 'signup'
}

const socialProviders: Array<{
  provider: SocialAuthProvider
  label: string
  icon: IconType
}> = [
  { provider: 'google', label: 'Google', icon: FcGoogle },
  { provider: 'apple', label: 'Apple', icon: FaApple },
]

export function SocialAuthButtons({ disabled = false, intent }: SocialAuthButtonsProps) {
  const { signInWithSocialProvider } = useAuth()
  const actionLabel = intent === 'signup' ? 'Continue with' : 'Sign in with'

  const handleSocialAuth = async (provider: SocialAuthProvider) => {
    try {
      await signInWithSocialProvider(provider)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to start secure sign-in. Please try again.'
      notify.error('Social sign-in failed', { description: message })
    }
  }

  return (
    <div className='space-y-4'>
      <div className='relative flex items-center'>
        <div className='h-px flex-1 bg-border' />
        <span className='px-3 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground'>or</span>
        <div className='h-px flex-1 bg-border' />
      </div>
      <div className='grid grid-cols-1 gap-3'>
        {socialProviders.map(({ provider, label, icon: Icon }) => (
          <Button
            key={provider}
            type='button'
            variant='outline'
            className='h-11 bg-background/70'
            disabled={disabled}
            onClick={() => void handleSocialAuth(provider)}
          >
            <Icon className='h-[18px] w-[18px] shrink-0' aria-hidden='true' />
            <span className='min-w-0 truncate'>
              {actionLabel} {label}
            </span>
          </Button>
        ))}
      </div>
    </div>
  )
}
