function getProjectRefFromSupabaseUrl() {
  const value = import.meta.env.VITE_SUPABASE_URL
  if (!value) return null

  try {
    const host = new URL(value).hostname
    const [projectRef] = host.split('.')
    return projectRef || null
  } catch {
    return null
  }
}

const supabaseProjectRef = getProjectRefFromSupabaseUrl()
const supabaseAuthTokenKey = supabaseProjectRef
  ? `contas.supabase.auth.token.${supabaseProjectRef}`
  : 'contas.supabase.auth.token'

export const STORAGE_KEYS = {
  authSession: 'contas.auth.session',
  accessNotice: 'contas.auth.access-notice',
  supabaseAuthToken: supabaseAuthTokenKey,
  supabaseAuthTokenLegacy: 'contas.supabase.auth.token',
  profileCache: 'contas.profile.cache',
  sidebarCollapsed: 'contas.ui.sidebar.collapsed',
} as const
