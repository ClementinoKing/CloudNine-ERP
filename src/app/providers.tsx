import type { ReactNode } from 'react'
import { Toaster } from 'sonner'

import { AuthProvider } from '@/features/auth/context/auth-context'
import { ShellProvider } from '@/features/layout/context/shell-context'
import { OrganizationProvider } from '@/features/organization/context/organization-context'

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <OrganizationProvider>
        <ShellProvider>
          {children}
          <Toaster richColors closeButton />
        </ShellProvider>
      </OrganizationProvider>
    </AuthProvider>
  )
}
