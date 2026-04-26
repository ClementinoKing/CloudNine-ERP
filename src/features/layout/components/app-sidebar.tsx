import { FileText, FolderKanban, Grip, LogOut, Moon, Settings, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import { useAuth } from '@/features/auth/context/auth-context'
import { useUnreadNotifications } from '@/features/layout/hooks/use-unread-notifications'
import { cn } from '@/lib/utils'
import { SIDEBAR_SECTIONS } from './navigation-items'

const THEME_STORAGE_KEY = 'contas.ui.theme'
const THEME_TRANSITION_CLASS = 'theme-transition'
function SidebarContent({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const navigate = useNavigate()
  const { currentUser, logout } = useAuth()
  const { unreadCount } = useUnreadNotifications()
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY)
    if (storedTheme) {
      return storedTheme === 'dark'
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode)
  }, [isDarkMode])

  const toggleTheme = () => {
    const nextIsDark = !isDarkMode
    document.documentElement.classList.add(THEME_TRANSITION_CLASS)
    document.documentElement.classList.toggle('dark', nextIsDark)
    localStorage.setItem(THEME_STORAGE_KEY, nextIsDark ? 'dark' : 'light')
    setIsDarkMode(nextIsDark)
    window.setTimeout(() => {
      document.documentElement.classList.remove(THEME_TRANSITION_CLASS)
    }, 300)
  }

  const openSettings = () => {
    onNavigate?.()
    navigate('/dashboard/settings')
  }

  const handleLogout = async () => {
    onNavigate?.()
    await logout()
    navigate('/login')
  }

  return (
    <>
      <div className='flex h-full flex-col'>
        <div className='px-3 py-4'>
          <p className={cn('px-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground', collapsed && 'sr-only')}>
            Workspace
          </p>
        </div>

        <nav className='flex-1 space-y-4 overflow-y-auto px-2 pb-3'>
          {SIDEBAR_SECTIONS.map((section) => (
            <section key={section.title} className='space-y-1'>
              <p className={cn('px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground', collapsed && 'sr-only')}>
                {section.title}
              </p>
              {section.items.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'group flex h-10 items-center rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      isActive ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-accent hover:text-accent-foreground',
                      collapsed && 'justify-center px-0',
                    )
                  }
                  title={collapsed ? item.label : undefined}
                >
                  <item.icon className='h-4 w-4 shrink-0' aria-hidden='true' />
                  <span className={cn('ml-3', collapsed && 'sr-only')}>{item.label}</span>
                  {item.path === '/dashboard/notifications' && unreadCount > 0 ? (
                    <span
                      className={cn(
                        'ml-auto inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-none text-white',
                        collapsed && 'absolute right-2 top-1.5',
                      )}
                    >
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  ) : null}
                </NavLink>
              ))}
            </section>
          ))}

          <section className='space-y-1'>
            <p className={cn('px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground', collapsed && 'sr-only')}>
              Projects
            </p>
            <NavLink
              to='/dashboard/projects'
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'group flex h-9 items-center rounded-md px-3 text-sm font-medium transition-colors',
                  isActive ? 'bg-primary/10 text-primary' : 'text-foreground/90 hover:bg-accent hover:text-accent-foreground',
                  collapsed && 'justify-center px-0',
                )
              }
              title='Projects Hub'
            >
              <FolderKanban className='h-4 w-4 shrink-0' aria-hidden='true' />
              <span className={cn('ml-3', collapsed && 'sr-only')}>Projects Hub</span>
            </NavLink>
          </section>

          <section className='space-y-1'>
            <p className={cn('px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground', collapsed && 'sr-only')}>
              Files
            </p>
            <NavLink
              to='/dashboard/documents'
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'group flex h-10 items-center rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isActive ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-accent hover:text-accent-foreground',
                  collapsed && 'justify-center px-0',
                )
              }
              title='Documents'
            >
              <FileText className='h-4 w-4 shrink-0' aria-hidden='true' />
              <span className={cn('ml-3', collapsed && 'sr-only')}>Documents</span>
            </NavLink>
            <NavLink
              to='/dashboard/tools'
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'group flex h-10 items-center rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isActive ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-accent hover:text-accent-foreground',
                  collapsed && 'justify-center px-0',
                )
              }
              title='Tools'
            >
              <Grip className='h-4 w-4 shrink-0' aria-hidden='true' />
              <span className={cn('ml-3', collapsed && 'sr-only')}>Tools</span>
            </NavLink>
          </section>
        </nav>

      <footer className='border-t bg-muted/40 p-3'>
        <div className={cn('rounded-lg border bg-card p-3', collapsed && 'p-2')}>
          <div className={cn('min-w-0', collapsed && 'sr-only')}>
            <p className='truncate text-sm font-medium text-foreground'>{currentUser?.name ?? 'Organization User'}</p>
            <p className='truncate text-xs text-muted-foreground'>{currentUser?.jobTitle ?? 'Team Member'}</p>
          </div>
          <div
            className={cn(
              'mt-3 flex items-center justify-between gap-2',
              collapsed && 'mt-0 flex-col items-center gap-1.5',
            )}
          >
            <button
              type='button'
              aria-label='Logout'
              onClick={() => void handleLogout()}
              className={cn(
                'inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                collapsed && 'h-8 w-8 justify-center p-0',
              )}
            >
              <LogOut className='h-3.5 w-3.5' aria-hidden='true' />
              <span className={cn('ml-1.5', collapsed && 'sr-only')}>Logout</span>
            </button>
            <div className={cn('flex items-center gap-2', collapsed && 'contents')}>
              <button
                type='button'
                aria-label='Settings'
                onClick={openSettings}
                className={cn(
                  'inline-flex h-9 w-9 items-center justify-center rounded-md border text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  collapsed && 'h-8 w-8',
                )}
              >
                <Settings className='h-3.5 w-3.5' aria-hidden='true' />
              </button>
              <button
                type='button'
                aria-label={`Switch to ${isDarkMode ? 'light' : 'dark'} mode`}
                onClick={toggleTheme}
                className={cn(
                  'inline-flex h-9 w-9 items-center justify-center rounded-md border text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  collapsed && 'h-8 w-8',
                )}
              >
                <span className='relative h-3.5 w-3.5'>
                  <Sun
                    className={cn(
                      'absolute inset-0 h-3.5 w-3.5 transition-all duration-300',
                      isDarkMode ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-0 opacity-0',
                    )}
                    aria-hidden='true'
                  />
                  <Moon
                    className={cn(
                      'absolute inset-0 h-3.5 w-3.5 transition-all duration-300',
                      isDarkMode ? 'rotate-90 scale-0 opacity-0' : 'rotate-0 scale-100 opacity-100',
                    )}
                    aria-hidden='true'
                  />
                </span>
              </button>
            </div>
          </div>
        </div>
      </footer>
      </div>
    </>
  )
}

export function DesktopSidebar({ collapsed }: { collapsed: boolean }) {
  return (
    <aside
      className={cn(
        'hidden h-[calc(100vh-4rem)] shrink-0 self-start border-r bg-card transition-[width] duration-200 md:sticky md:top-16 md:block',
        collapsed ? 'w-[76px]' : 'w-[224px]',
      )}
      aria-label='Sidebar navigation'
    >
      <SidebarContent collapsed={collapsed} />
    </aside>
  )
}

export function MobileSidebar({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='left-0 top-0 h-full w-[86vw] max-w-[320px] translate-x-0 translate-y-0 rounded-none border-r p-0' showClose={false}>
        <DialogTitle className='sr-only'>Sidebar menu</DialogTitle>
        <SidebarContent collapsed={false} onNavigate={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}
