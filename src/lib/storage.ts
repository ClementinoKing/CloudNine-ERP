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
export const APP_STORAGE_PREFIX = 'cloudnine'
export const LEGACY_STORAGE_PREFIX = ['con', 'tas'].join('')
const supabaseAuthTokenKey = supabaseProjectRef
  ? `${APP_STORAGE_PREFIX}.supabase.auth.token.${supabaseProjectRef}`
  : `${APP_STORAGE_PREFIX}.supabase.auth.token`
const legacySupabaseAuthTokenKey = supabaseProjectRef
  ? `${LEGACY_STORAGE_PREFIX}.supabase.auth.token.${supabaseProjectRef}`
  : `${LEGACY_STORAGE_PREFIX}.supabase.auth.token`

export const STORAGE_KEYS = {
  authSession: `${APP_STORAGE_PREFIX}.auth.session`,
  accessNotice: `${APP_STORAGE_PREFIX}.auth.access-notice`,
  passwordRecoveryActive: `${APP_STORAGE_PREFIX}.auth.password-recovery-active`,
  supabaseAuthToken: supabaseAuthTokenKey,
  supabaseAuthTokenFallback: `${APP_STORAGE_PREFIX}.supabase.auth.token`,
  supabaseAuthTokenLegacy: legacySupabaseAuthTokenKey,
  supabaseAuthTokenLegacyFallback: `${LEGACY_STORAGE_PREFIX}.supabase.auth.token`,
  profileCache: `${APP_STORAGE_PREFIX}.profile.cache`,
  sidebarCollapsed: `${APP_STORAGE_PREFIX}.ui.sidebar.collapsed`,
} as const

export function migrateLegacyStorageKeys() {
  if (typeof window === 'undefined') return

  const authTokenCandidates = [
    STORAGE_KEYS.supabaseAuthToken,
    STORAGE_KEYS.supabaseAuthTokenFallback,
    STORAGE_KEYS.supabaseAuthTokenLegacy,
    STORAGE_KEYS.supabaseAuthTokenLegacyFallback,
  ]
  const existingAuthToken = authTokenCandidates
    .map((key) => window.localStorage.getItem(key))
    .find((value): value is string => Boolean(value))

  if (existingAuthToken && !window.localStorage.getItem(STORAGE_KEYS.supabaseAuthToken)) {
    window.localStorage.setItem(STORAGE_KEYS.supabaseAuthToken, existingAuthToken)
  }

  const legacyThemeKey = `${LEGACY_STORAGE_PREFIX}.ui.theme`
  const theme = window.localStorage.getItem(legacyThemeKey)
  if (theme && !window.localStorage.getItem(`${APP_STORAGE_PREFIX}.ui.theme`)) {
    window.localStorage.setItem(`${APP_STORAGE_PREFIX}.ui.theme`, theme)
  }

  for (const key of [STORAGE_KEYS.supabaseAuthTokenLegacy, STORAGE_KEYS.supabaseAuthTokenLegacyFallback, legacyThemeKey]) {
    window.localStorage.removeItem(key)
  }
}
