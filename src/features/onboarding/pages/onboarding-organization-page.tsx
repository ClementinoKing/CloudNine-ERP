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

function generateSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
}

function appendSlugSuffix(baseSlug: string): string {
  const suffix = crypto.randomUUID().slice(0, 6).toLowerCase()
  const trimmedBase = baseSlug.slice(0, Math.max(1, 50 - (suffix.length + 1)))
  return `${trimmedBase}-${suffix}`
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const maybeCode = 'code' in error ? String(error.code ?? '') : ''
  const maybeMessage = 'message' in error ? String(error.message ?? '') : ''
  return maybeCode === '23505' || maybeMessage.toLowerCase().includes('duplicate key')
}

function isForeignKeyViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const maybeCode = 'code' in error ? String(error.code ?? '') : ''
  const maybeMessage = 'message' in error ? String(error.message ?? '').toLowerCase() : ''
  return maybeCode === '23503' || maybeMessage.includes('foreign key')
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
      const organizationId = crypto.randomUUID()
      const trimmedName = organizationName.trim()
      const baseSlug = generateSlug(trimmedName)
      let lastError: unknown = null
      let created = false

      // Some environments still enforce organizations.created_by -> profiles(id),
      // so make sure the self profile row exists before org creation.
      const { error: profileError } = await supabase.from('profiles').upsert({
        id: currentUser.id,
        email: currentUser.email,
      })
      if (profileError) throw profileError

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const slug = attempt === 0 ? baseSlug : appendSlugSuffix(baseSlug)

        // Create the organization. The database trigger assigns the owner membership.
        const { error: orgError } = await supabase
          .from('organizations')
          .insert({
            id: organizationId,
            name: trimmedName,
            slug,
            plan: 'Enterprise',
            industry,
            created_by: currentUser.id,
          })

        if (!orgError) {
          created = true
          break
        }

        lastError = orgError
        if (!isUniqueViolation(orgError) && !isForeignKeyViolation(orgError)) break
      }

      if (!created) throw lastError ?? new Error('Failed to create organization')

      // Store org ID in onboarding state so the profile step can link to it
      updateOnboarding({
        organizationId,
        organizationName: trimmedName,
        organizationIndustry: industry,
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
