import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { RotateCw, WifiOff } from 'lucide-react'

import { router } from '@/app/router'
import { AppProviders } from '@/app/providers'
import { Button } from '@/components/ui/button'
import { ErrorSpacePage } from '@/features/errors/components/error-space-page'
import { installGlobalPromiseRejectionGuard } from '@/lib/promise-errors'

import './index.css'

const THEME_STORAGE_KEY = 'cloudnine.ui.theme'
const IMAGE_URL_LOG_PREFIX = 'Image URL being set:'

function applyInitialTheme() {
  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY)
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const shouldUseDark = storedTheme ? storedTheme === 'dark' : prefersDark

  document.documentElement.classList.toggle('dark', shouldUseDark)
}

function suppressNoisyImageLogs() {
  const consoleWithFlag = console as typeof console & { __cloudnineImageLogFilter?: boolean }

  if (consoleWithFlag.__cloudnineImageLogFilter) {
    return
  }

  const originalLog = console.log.bind(console)

  console.log = (...args: unknown[]) => {
    const firstArg = args[0]
    if (typeof firstArg === 'string' && firstArg.startsWith(IMAGE_URL_LOG_PREFIX)) {
      return
    }

    originalLog(...args)
  }

  consoleWithFlag.__cloudnineImageLogFilter = true
}

applyInitialTheme()
installGlobalPromiseRejectionGuard()

if (import.meta.env.DEV) {
  suppressNoisyImageLogs()
}

function OfflineConnectionPage() {
  return (
    <ErrorSpacePage
      eyebrow='Lost network'
      title='Offline'
      description='CloudNine cannot reach the network right now. Reconnect to the internet, then retry the workspace.'
      icon={WifiOff}
      actions={
        <>
          <Button type='button' size='lg' className='h-12 shadow-[var(--elevation-md)]' onClick={() => window.location.reload()}>
            <RotateCw className='h-4 w-4' aria-hidden='true' />
            Try again
          </Button>
          <Button type='button' size='lg' variant='outline' className='h-12 bg-card/70' onClick={() => setTimeout(() => window.location.reload(), 150)}>
            Check connection
          </Button>
        </>
      }
    />
  )
}

function RootWithNetworkGuard() {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  if (!isOnline) return <OfflineConnectionPage />

  return (
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootWithNetworkGuard />
  </StrictMode>,
)
