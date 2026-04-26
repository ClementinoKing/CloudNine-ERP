import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react'

import { STORAGE_KEYS } from '@/lib/storage'

type ShellState = {
  sidebarCollapsed: boolean
}

type ShellAction =
  | { type: 'RESTORE'; payload: boolean }
  | { type: 'TOGGLE' }
  | { type: 'SET'; payload: boolean }

interface ShellContextValue {
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  setSidebarCollapsed: (value: boolean) => void
}

const ShellContext = createContext<ShellContextValue | undefined>(undefined)

const initialState: ShellState = {
  sidebarCollapsed: false,
}

function shellReducer(state: ShellState, action: ShellAction): ShellState {
  switch (action.type) {
    case 'RESTORE':
      return { ...state, sidebarCollapsed: action.payload }
    case 'TOGGLE':
      return { ...state, sidebarCollapsed: !state.sidebarCollapsed }
    case 'SET':
      return { ...state, sidebarCollapsed: action.payload }
    default:
      return state
  }
}

export function ShellProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(shellReducer, initialState)

  useEffect(() => {
    const rawValue = localStorage.getItem(STORAGE_KEYS.sidebarCollapsed)
    dispatch({ type: 'RESTORE', payload: rawValue === 'true' })
  }, [])

  const setSidebarCollapsed = useCallback((value: boolean) => {
    localStorage.setItem(STORAGE_KEYS.sidebarCollapsed, String(value))
    dispatch({ type: 'SET', payload: value })
  }, [])

  const toggleSidebar = useCallback(() => {
    const next = !state.sidebarCollapsed
    localStorage.setItem(STORAGE_KEYS.sidebarCollapsed, String(next))
    dispatch({ type: 'TOGGLE' })
  }, [state.sidebarCollapsed])

  const value = useMemo(
    () => ({
      sidebarCollapsed: state.sidebarCollapsed,
      toggleSidebar,
      setSidebarCollapsed,
    }),
    [setSidebarCollapsed, state.sidebarCollapsed, toggleSidebar],
  )

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>
}

export function useShell() {
  const context = useContext(ShellContext)
  if (!context) {
    throw new Error('useShell must be used within ShellProvider')
  }
  return context
}
