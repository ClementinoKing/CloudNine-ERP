import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '@/features/auth/context/auth-context'
import {
  canAccessOnboardingStep,
  getFirstIncompleteOnboardingStep,
  getOnboardingPath,
  getOnboardingStepFromPathname,
} from '@/features/onboarding/lib/onboarding-routes'
import { STORAGE_KEYS } from '@/lib/storage'

const LAST_DASHBOARD_PATH_KEY = 'cloudnine.last-dashboard-path'
const RESET_PASSWORD_PATH = '/reset-password'

function getLastDashboardPath() {
  const savedPath = sessionStorage.getItem(LAST_DASHBOARD_PATH_KEY)
  return savedPath && savedPath.startsWith('/dashboard/') ? savedPath : '/dashboard/home'
}

function hasPersistedSupabaseSession() {
  return Boolean(localStorage.getItem(STORAGE_KEYS.supabaseAuthToken) ?? localStorage.getItem(STORAGE_KEYS.supabaseAuthTokenLegacy))
}

function hasActivePasswordRecoverySession() {
  return sessionStorage.getItem(STORAGE_KEYS.passwordRecoveryActive) === 'true'
}

function shouldShowResetPasswordPage(currentUserMustResetPassword?: boolean) {
  return hasActivePasswordRecoverySession() || Boolean(currentUserMustResetPassword)
}

function AuthGateLoadingScreen() {
  return (
    <div className='flex min-h-screen items-center justify-center bg-background'>
      <div className='task-details-loader' aria-hidden='true'>
        <svg id='pegtopone' width='100' height='100' viewBox='0 0 100 100' fill='none' xmlns='http://www.w3.org/2000/svg'>
          <g>
            <path d='M50 8C52.5 8 54.6 9.8 55.1 12.2L58.1 26.3C58.5 28.3 60.1 29.9 62.1 30.3L76.2 33.3C78.6 33.8 80.4 35.9 80.4 38.4C80.4 40.9 78.6 43 76.2 43.5L62.1 46.5C60.1 46.9 58.5 48.5 58.1 50.5L55.1 64.6C54.6 67 52.5 68.8 50 68.8C47.5 68.8 45.4 67 44.9 64.6L41.9 50.5C41.5 48.5 39.9 46.9 37.9 46.5L23.8 43.5C21.4 43 19.6 40.9 19.6 38.4C19.6 35.9 21.4 33.8 23.8 33.3L37.9 30.3C39.9 29.9 41.5 28.3 41.9 26.3L44.9 12.2C45.4 9.8 47.5 8 50 8Z' />
          </g>
        </svg>
        <svg id='pegtoptwo' width='100' height='100' viewBox='0 0 100 100' fill='none' xmlns='http://www.w3.org/2000/svg'>
          <g>
            <path d='M50 8C52.5 8 54.6 9.8 55.1 12.2L58.1 26.3C58.5 28.3 60.1 29.9 62.1 30.3L76.2 33.3C78.6 33.8 80.4 35.9 80.4 38.4C80.4 40.9 78.6 43 76.2 43.5L62.1 46.5C60.1 46.9 58.5 48.5 58.1 50.5L55.1 64.6C54.6 67 52.5 68.8 50 68.8C47.5 68.8 45.4 67 44.9 64.6L41.9 50.5C41.5 48.5 39.9 46.9 37.9 46.5L23.8 43.5C21.4 43 19.6 40.9 19.6 38.4C19.6 35.9 21.4 33.8 23.8 33.3L37.9 30.3C39.9 29.9 41.5 28.3 41.9 26.3L44.9 12.2C45.4 9.8 47.5 8 50 8Z' />
          </g>
        </svg>
        <svg id='pegtopthree' width='100' height='100' viewBox='0 0 100 100' fill='none' xmlns='http://www.w3.org/2000/svg'>
          <g>
            <path d='M50 8C52.5 8 54.6 9.8 55.1 12.2L58.1 26.3C58.5 28.3 60.1 29.9 62.1 30.3L76.2 33.3C78.6 33.8 80.4 35.9 80.4 38.4C80.4 40.9 78.6 43 76.2 43.5L62.1 46.5C60.1 46.9 58.5 48.5 58.1 50.5L55.1 64.6C54.6 67 52.5 68.8 50 68.8C47.5 68.8 45.4 67 44.9 64.6L41.9 50.5C41.5 48.5 39.9 46.9 37.9 46.5L23.8 43.5C21.4 43 19.6 40.9 19.6 38.4C19.6 35.9 21.4 33.8 23.8 33.3L37.9 30.3C39.9 29.9 41.5 28.3 41.9 26.3L44.9 12.2C45.4 9.8 47.5 8 50 8Z' />
          </g>
        </svg>
      </div>
    </div>
  )
}

export function ProtectedRoute() {
  const { isAuthenticated, loading, profileLoading, hasProfile, currentUser } = useAuth()
  const location = useLocation()
  const persistedSessionExists = hasPersistedSupabaseSession()
  const resetPasswordRequired = shouldShowResetPasswordPage(currentUser?.mustResetPassword)

  if (loading || profileLoading) {
    return persistedSessionExists ? <AuthGateLoadingScreen /> : null
  }

  if (!isAuthenticated) {
    return <Navigate to='/login' state={{ from: location }} replace />
  }

  if (resetPasswordRequired) {
    if (location.pathname !== RESET_PASSWORD_PATH) {
      return <Navigate to={RESET_PASSWORD_PATH} replace />
    }

    return <Outlet />
  }

  // New user — no profile row yet, send them to onboarding unless already there
  if (!hasProfile && !location.pathname.startsWith('/onboarding')) {
    return <Navigate to='/onboarding/organization' replace />
  }

  if (hasProfile && currentUser?.onboarding && !currentUser.onboarding.completed) {
    const resumePath = getOnboardingPath(getFirstIncompleteOnboardingStep(currentUser.onboarding))
    if (!location.pathname.startsWith('/onboarding')) {
      return <Navigate to={resumePath} replace />
    }

    const requestedStep = getOnboardingStepFromPathname(location.pathname)
    if (requestedStep && !canAccessOnboardingStep(requestedStep, currentUser.onboarding)) {
      return <Navigate to={resumePath} replace />
    }
  }

  return <Outlet />
}

export function AuthRedirectRoute() {
  const { isAuthenticated, loading, profileLoading, hasProfile, currentUser } = useAuth()

  if (loading || profileLoading) {
    return hasPersistedSupabaseSession() ? <AuthGateLoadingScreen /> : <Outlet />
  }

  if (isAuthenticated) {
    if (shouldShowResetPasswordPage(currentUser?.mustResetPassword)) {
      return <Navigate to={RESET_PASSWORD_PATH} replace />
    }
    if (!hasProfile) {
      return <Navigate to='/onboarding/organization' replace />
    }
    if (currentUser?.onboarding && !currentUser.onboarding.completed) {
      return <Navigate to={getOnboardingPath(getFirstIncompleteOnboardingStep(currentUser.onboarding))} replace />
    }
    return <Navigate to={getLastDashboardPath()} replace />
  }

  return <Outlet />
}

export function RootRoute() {
  const { isAuthenticated, loading, profileLoading, hasProfile, currentUser } = useAuth()
  const location = useLocation()

  if (loading || profileLoading) {
    return <AuthGateLoadingScreen />
  }

  if (isAuthenticated) {
    if (shouldShowResetPasswordPage(currentUser?.mustResetPassword)) {
      return <Navigate to={RESET_PASSWORD_PATH} replace />
    }
    if (!hasProfile) {
      return <Navigate to='/onboarding/organization' replace />
    }
    if (currentUser?.onboarding && !currentUser.onboarding.completed) {
      return <Navigate to={getOnboardingPath(getFirstIncompleteOnboardingStep(currentUser.onboarding))} replace />
    }
    return <Navigate to={getLastDashboardPath()} replace />
  }

  if (location.pathname === '/') {
    return <Navigate to='/login' replace />
  }

  return <Outlet />
}
