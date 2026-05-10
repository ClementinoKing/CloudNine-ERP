import { ArrowLeft, Home, Sparkles } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { ErrorSpacePage } from '@/features/errors/components/error-space-page'

export function NotFoundPage() {
  const navigate = useNavigate()

  return (
    <ErrorSpacePage
      eyebrow='Lost in orbit'
      title='404'
      description='This workspace view drifted beyond the CloudNine map. The dashboard is still online, but this route does not exist.'
      icon={Sparkles}
      actions={
        <>
          <Button asChild size='lg' className='h-12 shadow-[var(--elevation-md)]'>
            <Link to='/dashboard/home'>
              <Home className='h-4 w-4' aria-hidden='true' />
              Open dashboard
            </Link>
          </Button>
          <Button type='button' size='lg' variant='outline' className='h-12 bg-card/70' onClick={() => navigate(-1)}>
            <ArrowLeft className='h-4 w-4' aria-hidden='true' />
            Go back
          </Button>
        </>
      }
    />
  )
}
