import { notify } from '@/lib/notify'

const NOISY_REJECTION_PATTERNS = [
  /A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received/i,
  /The message port closed before a response was received/i,
  /Extension context invalidated/i,
]

function getRejectionMessage(reason: unknown) {
  if (reason instanceof Error) return reason.message
  if (typeof reason === 'string') return reason
  if (reason && typeof reason === 'object') {
    const maybeMessage = (reason as { message?: unknown }).message
    if (typeof maybeMessage === 'string' && maybeMessage.trim().length > 0) {
      return maybeMessage
    }
  }
  try {
    return JSON.stringify(reason)
  } catch {
    return String(reason)
  }
}

function shouldSuppressRejection(message: string) {
  return NOISY_REJECTION_PATTERNS.some((pattern) => pattern.test(message))
}

export function installGlobalPromiseRejectionGuard() {
  if (typeof window === 'undefined') return

  const windowWithFlag = window as Window & {
    __cloudninePromiseRejectionGuardInstalled?: boolean
  }

  if (windowWithFlag.__cloudninePromiseRejectionGuardInstalled) return

  const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    const message = getRejectionMessage(event.reason)

    if (shouldSuppressRejection(message)) {
      event.preventDefault()
      return
    }

    event.preventDefault()
    console.error('Unhandled promise rejection', event.reason)
    notify.error('Unexpected error', {
      description: message,
    })
  }

  window.addEventListener('unhandledrejection', handleUnhandledRejection)
  windowWithFlag.__cloudninePromiseRejectionGuardInstalled = true
}
