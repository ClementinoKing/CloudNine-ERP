export type OnboardingStep = 'name' | 'work' | 'tools'
export type AccountStatus = 'active' | 'deactivated' | 'deleted'

export interface OnboardingState {
  completed: boolean
  currentStep: OnboardingStep
  fullName: string
  role: string
  workFunction: string
  useCase: string
  tools: string[]
}

export interface User {
  id: string
  email: string
  name: string
  username?: string
  roleLabel?: string
  accountStatus?: AccountStatus
  mustResetPassword?: boolean
  jobTitle?: string
  avatarUrl?: string
  avatarPath?: string
  onboarding?: OnboardingState
}

export interface AuthSession {
  user: User
  token: string
  expiresAt: string
}

export interface LoginPayload {
  email: string
  password: string
}

export interface RegisterPayload {
  name: string
  email: string
  password: string
}
