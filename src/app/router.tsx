import { createBrowserRouter, Navigate } from 'react-router-dom'

import { AuthRedirectRoute, ProtectedRoute } from './route-guards'
import { DashboardHomePage } from '@/features/dashboard/pages/dashboard-home-page'
import { MyTasksPage } from '@/features/dashboard/pages/my-tasks-page'
import { NotificationsPage } from '@/features/dashboard/pages/notifications-page'
import { ReportingPage } from '@/features/dashboard/pages/reporting-page'
import { GoalsPage } from '@/features/dashboard/pages/goals-page'
import { WorkspacePage } from '@/features/dashboard/pages/workspace-page'
import { ProjectDetailPage } from '@/features/dashboard/pages/project-detail-page'
import { ProjectsPage } from '@/features/dashboard/pages/projects-page'
import { DocumentsPage } from '@/features/dashboard/pages/documents-page'
import { ToolsPage } from '@/features/dashboard/pages/tools-page'
import { LoginPage } from '@/features/auth/pages/login-page'
import { ResetPasswordPage } from '@/features/auth/pages/reset-password-page'
import { AppShellLayout } from '@/features/layout/components/app-shell-layout'
import { SettingsPage } from '@/features/settings/pages/settings-page'

const LAST_DASHBOARD_PATH_KEY = 'contas.last-dashboard-path'

function getLastDashboardPath() {
  const savedPath = sessionStorage.getItem(LAST_DASHBOARD_PATH_KEY)
  return savedPath && savedPath.startsWith('/dashboard/') ? savedPath : '/dashboard/home'
}

function NotFoundPage() {
  return (
    <main className='flex min-h-screen items-center justify-center p-6'>
      <div className='space-y-2 text-center'>
        <p className='text-sm font-semibold uppercase tracking-wide text-muted-foreground'>404</p>
        <h1 className='text-2xl font-semibold'>Page not found</h1>
      </div>
    </main>
  )
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Navigate to={getLastDashboardPath()} replace />,
  },
  {
    element: <AuthRedirectRoute />,
    children: [
      { path: '/login', element: <LoginPage /> },
    ],
  },
  {
    element: <ProtectedRoute />,
    children: [
      { path: '/reset-password', element: <ResetPasswordPage /> },
      {
        path: '/dashboard',
        element: <AppShellLayout />,
        children: [
          { index: true, element: <Navigate to={getLastDashboardPath()} replace /> },
          { path: 'home', element: <DashboardHomePage /> },
          { path: 'my-tasks', element: <MyTasksPage /> },
          { path: 'notifications', element: <NotificationsPage /> },
          { path: 'reporting', element: <ReportingPage /> },
          { path: 'goals', element: <GoalsPage /> },
          { path: 'projects', element: <ProjectsPage /> },
          { path: 'projects/:projectId', element: <ProjectDetailPage /> },
          { path: 'documents', element: <DocumentsPage /> },
          { path: 'tools', element: <ToolsPage /> },
          { path: 'workspace', element: <WorkspacePage /> },
          { path: 'settings', element: <SettingsPage /> },
        ],
      },
    ],
  },
  {
    path: '*',
    element: <NotFoundPage />,
  },
])
