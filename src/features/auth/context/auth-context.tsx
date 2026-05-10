import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'

import { APP_STORAGE_PREFIX, LEGACY_STORAGE_PREFIX, STORAGE_KEYS } from '@/lib/storage'
import { supabase } from '@/lib/supabase'
import type { AccountStatus, AuthSession, LoginPayload, OnboardingState, RegisterPayload, SocialAuthProvider, User } from '@/types/auth'

type AuthState = {
  session: AuthSession | null
  loading: boolean
  hasProfile: boolean
  profileLoading: boolean
}

type AuthAction =
  | { type: 'RESTORE_SESSION'; payload: AuthSession | null }
  | { type: 'SET_SESSION'; payload: AuthSession }
  | { type: 'CLEAR_SESSION' }
  | { type: 'SET_PROFILE_STATUS'; payload: { hasProfile: boolean; loading: boolean } }

export interface AuthContextValue {
  session: AuthSession | null
  isAuthenticated: boolean
  currentUser: User | null
  loading: boolean
  hasProfile: boolean
  profileLoading: boolean
  login: (payload: LoginPayload) => Promise<void>
  register: (payload: RegisterPayload) => Promise<void>
  signInWithSocialProvider: (provider: SocialAuthProvider) => Promise<void>
  sendPasswordResetEmail: (email: string) => Promise<void>
  updateCurrentUser: (updates: Partial<User>) => void
  updateOnboarding: (updates: Partial<OnboardingState>) => void
  completeOnboarding: (updates?: Partial<OnboardingState>) => Promise<void>
  logout: (options?: { accessNotice?: string }) => Promise<void>
}

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'RESTORE_SESSION':
      return { ...state, session: action.payload, loading: false }
    case 'SET_SESSION':
      return { ...state, session: action.payload, loading: false }
    case 'CLEAR_SESSION':
      return { session: null, loading: false, hasProfile: false, profileLoading: false }
    case 'SET_PROFILE_STATUS':
      return { ...state, hasProfile: action.payload.hasProfile, profileLoading: action.payload.loading }
    default:
      return state
  }
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

type ProfileSnapshot = {
  id?: string
  organization_id: string | null
  active_organization_id: string | null
  full_name: string | null
  email: string | null
  avatar_url: string | null
  username: string | null
  role_label: string | null
  job_title: string | null
  account_status: AccountStatus | null
  deactivated_at: string | null
  deleted_at: string | null
  must_reset_password: boolean | null
  onboarding_completed: boolean | null
  onboarding_step: OnboardingState['currentStep'] | null
  onboarding_role: string | null
  onboarding_work_function: string | null
  onboarding_use_case: string | null
  onboarding_tools: string[] | null
  organization_name?: string | null
  organization_industry?: string | null
}

type CachedProfileSnapshot = ProfileSnapshot & {
  id: string
}

type ProfileTenantSnapshot = {
  organization_id: string | null
  active_organization_id: string | null
}

function normalizeOnboardingStep(step?: string | null): OnboardingState['currentStep'] {
  if (step === 'organization' || step === 'work' || step === 'tools') return step
  return 'name'
}

function generateUsernameCandidate(name?: string | null, email?: string | null) {
  const source = name?.trim() || email?.split('@')[0] || 'user'
  const base = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .replace(/^_+|_+$/g, '')

  return base || 'user'
}

function isDirectAvatarUrl(value?: string | null) {
  if (!value) return false
  return value.startsWith('http://') || value.startsWith('https://')
}

function isDataAvatarUrl(value?: string | null) {
  if (!value) return false
  return value.startsWith('data:')
}

function sanitizeAvatarUrl(value?: string | null) {
  return isDirectAvatarUrl(value) ? value ?? undefined : undefined
}

function sanitizeAvatarPath(value?: string | null) {
  if (!value || isDirectAvatarUrl(value) || isDataAvatarUrl(value)) return undefined
  return value ?? undefined
}

function createInitialOnboarding({
  fullName = '',
  completed,
}: {
  fullName?: string
  completed: boolean
}): OnboardingState {
  return {
    completed,
    currentStep: completed ? 'tools' : 'organization',
    fullName,
    organizationId: '',
    organizationName: '',
    organizationIndustry: '',
    role: '',
    workFunction: '',
    useCase: '',
    tools: [],
  }
}

function createOnboardingFromProfile(profile: Partial<ProfileSnapshot>, fallbackFullName = ''): OnboardingState {
  const completed = Boolean(profile.onboarding_completed)
  return {
    completed,
    currentStep: completed ? 'tools' : normalizeOnboardingStep(profile.onboarding_step),
    fullName: profile.full_name ?? fallbackFullName,
    organizationId: profile.active_organization_id ?? profile.organization_id ?? '',
    organizationName: profile.organization_name ?? '',
    organizationIndustry: profile.organization_industry ?? '',
    role: profile.onboarding_role ?? '',
    workFunction: profile.onboarding_work_function ?? '',
    useCase: profile.onboarding_use_case ?? '',
    tools: profile.onboarding_tools ?? [],
  }
}

function readCachedProfile(userId: string): CachedProfileSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.profileCache)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedProfileSnapshot
    return parsed.id === userId ? parsed : null
  } catch {
    return null
  }
}

function writeCachedProfile(profile: CachedProfileSnapshot) {
  localStorage.setItem(STORAGE_KEYS.profileCache, JSON.stringify(profile))
}

function clearCachedProfile() {
  localStorage.removeItem(STORAGE_KEYS.profileCache)
}

function writeAccessNotice(message: string) {
  sessionStorage.setItem(STORAGE_KEYS.accessNotice, message)
}

function clearAccessNotice() {
  sessionStorage.removeItem(STORAGE_KEYS.accessNotice)
}

function markPasswordRecoveryActive() {
  sessionStorage.setItem(STORAGE_KEYS.passwordRecoveryActive, 'true')
}

function clearPasswordRecoveryActive() {
  sessionStorage.removeItem(STORAGE_KEYS.passwordRecoveryActive)
}

function purgeCachedClientDataOnLogout() {
  const preservedKeys = new Set<string>([`${APP_STORAGE_PREFIX}.ui.theme`, STORAGE_KEYS.sidebarCollapsed])

  const localKeys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter(
    (key): key is string => Boolean(key),
  )
  for (const key of localKeys) {
    if (!key.startsWith(`${APP_STORAGE_PREFIX}.`) && !key.startsWith(`${LEGACY_STORAGE_PREFIX}.`)) continue
    if (preservedKeys.has(key)) continue
    localStorage.removeItem(key)
  }

  const sessionKeys = Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index)).filter(
    (key): key is string => Boolean(key),
  )
  for (const key of sessionKeys) {
    if (!key.startsWith(`${APP_STORAGE_PREFIX}.`) && !key.startsWith(`${LEGACY_STORAGE_PREFIX}.`)) continue
    sessionStorage.removeItem(key)
  }
}

function cacheProfileFromUser(user: User) {
  writeCachedProfile({
    id: user.id,
    organization_id: user.onboarding?.organizationId ?? null,
    active_organization_id: user.onboarding?.organizationId ?? null,
    full_name: user.name,
    email: user.email,
    avatar_url: user.avatarUrl ?? user.avatarPath ?? null,
    username: user.username ?? null,
    role_label: user.roleLabel ?? null,
    account_status: user.accountStatus ?? 'active',
    job_title: user.jobTitle ?? null,
    deactivated_at: null,
    deleted_at: null,
    must_reset_password: user.mustResetPassword ?? false,
    onboarding_completed: user.onboarding?.completed ?? false,
    onboarding_step: user.onboarding?.currentStep ?? 'organization',
    onboarding_role: user.onboarding?.role ?? null,
    onboarding_work_function: user.onboarding?.workFunction ?? null,
    onboarding_use_case: user.onboarding?.useCase ?? null,
    onboarding_tools: user.onboarding?.tools ?? [],
    organization_name: user.onboarding?.organizationName ?? null,
    organization_industry: user.onboarding?.organizationIndustry ?? null,
  })
}

function getAccessDeniedMessage(status: AccountStatus) {
  if (status === 'deleted') {
    return 'Your account has been deleted. Contact your administrator.'
  }

  return 'Your account has been deactivated. Contact your administrator.'
}

function getAppOrigin() {
  return window.location.origin
}

function getPasswordResetRedirectUrl() {
  return `${getAppOrigin()}/reset-password`
}

function getOAuthRedirectUrl() {
  return `${getAppOrigin()}/dashboard/home`
}

function extractStoredSupabaseSession() {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEYS.supabaseAuthToken) ??
      localStorage.getItem(STORAGE_KEYS.supabaseAuthTokenFallback) ??
      localStorage.getItem(STORAGE_KEYS.supabaseAuthTokenLegacy) ??
      localStorage.getItem(STORAGE_KEYS.supabaseAuthTokenLegacyFallback)
    if (!raw) return null

    const parsed = JSON.parse(raw) as
      | Session
      | { currentSession?: Session | null }
      | { session?: Session | null }
      | null

    if (!parsed) return null
    if ('access_token' in parsed && 'user' in parsed) return parsed as Session
    if ('currentSession' in parsed && parsed.currentSession) return parsed.currentSession
    if ('session' in parsed && parsed.session) return parsed.session
    return null
  } catch {
    return null
  }
}

function mapSupabaseSession(session: Session): AuthSession {
  const metadata = session.user.user_metadata ?? {}
  const email = session.user.email ?? 'user@example.com'
  const cachedProfile = readCachedProfile(session.user.id)
  const name =
    cachedProfile?.full_name ??
    metadata.full_name ??
    metadata.name ??
    email.split('@')[0]?.replace(/\./g, ' ') ??
    'User'
  const avatarPath = sanitizeAvatarPath(cachedProfile?.avatar_url) ?? sanitizeAvatarPath(metadata.avatar_path)
  const avatarUrl = sanitizeAvatarUrl(cachedProfile?.avatar_url) ?? sanitizeAvatarUrl(metadata.avatar_url)
  const metadataOnboarding = metadata.onboarding as Partial<OnboardingState> | undefined
  const onboarding = cachedProfile
    ? createOnboardingFromProfile(cachedProfile, name)
    : metadataOnboarding
    ? {
        ...createInitialOnboarding({ fullName: name, completed: Boolean(metadataOnboarding.completed) }),
        ...metadataOnboarding,
        currentStep: normalizeOnboardingStep(metadataOnboarding.currentStep),
      }
    : createInitialOnboarding({ fullName: name, completed: false })
  const username = cachedProfile?.username ?? (metadata.username as string | undefined) ?? generateUsernameCandidate(name, email)
  const roleLabel = cachedProfile?.role_label ?? (metadata.role_label as string | undefined)
  const accountStatus = cachedProfile?.account_status ?? (metadata.account_status as AccountStatus | undefined)
  const mustResetPassword = Boolean(cachedProfile?.must_reset_password ?? metadata.must_reset_password ?? false)
  const jobTitle = cachedProfile?.job_title ?? undefined

  return {
    user: {
      id: session.user.id,
      email: cachedProfile?.email ?? email,
      name,
      username,
      roleLabel: roleLabel ?? undefined,
      accountStatus: accountStatus ?? 'active',
      mustResetPassword,
      jobTitle,
      avatarUrl,
      avatarPath,
      onboarding,
    },
    token: session.access_token,
    expiresAt: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : new Date(Date.now() + 3600000).toISOString(),
  }
}

function mergeProfileIntoSession(session: AuthSession, profile: ProfileSnapshot): AuthSession {
  const accountStatus = profile.account_status ?? 'active'
  const avatarValue = profile.avatar_url ?? null

  return {
    ...session,
    user: {
      ...session.user,
      name: profile.full_name ?? session.user.name,
      email: profile.email ?? session.user.email,
      username: profile.username ?? session.user.username,
      roleLabel: profile.role_label ?? session.user.roleLabel,
      accountStatus,
      mustResetPassword: profile.must_reset_password ?? session.user.mustResetPassword,
      jobTitle: profile.job_title ?? session.user.jobTitle,
      avatarUrl: sanitizeAvatarUrl(avatarValue) ?? session.user.avatarUrl,
      avatarPath: sanitizeAvatarPath(avatarValue) ?? session.user.avatarPath,
      onboarding: createOnboardingFromProfile(profile, profile.full_name ?? session.user.name),
    },
  }
}

function createInitialAuthState(): AuthState {
  const storedSession = extractStoredSupabaseSession()
  if (!storedSession) {
    return {
      session: null,
      loading: true,
      hasProfile: false,
      profileLoading: true,
    }
  }

  const mappedSession = mapSupabaseSession(storedSession)
  const cachedProfile = readCachedProfile(mappedSession.user.id)

  return {
    session: mappedSession,
    loading: true,
    hasProfile: Boolean(cachedProfile),
    profileLoading: !cachedProfile,
  }
}

async function resolveProfileTenantSnapshot(userId: string): Promise<ProfileTenantSnapshot | null> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, active_organization_id')
    .eq('id', userId)
    .maybeSingle()

  if (profile?.organization_id) {
    return {
      organization_id: profile.organization_id,
      active_organization_id: profile.active_organization_id ?? profile.organization_id,
    }
  }

  const { data: membership } = await supabase
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!membership?.organization_id) return null

  return {
    organization_id: membership.organization_id,
    active_organization_id: membership.organization_id,
  }
}

async function upsertProfileRecord(user: User) {
  const avatarUrl = sanitizeAvatarUrl(user.avatarUrl)
  const avatarPath = sanitizeAvatarPath(user.avatarPath)
  const tenantSnapshot = await resolveProfileTenantSnapshot(user.id)
  const onboarding = user.onboarding ?? createInitialOnboarding({ fullName: user.name, completed: false })

  const { error } = await supabase.from('profiles').upsert({
    id: user.id,
    ...(tenantSnapshot?.organization_id
      ? {
          organization_id: tenantSnapshot.organization_id,
          active_organization_id: tenantSnapshot.active_organization_id ?? tenantSnapshot.organization_id,
        }
      : {}),
    full_name: user.name,
    username: user.username ?? generateUsernameCandidate(user.name, user.email),
    role_label: user.roleLabel ?? null,
    must_reset_password: user.mustResetPassword ?? false,
    job_title: user.jobTitle ?? null,
    email: user.email,
    avatar_url: avatarUrl ?? avatarPath ?? null,
    onboarding_completed: onboarding.completed,
    onboarding_step: onboarding.currentStep,
    onboarding_role: onboarding.role || null,
    onboarding_work_function: onboarding.workFunction || null,
    onboarding_use_case: onboarding.useCase || null,
    onboarding_tools: onboarding.tools,
  })

  if (error) throw error
}

function persistProfileRecord(user: User) {
  cacheProfileFromUser(user)
  void upsertProfileRecord(user).catch(() => {})
}

function shouldPersistProfile(hasProfile: boolean, user: User) {
  return hasProfile || user.onboarding?.completed === true
}

async function attachOrganizationToProfileSnapshot(profile: ProfileSnapshot): Promise<ProfileSnapshot> {
  const organizationId = profile.active_organization_id ?? profile.organization_id
  if (!organizationId) return profile

  const { data } = await supabase
    .from('organizations')
    .select('name, industry')
    .eq('id', organizationId)
    .maybeSingle()

  return {
    ...profile,
    organization_name: data?.name ?? profile.organization_name ?? null,
    organization_industry: data?.industry ?? profile.organization_industry ?? null,
  }
}

async function fetchProfileSnapshot(userId: string) {
  const baseSelect = 'id, organization_id, active_organization_id, full_name, email, avatar_url, username, role_label, job_title'
  const statusSelect = 'account_status, deactivated_at, deleted_at'
  const onboardingSelect =
    'onboarding_completed, onboarding_step, onboarding_role, onboarding_work_function, onboarding_use_case, onboarding_tools'
  const withResetSelect = `${baseSelect}, ${statusSelect}, must_reset_password, ${onboardingSelect}`

  const withResetResult = await supabase.from('profiles').select(withResetSelect).eq('id', userId).maybeSingle()
  if (!withResetResult.error && withResetResult.data) {
    return attachOrganizationToProfileSnapshot(withResetResult.data as ProfileSnapshot)
  }

  const shouldRetryWithoutResetField =
    Boolean(withResetResult.error) &&
    /must_reset_password|account_status|deactivated_at|deleted_at|onboarding_|active_organization_id|organization_id|column .* does not exist|schema cache/i.test(
      withResetResult.error?.message ?? '',
    )

  if (!shouldRetryWithoutResetField) {
    return null
  }

  const fallbackResult = await supabase.from('profiles').select(baseSelect).eq('id', userId).maybeSingle()
  if (fallbackResult.error || !fallbackResult.data) return null

  return attachOrganizationToProfileSnapshot({
    ...(fallbackResult.data as Omit<ProfileSnapshot, 'must_reset_password'>),
    account_status: 'active',
    deactivated_at: null,
    deleted_at: null,
    must_reset_password: false,
    onboarding_completed: false,
    onboarding_step: 'name',
    onboarding_role: null,
    onboarding_work_function: null,
    onboarding_use_case: null,
    onboarding_tools: [],
  } as ProfileSnapshot)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, undefined, createInitialAuthState)
  const lastProfileSnapshotKeyRef = useRef<string | null>(null)

  const setSession = useCallback((session: AuthSession) => {
    cacheProfileFromUser(session.user)
    dispatch({ type: 'SET_SESSION', payload: session })
  }, [])

  const logout = useCallback(
    async (options?: { accessNotice?: string }) => {
      if (state.session?.user.id) {
        try {
          await supabase
            .from('profiles')
            .update({
              is_online: false,
              last_seen_at: new Date().toISOString(),
            })
            .eq('id', state.session.user.id)
        } catch {
          // ignore presence write failures on logout
        }
      }
      await supabase.auth.signOut().catch(() => undefined)
      localStorage.removeItem(STORAGE_KEYS.supabaseAuthToken)
      localStorage.removeItem(STORAGE_KEYS.supabaseAuthTokenFallback)
      localStorage.removeItem(STORAGE_KEYS.supabaseAuthTokenLegacy)
      localStorage.removeItem(STORAGE_KEYS.supabaseAuthTokenLegacyFallback)
      clearCachedProfile()
      purgeCachedClientDataOnLogout()
      clearAccessNotice()
      if (options?.accessNotice) {
        writeAccessNotice(options.accessNotice)
      }
      dispatch({ type: 'CLEAR_SESSION' })
    },
    [state.session?.user.id],
  )

  useEffect(() => {
    let mounted = true

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return
      if (error || !data.session) {
        clearCachedProfile()
        dispatch({ type: 'RESTORE_SESSION', payload: null })
        return
      }

      dispatch({ type: 'RESTORE_SESSION', payload: mapSupabaseSession(data.session) })
    })

    const { data } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, nextSession) => {
      if (!mounted) return

      if (event === 'PASSWORD_RECOVERY') {
        markPasswordRecoveryActive()
      }

      if (!nextSession) {
        clearCachedProfile()
        clearPasswordRecoveryActive()
        dispatch({ type: 'CLEAR_SESSION' })
        return
      }

      setSession(mapSupabaseSession(nextSession))
    })

    return () => {
      mounted = false
      data.subscription.unsubscribe()
    }
  }, [setSession])

  useEffect(() => {
    if (!state.session?.user.id) {
      dispatch({ type: 'SET_PROFILE_STATUS', payload: { hasProfile: false, loading: false } })
      return
    }

    let cancelled = false
    dispatch({ type: 'SET_PROFILE_STATUS', payload: { hasProfile: state.hasProfile, loading: true } })

    void fetchProfileSnapshot(state.session.user.id).then((profile) => {
      if (cancelled) return

      if (!profile) {
        dispatch({ type: 'SET_PROFILE_STATUS', payload: { hasProfile: false, loading: false } })
        return
      }

      const accountStatus = profile.account_status ?? 'active'
      if (accountStatus !== 'active') {
        void logout({ accessNotice: getAccessDeniedMessage(accountStatus) })
        return
      }

      const nextSession = mergeProfileIntoSession(state.session!, profile)
      writeCachedProfile({
        id: state.session!.user.id,
        ...profile,
        account_status: accountStatus,
        deactivated_at: profile.deactivated_at ?? null,
        deleted_at: profile.deleted_at ?? null,
      })
      dispatch({ type: 'SET_SESSION', payload: nextSession })
      dispatch({ type: 'SET_PROFILE_STATUS', payload: { hasProfile: true, loading: false } })
    })

    return () => {
      cancelled = true
    }
  }, [logout, state.hasProfile, state.session?.user.id])

  useEffect(() => {
    if (!state.session?.user.id || !state.hasProfile) return

    let cancelled = false
    const userId = state.session.user.id

    void fetchProfileSnapshot(userId).then((profile) => {
      if (cancelled || !profile) return

      const accountStatus = profile.account_status ?? 'active'
      if (accountStatus !== 'active') {
        void logout({ accessNotice: getAccessDeniedMessage(accountStatus) })
        return
      }

      const avatarValue = profile.avatar_url ?? null
      const nextSnapshotKey = JSON.stringify({
        userId,
        organization_id: profile.organization_id ?? null,
        active_organization_id: profile.active_organization_id ?? null,
        organization_name: profile.organization_name ?? null,
        organization_industry: profile.organization_industry ?? null,
        full_name: profile.full_name ?? null,
        email: profile.email ?? null,
        username: profile.username ?? null,
        role_label: profile.role_label ?? null,
        account_status: accountStatus,
        must_reset_password: profile.must_reset_password ?? false,
        job_title: profile.job_title ?? null,
        avatar_url: avatarValue,
        onboarding_completed: profile.onboarding_completed ?? false,
        onboarding_step: profile.onboarding_step ?? 'organization',
        onboarding_role: profile.onboarding_role ?? null,
        onboarding_work_function: profile.onboarding_work_function ?? null,
        onboarding_use_case: profile.onboarding_use_case ?? null,
        onboarding_tools: profile.onboarding_tools ?? [],
      })

      if (lastProfileSnapshotKeyRef.current === nextSnapshotKey) return
      lastProfileSnapshotKeyRef.current = nextSnapshotKey

      writeCachedProfile({
        id: userId,
        ...profile,
        account_status: accountStatus,
        deactivated_at: profile.deactivated_at ?? null,
        deleted_at: profile.deleted_at ?? null,
      })
      const nextSession = mergeProfileIntoSession(state.session!, profile)

      dispatch({ type: 'SET_SESSION', payload: nextSession })
    })

    return () => {
      cancelled = true
    }
  }, [logout, state.hasProfile, state.session?.user.id])

  const login = useCallback(
    async ({ email, password }: LoginPayload) => {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      if (!data.session) throw new Error('Supabase login did not return a session.')

      // Only check account status if a profile exists.
      // New users won't have one yet — they'll be sent to onboarding by the route guard.
      const profile = await fetchProfileSnapshot(data.session.user.id)
      if (profile) {
        const accountStatus = profile.account_status ?? 'active'
        if (accountStatus !== 'active') {
          await supabase.auth.signOut().catch(() => undefined)
          throw new Error(getAccessDeniedMessage(accountStatus))
        }
      }

      const nextSession = profile
        ? mergeProfileIntoSession(mapSupabaseSession(data.session), profile)
        : mapSupabaseSession(data.session)
      setSession(nextSession)
    },
    [setSession],
  )

  const register = useCallback(async ({ email, password }: RegisterPayload) => {
    const { data, error } = await supabase.auth.signUp({ email, password })

    if (error) throw error

    if (!data.session) {
      // Email confirmation is required — no session yet.
      throw new Error('email_confirmation_required')
    }

    setSession(mapSupabaseSession(data.session))
  }, [setSession])

  const signInWithSocialProvider = useCallback(async (provider: SocialAuthProvider) => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: getOAuthRedirectUrl(),
      },
    })

    if (error) throw error
  }, [])

  const sendPasswordResetEmail = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: getPasswordResetRedirectUrl(),
    })

    if (error) throw error
  }, [])

  const updateCurrentUser = useCallback(
    (updates: Partial<User>) => {
      if (!state.session) return

      const updatedSession: AuthSession = {
        ...state.session,
        user: {
          ...state.session.user,
          ...updates,
        },
      }

      setSession(updatedSession)
      cacheProfileFromUser(updatedSession.user)
      if (shouldPersistProfile(state.hasProfile, updatedSession.user)) {
        dispatch({ type: 'SET_PROFILE_STATUS', payload: { hasProfile: true, loading: false } })
        persistProfileRecord(updatedSession.user)
      }
    },
    [setSession, state.hasProfile, state.session],
  )

  const updateOnboarding = useCallback(
    (updates: Partial<OnboardingState>) => {
      if (!state.session) return

      const currentOnboarding =
        state.session.user.onboarding ?? createInitialOnboarding({ fullName: state.session.user.name, completed: false })

      const updatedSession: AuthSession = {
        ...state.session,
        user: {
          ...state.session.user,
          onboarding: {
            ...currentOnboarding,
            ...updates,
          },
        },
      }

      setSession(updatedSession)
      cacheProfileFromUser(updatedSession.user)
      if (shouldPersistProfile(state.hasProfile, updatedSession.user)) {
        dispatch({ type: 'SET_PROFILE_STATUS', payload: { hasProfile: true, loading: false } })
        persistProfileRecord(updatedSession.user)
      }
    },
    [setSession, state.hasProfile, state.session],
  )

  const completeOnboarding = useCallback(async (updates?: Partial<OnboardingState>) => {
    if (!state.session) return

    const currentOnboarding =
      state.session.user.onboarding ?? createInitialOnboarding({ fullName: state.session.user.name, completed: false })
    const nextOnboarding: OnboardingState = {
      ...currentOnboarding,
      ...updates,
      completed: true,
      currentStep: 'tools',
    }
    const updatedUser: User = {
      ...state.session.user,
      onboarding: nextOnboarding,
    }
    const updatedSession: AuthSession = {
      ...state.session,
      user: updatedUser,
    }

    setSession(updatedSession)
    cacheProfileFromUser(updatedUser)
    dispatch({ type: 'SET_PROFILE_STATUS', payload: { hasProfile: true, loading: false } })
    persistProfileRecord(updatedUser)
  }, [setSession, state.session])

  const value = useMemo<AuthContextValue>(
    () => ({
      session: state.session,
      isAuthenticated: Boolean(state.session),
      currentUser: state.session?.user ?? null,
      loading: state.loading,
      hasProfile: state.hasProfile,
      profileLoading: state.profileLoading,
      login,
      register,
      signInWithSocialProvider,
      sendPasswordResetEmail,
      updateCurrentUser,
      updateOnboarding,
      completeOnboarding,
      logout,
    }),
    [
      completeOnboarding,
      login,
      logout,
      register,
      sendPasswordResetEmail,
      signInWithSocialProvider,
      state.hasProfile,
      state.loading,
      state.profileLoading,
      state.session,
      updateCurrentUser,
      updateOnboarding,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
