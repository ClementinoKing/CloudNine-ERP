import { Building2, ImageUp, Palette, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useOrganization } from '@/features/organization/context/organization-context'
import { buildOrganizationSettingsValues } from '@/features/organization/lib/organization-settings'
import {
  cacheOrganizationBranding,
  clearOrganizationBrandingCache,
  formatHexColor,
  normalizeBrandColor,
  writeLastActiveOrganizationId,
} from '@/features/organization/lib/branding'
import { notify } from '@/lib/notify'
import { uploadAvatarToR2 } from '@/lib/r2'
import { cn } from '@/lib/utils'
import { DEFAULT_BRANDING_ACCENT_COLOR, DEFAULT_BRANDING_PRIMARY_COLOR, type OrganizationSettingsValues } from '@/types/organization'

type BrandingDraft = Pick<OrganizationSettingsValues, 'brandingLogoUrl' | 'brandingPrimaryColor' | 'brandingAccentColor'>

const COLOR_FIELD_CLASS = 'space-y-2'

function isValidHexColor(value: string) {
  return /^#[0-9a-fA-F]{3}$/.test(value.trim()) || /^#[0-9a-fA-F]{6}$/.test(value.trim())
}

function ColorField({
  id,
  label,
  value,
  onChange,
  error,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
}) {
  const safeValue = isValidHexColor(value) ? formatHexColor(value) : '#3B82F6'

  return (
    <div className={COLOR_FIELD_CLASS}>
      <label htmlFor={id} className='text-sm font-medium text-foreground'>
        {label}
      </label>
      <div className='flex items-center gap-3'>
        <div className='h-10 w-10 rounded-md border border-border/60 bg-background p-1'>
          <input
            id={`${id}-picker`}
            type='color'
            value={safeValue}
            className='h-full w-full cursor-pointer rounded-[5px] border-0 bg-transparent p-0'
            onChange={(event) => onChange(event.target.value)}
            aria-label={label}
          />
        </div>
        <Input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={safeValue}
          className={cn('font-mono uppercase', error ? 'border-destructive focus-visible:ring-destructive' : '')}
          aria-invalid={Boolean(error)}
        />
      </div>
      {error ? <p className='text-xs text-destructive'>{error}</p> : null}
    </div>
  )
}

export function OrganizationBrandingForm() {
  const { currentOrganization, updateOrganization } = useOrganization()
  const initialDraft = useMemo(
    () => ({
      brandingLogoUrl: currentOrganization.brandingLogoUrl,
      brandingPrimaryColor: currentOrganization.brandingPrimaryColor,
      brandingAccentColor: currentOrganization.brandingAccentColor,
    }),
    [currentOrganization.brandingAccentColor, currentOrganization.brandingLogoUrl, currentOrganization.brandingPrimaryColor],
  )
  const [draft, setDraft] = useState<BrandingDraft>(initialDraft)
  const [saving, setSaving] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<keyof BrandingDraft, string>>>({})
  const logoInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setDraft(initialDraft)
    setErrors({})
  }, [initialDraft])

  const settingsBaseline = useMemo(() => buildOrganizationSettingsValues(currentOrganization), [currentOrganization])
  const isDirty = useMemo(() => JSON.stringify(initialDraft) !== JSON.stringify(draft), [draft, initialDraft])

  const updateField = (key: keyof BrandingDraft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }))
    if (errors[key]) {
      setErrors((current) => {
        const next = { ...current }
        delete next[key]
        return next
      })
    }
  }

  const handleLogoUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !file.type.startsWith('image/')) return

    setUploadingLogo(true)
    try {
      const upload = await uploadAvatarToR2(file)
      updateField('brandingLogoUrl', upload.url)
      notify.success('Logo uploaded')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to upload logo.'
      notify.error('Logo upload failed', { description: message })
    } finally {
      setUploadingLogo(false)
      event.target.value = ''
    }
  }

  const handleSave = async () => {
    const nextErrors: Partial<Record<keyof BrandingDraft, string>> = {}
    if (draft.brandingPrimaryColor.trim() && !isValidHexColor(draft.brandingPrimaryColor)) {
      nextErrors.brandingPrimaryColor = 'Use a valid hex color, for example #3B82F6.'
    }
    if (draft.brandingAccentColor.trim() && !isValidHexColor(draft.brandingAccentColor)) {
      nextErrors.brandingAccentColor = 'Use a valid hex color, for example #0EA5E9.'
    }
    setErrors(nextErrors)

    if (Object.keys(nextErrors).length > 0) {
      notify.error('Fix the highlighted brand colors before saving.')
      return
    }

    setSaving(true)
    try {
      const nextPrimaryColor = normalizeBrandColor(draft.brandingPrimaryColor, DEFAULT_BRANDING_PRIMARY_COLOR)
      const nextAccentColor = normalizeBrandColor(draft.brandingAccentColor, DEFAULT_BRANDING_ACCENT_COLOR)
      await updateOrganization(currentOrganization.id, {
        ...settingsBaseline,
        brandingLogoUrl: draft.brandingLogoUrl.trim(),
        brandingPrimaryColor: nextPrimaryColor,
        brandingAccentColor: nextAccentColor,
      })
      cacheOrganizationBranding(currentOrganization.id, nextPrimaryColor, nextAccentColor)
      writeLastActiveOrganizationId(currentOrganization.id)
      notify.success('Organization branding updated')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update organization branding.'
      notify.error('Unable to update organization branding', { description: message })
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    const nextPrimaryColor = DEFAULT_BRANDING_PRIMARY_COLOR
    const nextAccentColor = DEFAULT_BRANDING_ACCENT_COLOR
    setDraft((current) => ({
      ...current,
      brandingPrimaryColor: nextPrimaryColor,
      brandingAccentColor: nextAccentColor,
    }))
    setErrors({})
    setSaving(true)

    try {
      await updateOrganization(currentOrganization.id, {
        ...settingsBaseline,
        brandingLogoUrl: draft.brandingLogoUrl.trim(),
        brandingPrimaryColor: nextPrimaryColor,
        brandingAccentColor: nextAccentColor,
      })
      // Clear cache after successful save so defaults are loaded fresh from database on refresh
      clearOrganizationBrandingCache(currentOrganization.id)
      notify.success('Branding reset to CloudNine defaults')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to reset branding.'
      notify.error('Unable to reset branding', { description: message })
    } finally {
      setSaving(false)
    }
  }

  const logoPreview = draft.brandingLogoUrl || currentOrganization.brandingLogoUrl
  const primaryPreview = isValidHexColor(draft.brandingPrimaryColor)
    ? formatHexColor(draft.brandingPrimaryColor)
    : currentOrganization.brandingPrimaryColor
  const accentPreview = isValidHexColor(draft.brandingAccentColor)
    ? formatHexColor(draft.brandingAccentColor)
    : currentOrganization.brandingAccentColor
  const hasCustomBrandColors =
    formatHexColor(draft.brandingPrimaryColor) !== DEFAULT_BRANDING_PRIMARY_COLOR ||
    formatHexColor(draft.brandingAccentColor) !== DEFAULT_BRANDING_ACCENT_COLOR

  return (
    <div className='space-y-6'>
      <Card className='border border-border/60 bg-card/90'>
        <CardHeader className='pb-5'>
          <div className='flex flex-wrap items-start justify-between gap-4'>
            <div className='space-y-2'>
              <CardTitle className='text-lg'>Brand assets</CardTitle>
              <p className='max-w-2xl text-sm leading-6 text-muted-foreground'>
                Upload a logo and define the visual palette used across the ERP.
              </p>
            </div>
            <div className='flex flex-wrap items-center gap-3'>
              <Button type='button' variant='outline' onClick={() => void handleReset()} disabled={saving || !hasCustomBrandColors} className='h-10 px-4'>
                Reset branding
              </Button>
              <Button type='button' onClick={() => void handleSave()} disabled={saving || !isDirty} className='h-10 px-4'>
                {saving ? 'Saving branding...' : 'Save branding'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className='space-y-6'>
          <div className='space-y-5'>
            <div className='rounded-3xl border border-border/60 bg-muted/10 p-4'>
              <div className='grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start'>
                <div className='space-y-3'>
                  <div className='flex h-32 items-center justify-center overflow-hidden rounded-2xl bg-background/70'>
                    {logoPreview ? (
                      <img src={logoPreview} alt={`${currentOrganization.name} logo`} className='h-full w-full object-contain p-5' />
                    ) : (
                      <Building2 className='h-10 w-10 text-muted-foreground' aria-hidden='true' />
                    )}
                  </div>
                </div>
                <div className='flex h-full flex-wrap items-start gap-2 lg:justify-end'>
                  <input ref={logoInputRef} type='file' accept='image/*' className='hidden' onChange={(event) => void handleLogoUpload(event)} />
                  <Button type='button' variant='outline' className='h-10 gap-2 px-3' onClick={() => logoInputRef.current?.click()} disabled={uploadingLogo}>
                    <ImageUp className='h-4 w-4' />
                    {uploadingLogo ? 'Uploading...' : logoPreview ? 'Replace logo' : 'Upload logo'}
                  </Button>
                  {logoPreview ? (
                    <Button
                      type='button'
                      variant='ghost'
                      className='h-10 gap-2 px-3 text-muted-foreground hover:text-foreground'
                      onClick={() => updateField('brandingLogoUrl', '')}
                    >
                      <Trash2 className='h-4 w-4' />
                      Remove
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>

            <div className='rounded-3xl border border-border/60 bg-muted/10 p-4'>
              <div className='grid gap-4 md:grid-cols-2'>
                <ColorField
                  id='branding-primary-color'
                  label='Primary color'
                  value={draft.brandingPrimaryColor}
                  onChange={(value) => updateField('brandingPrimaryColor', value)}
                  error={errors.brandingPrimaryColor}
                />
                <ColorField
                  id='branding-accent-color'
                  label='Accent color'
                  value={draft.brandingAccentColor}
                  onChange={(value) => updateField('brandingAccentColor', value)}
                  error={errors.brandingAccentColor}
                />
              </div>

              <div className='mt-4 rounded-[24px] bg-card/80 p-4'>
                <div className='flex items-center justify-between gap-4'>
                  <div className='flex items-center gap-2 text-sm font-medium text-foreground'>
                    <Palette className='h-4 w-4 text-muted-foreground' />
                    Live preview
                  </div>
                  <div className='rounded-full bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground'>
                    Updates in real time
                  </div>
                </div>
                <div className='mt-4 rounded-[20px] bg-background/80 p-4'>
                  <div className='flex items-center gap-3'>
                    <div className='flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl border border-border/60 bg-muted/10'>
                      {logoPreview ? (
                        <img src={logoPreview} alt={`${currentOrganization.name} logo`} className='h-full w-full object-contain p-1.5' />
                      ) : (
                        <Building2 className='h-5 w-5 text-muted-foreground' aria-hidden='true' />
                      )}
                    </div>
                    <div>
                      <p className='text-sm font-semibold text-foreground'>{currentOrganization.name}</p>
                      <p className='text-xs text-muted-foreground'>ERP interface preview</p>
                    </div>
                  </div>
                  <div className='mt-4 grid gap-3 sm:grid-cols-2'>
                    <div className='rounded-2xl bg-muted/10 p-4'>
                      <div className='mb-3 h-10 rounded-2xl' style={{ backgroundColor: primaryPreview }} aria-hidden='true' />
                      <p className='text-xs uppercase tracking-[0.16em] text-muted-foreground'>Primary</p>
                      <p className='mt-2 text-sm font-medium text-foreground'>{primaryPreview}</p>
                    </div>
                    <div className='rounded-2xl bg-muted/10 p-4'>
                      <div className='mb-3 h-10 rounded-2xl' style={{ backgroundColor: accentPreview }} aria-hidden='true' />
                      <p className='text-xs uppercase tracking-[0.16em] text-muted-foreground'>Accent</p>
                      <p className='mt-2 text-sm font-medium text-foreground'>{accentPreview}</p>
                    </div>
                  </div>
                  <div className='mt-4 h-16 rounded-2xl' style={{ background: `linear-gradient(135deg, ${primaryPreview} 0%, ${accentPreview} 100%)` }} aria-hidden='true' />
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

    </div>
  )
}
