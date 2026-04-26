import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { cn } from '@/lib/utils'

import { useShell } from '../context/shell-context'
import { useAppRealtime } from '../hooks/use-app-realtime'
import { usePresenceHeartbeat } from '../hooks/use-presence-heartbeat'
import { useSchemaHealth } from '../hooks/use-schema-health'
import { AppHeader } from './app-header'
import { DesktopSidebar, MobileSidebar } from './app-sidebar'
import { GroupChatWidget } from './group-chat-widget'
import { UniversalTaskDetailsModal } from '@/features/tasks/components/universal-task-details-modal'

const LAST_DASHBOARD_PATH_KEY = 'contas.last-dashboard-path'

export function AppShellLayout() {
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const { sidebarCollapsed, toggleSidebar } = useShell()
  const { loading: schemaLoading, hasIssues: hasSchemaIssues, issues: schemaIssues } = useSchemaHealth()
  useAppRealtime()
  usePresenceHeartbeat()

  useEffect(() => {
    if (!location.pathname.startsWith('/dashboard/') || location.pathname === '/dashboard') return
    sessionStorage.setItem(LAST_DASHBOARD_PATH_KEY, location.pathname)
  }, [location.pathname])

  if (location.pathname === '/dashboard') {
    const lastDashboardPath = sessionStorage.getItem(LAST_DASHBOARD_PATH_KEY)
    const redirectTarget =
      lastDashboardPath && lastDashboardPath.startsWith('/dashboard/') ? lastDashboardPath : '/dashboard/home'

    return <Navigate to={redirectTarget} replace />
  }

  return (
    <div className='min-h-screen bg-muted/35'>
      <AppHeader onDesktopToggle={toggleSidebar} onMobileToggle={() => setMobileOpen(true)} />
      <div className='flex min-h-[calc(100vh-4rem)]'>
        <DesktopSidebar collapsed={sidebarCollapsed} />
        <MobileSidebar open={mobileOpen} onOpenChange={setMobileOpen} />

        <main className='flex min-w-0 flex-1 flex-col overflow-x-hidden p-4 md:p-6' aria-label='Dashboard content'>
          {!schemaLoading && hasSchemaIssues ? (
            <div
              className={cn(
                'mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100',
              )}
              role='alert'
            >
              <p className='font-medium'>Schema health warning: required migrations are missing in this environment.</p>
              <p className='mt-1 text-xs text-amber-100/90'>
                Run <code className='rounded bg-black/20 px-1 py-0.5'>supabase db push --include-all</code>, then refresh.
              </p>
              <ul className='mt-2 space-y-1 text-xs text-amber-100/90'>
                {schemaIssues.slice(0, 4).map((issue) => (
                  <li key={issue.key}>
                    <code className='rounded bg-black/20 px-1 py-0.5'>{issue.key}</code>: {issue.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className='min-h-0 flex-1'>
            <Outlet />
          </div>
        </main>
      </div>
      <UniversalTaskDetailsModal />
      <GroupChatWidget />
    </div>
  )
}
