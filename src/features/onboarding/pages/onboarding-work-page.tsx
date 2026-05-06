import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/context/auth-context'

import { OnboardingShell } from '../components/onboarding-shell'

const ROLE_OPTIONS = [
  'C-Suite / Executive',
  'Managing Director',
  'Department Head',
  'Manager / Team Lead',
  'Finance & Accounting',
  'Operations',
  'HR & People',
  'IT / Systems Admin',
  'Individual Contributor',
  'Consultant / Advisor',
] as const

const FUNCTION_OPTIONS = [
  'Finance & Accounting',
  'Human Resources',
  'Supply Chain & Procurement',
  'Operations & Logistics',
  'Sales & Revenue',
  'Customer Service',
  'IT & Systems',
  'Project Management',
  'Marketing',
  'Legal & Compliance',
  'Engineering & Production',
  'Executive / Strategy',
] as const

const USE_CASE_OPTIONS = [
  'Financial Management & Reporting',
  'HR & Payroll Management',
  'Project & Delivery Management',
  'Supply Chain & Inventory',
  'Sales Pipeline & CRM',
  'Operations & Process Automation',
  'Cross-department Collaboration',
  'Executive Dashboards & Analytics',
  'Compliance & Audit Trails',
] as const

export function OnboardingWorkPage() {
  const navigate = useNavigate()
  const { currentUser, updateOnboarding } = useAuth()

  const [role, setRole] = useState(currentUser?.onboarding?.role ?? '')
  const [workFunction, setWorkFunction] = useState(currentUser?.onboarding?.workFunction ?? '')
  const [useCase, setUseCase] = useState(currentUser?.onboarding?.useCase ?? '')

  const canContinue = Boolean(role && workFunction && useCase)

  return (
    <OnboardingShell
      title='Tell us about your organization'
      subtitle='This helps us configure your ERP modules and tailor the system to how your business operates.'
      backTo='/onboarding/name'
    >
      <div className='space-y-4'>
        <div className='space-y-2'>
          <label className='text-sm font-medium text-foreground'>What&apos;s your role in the organization?</label>
          <select
            value={role}
            onChange={(event) => setRole(event.target.value)}
            className='flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
          >
            <option value=''>Select role</option>
            {ROLE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <div className='space-y-2'>
          <label className='text-sm font-medium text-foreground'>Which business function do you work in?</label>
          <select
            value={workFunction}
            onChange={(event) => setWorkFunction(event.target.value)}
            className='flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
          >
            <option value=''>Select function</option>
            {FUNCTION_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <div className='space-y-2'>
          <label className='text-sm font-medium text-foreground'>What will you primarily use CloudNine ERP for?</label>
          <select
            value={useCase}
            onChange={(event) => setUseCase(event.target.value)}
            className='flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
          >
            <option value=''>Select use case</option>
            {USE_CASE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <Button
          className='mt-2 w-full'
          disabled={!canContinue}
          onClick={() => {
            updateOnboarding({ role, workFunction, useCase, currentStep: 'tools' })
            navigate('/onboarding/tools')
          }}
        >
          Continue
        </Button>
      </div>
    </OnboardingShell>
  )
}
