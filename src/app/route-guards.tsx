import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '@/features/auth/context/auth-context'
import { STORAGE_KEYS } from '@/lib/storage'

const LAST_DASHBOARD_PATH_KEY = 'contas.last-dashboard-path'

function getLastDashboardPath() {
  const savedPath = sessionStorage.getItem(LAST_DASHBOARD_PATH_KEY)
  return savedPath && savedPath.startsWith('/dashboard/') ? savedPath : '/dashboard/home'
}

function hasPersistedSupabaseSession() {
  return Boolean(localStorage.getItem(STORAGE_KEYS.supabaseAuthToken) ?? localStorage.getItem(STORAGE_KEYS.supabaseAuthTokenLegacy))
}

export function ProtectedRoute() {
  const { isAuthenticated, loading, profileLoading, currentUser } = useAuth()
  const location = useLocation()
  const persistedSessionExists = hasPersistedSupabaseSession()

  if (loading || profileLoading) {
    return persistedSessionExists ? <Outlet /> : null
  }

  if (!isAuthenticated) {
    return <Navigate to='/login' state={{ from: location }} replace />
  }

  if (currentUser?.mustResetPassword && location.pathname !== '/reset-password') {
    return <Navigate to='/reset-password' replace />
  }

  return <Outlet />
}

export function AuthRedirectRoute() {
  const { isAuthenticated, loading, profileLoading, currentUser } = useAuth()

  if (loading || profileLoading) {
    return hasPersistedSupabaseSession() ? null : <Outlet />
  }

  if (isAuthenticated) {
    if (currentUser?.mustResetPassword) {
      return <Navigate to='/reset-password' replace />
    }
    return <Navigate to={getLastDashboardPath()} replace />
  }

  return <Outlet />
}
