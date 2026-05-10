import type { OnboardingState, OnboardingStep } from '@/types/auth'

export const ONBOARDING_STEPS: OnboardingStep[] = ['organization', 'name', 'work', 'tools']

export function getOnboardingPath(step: OnboardingStep) {
  return `/onboarding/${step}`
}

export function getOnboardingStepFromPathname(pathname: string): OnboardingStep | null {
  const step = pathname.replace('/onboarding/', '')
  return ONBOARDING_STEPS.includes(step as OnboardingStep) ? (step as OnboardingStep) : null
}

function hasOrganization(state: OnboardingState) {
  return Boolean(state.organizationId || state.organizationName.trim().length >= 2)
}

function hasName(state: OnboardingState) {
  return state.fullName.trim().length >= 2
}

function hasWork(state: OnboardingState) {
  return Boolean(state.role && state.workFunction && state.useCase)
}

export function canAccessOnboardingStep(step: OnboardingStep, state: OnboardingState) {
  if (step === 'organization') return true
  if (step === 'name') return hasOrganization(state)
  if (step === 'work') return hasOrganization(state) && hasName(state)
  return hasOrganization(state) && hasName(state) && hasWork(state)
}

export function getFirstIncompleteOnboardingStep(state: OnboardingState): OnboardingStep {
  if (!hasOrganization(state)) return 'organization'
  if (!hasName(state)) return 'name'
  if (!hasWork(state)) return 'work'
  return 'tools'
}
