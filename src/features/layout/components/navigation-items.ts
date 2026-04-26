import {
  Bell,
  ChartNoAxesColumn,
  Goal,
  House,
  ListChecks,
  Workflow,
} from 'lucide-react'

import type { NavSection } from '@/types/navigation'

export const SIDEBAR_SECTIONS: NavSection[] = [
  {
    title: 'Main',
    items: [
      { label: 'Home', path: '/dashboard/home', icon: House },
      { label: 'My Tasks', path: '/dashboard/my-tasks', icon: ListChecks },
      { label: 'Notifications', path: '/dashboard/notifications', icon: Bell },
    ],
  },
  {
    title: 'Planning',
    items: [
      { label: 'Reporting', path: '/dashboard/reporting', icon: ChartNoAxesColumn },
      { label: 'Goals', path: '/dashboard/goals', icon: Goal },
      { label: 'Organization', path: '/dashboard/workspace', icon: Workflow },
    ],
  },
]
