import { Building2, Clock3, Globe, Mail, MapPin, ReceiptText, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useState, type InputHTMLAttributes } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useOrganization } from '@/features/organization/context/organization-context'
import { buildOrganizationSettingsValues } from '@/features/organization/lib/organization-settings'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import type { Organization, OrganizationSettingsValues } from '@/types/organization'

type OrganizationSettingsErrors = Partial<Record<keyof OrganizationSettingsValues, string>>

const FIELD_CLASS_NAME = 'space-y-2'
const TEXTAREA_CLASS_NAME =
  'flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'

function createDraftValues(organization: Organization): OrganizationSettingsValues {
  return buildOrganizationSettingsValues(organization)
}

function normalizeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function normalizeWebsite(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function isValidUrl(value: string) {
  try {
    const parsed = new URL(normalizeWebsite(value))
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function formatDateTime(value?: string) {
  if (!value) return 'Not set'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not set'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function SettingsField({
  id,
  label,
  description,
  value,
  onChange,
  placeholder,
  type = 'text',
  autoComplete,
  inputMode,
  readOnly,
  error,
}: {
  id: string
  label: string
  description?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  autoComplete?: string
  inputMode?: InputHTMLAttributes<HTMLInputElement>['inputMode']
  readOnly?: boolean
  error?: string
}) {
  return (
    <div className={FIELD_CLASS_NAME}>
      <div className='space-y-1'>
        <label htmlFor={id} className='text-sm font-medium text-foreground'>
          {label}
        </label>
        {description ? <p className='text-xs text-muted-foreground'>{description}</p> : null}
      </div>
      <Input
        id={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        inputMode={inputMode}
        readOnly={readOnly}
        placeholder={placeholder}
        aria-invalid={Boolean(error)}
        className={cn(error ? 'border-destructive focus-visible:ring-destructive' : '')}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? <p className='text-xs text-destructive'>{error}</p> : null}
    </div>
  )
}

function SettingsTextareaField({
  id,
  label,
  description,
  value,
  onChange,
  placeholder,
  error,
}: {
  id: string
  label: string
  description?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  error?: string
}) {
  return (
    <div className='space-y-2 md:col-span-2'>
      <div className='space-y-1'>
        <label htmlFor={id} className='text-sm font-medium text-foreground'>
          {label}
        </label>
        {description ? <p className='text-xs text-muted-foreground'>{description}</p> : null}
      </div>
      <textarea
        id={id}
        value={value}
        placeholder={placeholder}
        aria-invalid={Boolean(error)}
        className={cn(TEXTAREA_CLASS_NAME, error ? 'border-destructive focus-visible:ring-destructive' : '')}
        rows={5}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? <p className='text-xs text-destructive'>{error}</p> : null}
    </div>
  )
}

function validate(values: OrganizationSettingsValues) {
  const errors: OrganizationSettingsErrors = {}
  const normalizedSlug = normalizeSlug(values.slug)

  if (!values.name.trim()) {
    errors.name = 'Organization name is required.'
  }

  if (!normalizedSlug) {
    errors.slug = 'Organization slug is required.'
  } else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalizedSlug)) {
    errors.slug = 'Use only lowercase letters, numbers, and hyphens.'
  }

  if (values.website.trim() && !isValidUrl(values.website)) {
    errors.website = 'Enter a valid website URL.'
  }

  if (values.contactEmail.trim() && !isValidEmail(values.contactEmail.trim())) {
    errors.contactEmail = 'Enter a valid email address.'
  }

  const currency = values.defaultCurrency.trim().toUpperCase()
  if (currency && !/^[A-Z]{3}$/.test(currency)) {
    errors.defaultCurrency = 'Use a 3-letter currency code, such as USD or MWK.'
  }

  return errors
}

function getDirtyState(current: OrganizationSettingsValues, next: OrganizationSettingsValues) {
  return JSON.stringify(current) !== JSON.stringify(next)
}

export function OrganizationSettingsForm() {
  const { currentOrganization, updateOrganization } = useOrganization()
  const [draft, setDraft] = useState<OrganizationSettingsValues>(() => createDraftValues(currentOrganization))
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<OrganizationSettingsErrors>({})

  useEffect(() => {
    setDraft(createDraftValues(currentOrganization))
    setErrors({})
  }, [currentOrganization])

  const initialDraft = useMemo(() => createDraftValues(currentOrganization), [currentOrganization])
  const isDirty = useMemo(() => getDirtyState(initialDraft, draft), [draft, initialDraft])

  const updateField = <K extends keyof OrganizationSettingsValues>(key: K, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }))
    if (errors[key]) {
      setErrors((current) => {
        const next = { ...current }
        delete next[key]
        return next
      })
    }
  }

  const handleReset = () => {
    setDraft(createDraftValues(currentOrganization))
    setErrors({})
  }

  const handleSave = async () => {
    const nextErrors = validate(draft)
    setErrors(nextErrors)

    if (Object.keys(nextErrors).length > 0) {
      notify.error('Fix the highlighted organization settings before saving.')
      return
    }

    setSaving(true)
    try {
      const normalizedDraft: OrganizationSettingsValues = {
        ...draft,
        name: draft.name.trim(),
        slug: normalizeSlug(draft.slug),
        website: normalizeWebsite(draft.website),
        contactEmail: draft.contactEmail.trim(),
        phone: draft.phone.trim(),
        industry: draft.industry.trim(),
        size: draft.size.trim(),
        timezone: draft.timezone.trim(),
        location: draft.location.trim(),
        country: draft.country.trim(),
        addressLine1: draft.addressLine1.trim(),
        addressLine2: draft.addressLine2.trim(),
        city: draft.city.trim(),
        postalCode: draft.postalCode.trim(),
        defaultCurrency: draft.defaultCurrency.trim().toUpperCase(),
        registrationNumber: draft.registrationNumber.trim(),
        taxId: draft.taxId.trim(),
        brandingLogoUrl: draft.brandingLogoUrl.trim(),
        brandingPrimaryColor: draft.brandingPrimaryColor.trim().toUpperCase(),
        brandingAccentColor: draft.brandingAccentColor.trim().toUpperCase(),
        description: draft.description.trim(),
      }

      await updateOrganization(currentOrganization.id, normalizedDraft)
      setDraft(normalizedDraft)
      notify.success('Organization settings updated', {
        description: `${normalizedDraft.name} has been saved successfully.`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update organization settings.'
      notify.error('Unable to update organization settings', { description: message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className='grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_340px]'>
      <div className='space-y-4'>
        <Card className='border-border/60 bg-card/90'>
          <CardHeader className='pb-4'>
            <div className='flex flex-wrap items-start justify-between gap-3'>
              <div className='space-y-1'>
                <CardTitle className='text-lg'>Identity</CardTitle>
                <p className='text-sm text-muted-foreground'>Control the legal and platform identity used across the product.</p>
              </div>
              <Badge variant='outline' className='gap-1.5'>
                <ShieldCheck className='h-3.5 w-3.5' />
                {currentOrganization.plan}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className='grid gap-4 md:grid-cols-2'>
            <SettingsField
              id='org-name'
              label='Organization name'
              value={draft.name}
              onChange={(value) => updateField('name', value)}
              autoComplete='organization'
              error={errors.name}
            />
            <SettingsField
              id='org-plan'
              label='Plan'
              value={currentOrganization.plan}
              onChange={() => {}}
              readOnly
            />
            <SettingsField
              id='org-legal-name'
              label='Legal name'
              value={draft.legalName}
              onChange={(value) => updateField('legalName', value)}
            />
            <SettingsField
              id='org-slug'
              label='Organization slug'
              value={draft.slug}
              onChange={(value) => updateField('slug', value)}
              placeholder='cloudnine-erp'
              error={errors.slug}
            />
            <SettingsField
              id='org-registration-number'
              label='Registration number'
              value={draft.registrationNumber}
              onChange={(value) => updateField('registrationNumber', value)}
            />
            <SettingsField
              id='org-tax-id'
              label='Tax ID'
              value={draft.taxId}
              onChange={(value) => updateField('taxId', value)}
            />
          </CardContent>
        </Card>

        <Card className='border-border/60 bg-card/90'>
          <CardHeader className='pb-4'>
            <CardTitle className='text-lg'>Contact and location</CardTitle>
          </CardHeader>
          <CardContent className='grid gap-4 md:grid-cols-2'>
            <SettingsField
              id='org-website'
              label='Website'
              value={draft.website}
              onChange={(value) => updateField('website', value)}
              placeholder='cloudnine.co.za'
              autoComplete='url'
              error={errors.website}
            />
            <SettingsField
              id='org-contact-email'
              label='Contact email'
              value={draft.contactEmail}
              onChange={(value) => updateField('contactEmail', value)}
              type='email'
              autoComplete='email'
              error={errors.contactEmail}
            />
            <SettingsField
              id='org-phone'
              label='Phone'
              value={draft.phone}
              onChange={(value) => updateField('phone', value)}
              type='tel'
              autoComplete='tel'
            />
            <SettingsField
              id='org-country'
              label='Country'
              value={draft.country}
              onChange={(value) => updateField('country', value)}
            />
            <SettingsField
              id='org-timezone'
              label='Timezone'
              value={draft.timezone}
              onChange={(value) => updateField('timezone', value)}
              placeholder='Africa/Blantyre'
            />
            <SettingsField
              id='org-location'
              label='Location'
              value={draft.location}
              onChange={(value) => updateField('location', value)}
              placeholder='Lilongwe, Malawi'
            />
            <SettingsField
              id='org-address-line1'
              label='Address line 1'
              value={draft.addressLine1}
              onChange={(value) => updateField('addressLine1', value)}
              placeholder='Plot 123, Main Road'
            />
            <SettingsField
              id='org-address-line2'
              label='Address line 2'
              value={draft.addressLine2}
              onChange={(value) => updateField('addressLine2', value)}
              placeholder='Suite 4B'
            />
            <SettingsField
              id='org-city'
              label='City'
              value={draft.city}
              onChange={(value) => updateField('city', value)}
            />
            <SettingsField
              id='org-postal-code'
              label='Postal code'
              value={draft.postalCode}
              onChange={(value) => updateField('postalCode', value)}
            />
          </CardContent>
        </Card>

        <Card className='border-border/60 bg-card/90'>
          <CardHeader className='pb-4'>
            <CardTitle className='text-lg'>Operations</CardTitle>
          </CardHeader>
          <CardContent className='grid gap-4 md:grid-cols-2'>
            <SettingsField
              id='org-industry'
              label='Industry'
              value={draft.industry}
              onChange={(value) => updateField('industry', value)}
            />
            <SettingsField
              id='org-size'
              label='Company size'
              value={draft.size}
              onChange={(value) => updateField('size', value)}
              placeholder='51-200 employees'
            />
            <SettingsField
              id='org-currency'
              label='Default currency'
              value={draft.defaultCurrency}
              onChange={(value) => updateField('defaultCurrency', value)}
              placeholder='MWK'
              error={errors.defaultCurrency}
            />
            <div className='space-y-2 rounded-md border bg-muted/10 p-4'>
              <div className='flex items-center gap-2 text-sm font-medium text-foreground'>
                <ReceiptText className='h-4 w-4 text-muted-foreground' />
                Settings note
              </div>
              <p className='text-sm text-muted-foreground'>
                These organization fields are shared across onboarding, invites, reporting, and downstream modules. Keep them
                current so each module inherits the right defaults.
              </p>
            </div>
            <SettingsTextareaField
              id='org-description'
              label='Organization details'
              value={draft.description}
              onChange={(value) => updateField('description', value)}
              placeholder='Describe the organization, operating model, or internal notes.'
            />
          </CardContent>
        </Card>

        <div className='flex flex-wrap items-center justify-end gap-3'>
          <Button type='button' variant='outline' onClick={handleReset} disabled={saving || !isDirty}>
            Reset changes
          </Button>
          <Button type='button' onClick={() => void handleSave()} disabled={saving || !isDirty}>
            {saving ? 'Saving organization...' : 'Save organization settings'}
          </Button>
        </div>
      </div>

      <div className='space-y-4'>
        <Card className='border-border/60 bg-card/90'>
          <CardHeader className='pb-4'>
            <CardTitle className='text-lg'>Snapshot</CardTitle>
          </CardHeader>
          <CardContent className='space-y-3'>
            <div className='rounded-lg border bg-muted/10 p-4'>
              <div className='flex items-center gap-2 text-sm font-medium text-foreground'>
                <Building2 className='h-4 w-4 text-muted-foreground' />
                {currentOrganization.name}
              </div>
              <p className='mt-1 text-xs text-muted-foreground'>Organization ID</p>
              <p className='mt-0.5 font-mono text-xs text-foreground'>{currentOrganization.id}</p>
            </div>
            <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-1'>
              <div className='rounded-lg border bg-muted/10 p-4'>
                <p className='text-xs text-muted-foreground'>Slug</p>
                <p className='mt-1 text-sm font-medium text-foreground'>{currentOrganization.slug}</p>
              </div>
              <div className='rounded-lg border bg-muted/10 p-4'>
                <p className='text-xs text-muted-foreground'>Default currency</p>
                <p className='mt-1 text-sm font-medium text-foreground'>{currentOrganization.defaultCurrency || 'Not set'}</p>
              </div>
              <div className='rounded-lg border bg-muted/10 p-4'>
                <p className='text-xs text-muted-foreground'>Timezone</p>
                <p className='mt-1 text-sm font-medium text-foreground'>{currentOrganization.timezone || 'Not set'}</p>
              </div>
              <div className='rounded-lg border bg-muted/10 p-4'>
                <p className='text-xs text-muted-foreground'>Last updated</p>
                <p className='mt-1 text-sm font-medium text-foreground'>{formatDateTime(currentOrganization.updatedAt)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className='border-border/60 bg-card/90'>
          <CardHeader className='pb-4'>
            <CardTitle className='text-lg'>What this powers</CardTitle>
          </CardHeader>
          <CardContent className='space-y-3 text-sm text-muted-foreground'>
            <div className='flex gap-3 rounded-lg border bg-muted/10 p-3'>
              <Mail className='mt-0.5 h-4 w-4 shrink-0 text-muted-foreground' />
              <div>
                <p className='font-medium text-foreground'>Invitations and notifications</p>
                <p className='text-sm'>Contact details feed invite emails, escalation notices, and organization-level messaging.</p>
              </div>
            </div>
            <div className='flex gap-3 rounded-lg border bg-muted/10 p-3'>
              <Globe className='mt-0.5 h-4 w-4 shrink-0 text-muted-foreground' />
              <div>
                <p className='font-medium text-foreground'>Sharing and routing</p>
                <p className='text-sm'>Slug, website, and location data support shareable links and route-aware organization defaults.</p>
              </div>
            </div>
            <div className='flex gap-3 rounded-lg border bg-muted/10 p-3'>
              <Clock3 className='mt-0.5 h-4 w-4 shrink-0 text-muted-foreground' />
              <div>
                <p className='font-medium text-foreground'>Schedules and reporting</p>
                <p className='text-sm'>Timezone and currency keep work schedules, finance, and reporting aligned.</p>
              </div>
            </div>
            <div className='flex gap-3 rounded-lg border bg-muted/10 p-3'>
              <MapPin className='mt-0.5 h-4 w-4 shrink-0 text-muted-foreground' />
              <div>
                <p className='font-medium text-foreground'>Compliance context</p>
                <p className='text-sm'>Registration and tax identifiers help keep the organization profile audit-ready.</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <p className='rounded-lg border border-dashed border-border/70 bg-muted/10 px-4 py-3 text-xs text-muted-foreground'>
          Changes here are organization-wide. Keep the legal name, slug, and contact details consistent with the rest of your
          operational records.
        </p>
      </div>
    </div>
  )
}
