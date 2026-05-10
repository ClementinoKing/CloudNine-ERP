import { Building2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/features/auth/context/auth-context'
import { notify } from '@/lib/notify'
import { supabase } from '@/lib/supabase'

import { OnboardingShell } from '../components/onboarding-shell'

const INDUSTRY_OPTIONS = [
  'Technology & Software',
  'Manufacturing & Production',
  'Retail & E-commerce',
  'Healthcare & Medical',
  'Finance & Banking',
  'Education & Training',
  'Construction & Real Estate',
  'Transportation & Logistics',
  'Hospitality & Tourism',
  'Professional Services',
  'Agriculture & Food',
  'Energy & Utilities',
  'Media & Entertainment',
  'Non-profit & Government',
  'Other',
] as const

type OnboardingOrganization = {
  id: string
  name: string
  slug: string
  industry: string
}

export function OnboardingOrganizationPage() {
  const navigate = useNavigate()
  const { currentUser, updateOnboarding } = useAuth()
  const [organizationName, setOrganizationName] = useState(currentUser?.onboarding?.organizationName ?? '')
  const [industry, setIndustry] = useState(currentUser?.onboarding?.organizationIndustry ?? '')
  const [creating, setCreating] = useState(false)

  const canContinue = organizationName.trim().length >= 2 && industry.length > 0

  const handleContinue = async () => {
    if (!canContinue || !currentUser?.id) return

    setCreating(true)
    try {
      const trimmedName = organizationName.trim()
      const { data, error } = await supabase.rpc('create_onboarding_organization', {
        p_name: trimmedName,
        p_industry: industry,
        p_plan: 'Enterprise',
      })

      if (error) throw error

      const organization = Array.isArray(data) ? (data[0] as OnboardingOrganization | undefined) : undefined
      if (!organization?.id) throw new Error('Organization was not created. Please try again.')

      // Store org ID in onboarding state so the profile step can link to it
      updateOnboarding({
        organizationId: organization.id,
        organizationName: organization.name,
        organizationIndustry: organization.industry,
        currentStep: 'name',
      })
      navigate('/onboarding/name')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create organization'
      notify.error('Organization creation failed', { description: message })
    } finally {
      setCreating(false)
    }
  }

  return (
    <OnboardingShell
      title="Let's set up your organization"
      subtitle='Start by creating your organization. Your profile will be linked to it.'
    >
      <div className='space-y-4'>
        <div className='space-y-2'>
          <label htmlFor='organization-name' className='text-sm font-medium text-foreground'>
            Organization name
          </label>
          <Input
            id='organization-name'
            value={organizationName}
            onChange={(event) => setOrganizationName(event.target.value)}
            placeholder='Acme Corporation'
            autoFocus
          />
          {organizationName.trim().length < 2 ? (
            <p className='text-xs text-muted-foreground'>Enter your organization name to continue.</p>
          ) : null}
        </div>

        <div className='space-y-2'>
          <label htmlFor='industry' className='text-sm font-medium text-foreground'>
            Industry
          </label>
          <select
            id='industry'
            value={industry}
            onChange={(event) => setIndustry(event.target.value)}
          >
            <option value=''>Select industry</option>
            {INDUSTRY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <Button className='mt-2 w-full' disabled={!canContinue || creating} onClick={handleContinue}>
          <Building2 className='h-4 w-4' />
          {creating ? 'Creating organization...' : 'Continue'}
        </Button>
      </div>
    </OnboardingShell>
  )
}
