import { createBrowserRouter, Navigate } from 'react-router-dom'

import { AuthRedirectRoute, ProtectedRoute, RootRoute } from './route-guards'
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
import { RegisterPage } from '@/features/auth/pages/register-page'
import { ResetPasswordPage } from '@/features/auth/pages/reset-password-page'
import { ForgotPasswordPage } from '@/features/auth/pages/forgot-password-page'
import { AppShellLayout } from '@/features/layout/components/app-shell-layout'
import { SettingsPage } from '@/features/settings/pages/settings-page'
import { OnboardingNamePage } from '@/features/onboarding/pages/onboarding-name-page'
import { OnboardingOrganizationPage } from '@/features/onboarding/pages/onboarding-organization-page'
import { OnboardingWorkPage } from '@/features/onboarding/pages/onboarding-work-page'
import { OnboardingToolsPage } from '@/features/onboarding/pages/onboarding-tools-page'
import { NotFoundPage } from '@/features/errors/pages/not-found-page'
import { OrgChartPage } from '@/features/workforce/pages/org-chart-page'

const LAST_DASHBOARD_PATH_KEY = 'cloudnine.last-dashboard-path'

function getLastDashboardPath() {
  const savedPath = sessionStorage.getItem(LAST_DASHBOARD_PATH_KEY)
  return savedPath && savedPath.startsWith('/dashboard/') ? savedPath : '/dashboard/home'
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootRoute />,
  },
  {
    element: <AuthRedirectRoute />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
    ],
  },
  {
    path: '/forgot-password',
    element: <ForgotPasswordPage />,
  },
  {
    element: <ProtectedRoute />,
    children: [
      { path: '/reset-password', element: <ResetPasswordPage /> },
      { path: '/onboarding/organization', element: <OnboardingOrganizationPage /> },
      { path: '/onboarding/name', element: <OnboardingNamePage /> },
      { path: '/onboarding/work', element: <OnboardingWorkPage /> },
      { path: '/onboarding/tools', element: <OnboardingToolsPage /> },
      {
        path: '/dashboard',
        element: <AppShellLayout />,
        children: [
          { index: true, element: <Navigate to={getLastDashboardPath()} replace /> },
          { path: 'home', element: <DashboardHomePage /> },
          { path: 'profile', element: <SettingsPage profileOnly /> },
          { path: 'my-tasks', element: <MyTasksPage /> },
          { path: 'notifications', element: <NotificationsPage /> },
          { path: 'reporting', element: <ReportingPage /> },
          { path: 'goals', element: <GoalsPage /> },
          { path: 'projects', element: <ProjectsPage /> },
          { path: 'projects/:projectId', element: <ProjectDetailPage /> },
          { path: 'documents', element: <DocumentsPage /> },
          { path: 'tools', element: <ToolsPage /> },
          { path: 'workspace', element: <WorkspacePage /> },
          { path: 'workspace/org-chart', element: <OrgChartPage /> },
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
