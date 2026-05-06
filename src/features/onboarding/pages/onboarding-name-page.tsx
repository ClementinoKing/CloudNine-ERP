import { Camera } from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/features/auth/context/auth-context'
import { uploadAvatarToR2 } from '@/lib/r2'
import { supabase } from '@/lib/supabase'
import { notify } from '@/lib/notify'

import { OnboardingShell } from '../components/onboarding-shell'

function initials(name: string) {
  const parts = name.split(' ').filter(Boolean)
  if (parts.length === 0) return 'U'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
}

function generateUsernameCandidate(name: string) {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .replace(/^_+|_+$/g, '')
  return base || 'user'
}

async function resolveOrganizationIdForProfile(userId: string, onboardingOrganizationId?: string) {
  if (onboardingOrganizationId) return onboardingOrganizationId

  const { data, error } = await supabase
    .from('organizations')
    .select('id')
    .eq('created_by', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data?.id ?? null
}

export function OnboardingNamePage() {
  const navigate = useNavigate()
  const { currentUser, updateCurrentUser, updateOnboarding } = useAuth()
  const [fullName, setFullName] = useState(currentUser?.onboarding?.fullName || currentUser?.name || '')
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [saving, setSaving] = useState(false)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setFullName(currentUser?.onboarding?.fullName || currentUser?.name || '')
  }, [currentUser?.name, currentUser?.onboarding?.fullName])

  const hasPhoto = Boolean(currentUser?.avatarUrl || currentUser?.avatarPath)
  const canContinue = fullName.trim().length >= 2
  const generatedUsername = generateUsernameCandidate(fullName)

  const handleAvatarFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !file.type.startsWith('image/')) return

    setUploadingAvatar(true)
    setAvatarError(null)
    try {
      const upload = await uploadAvatarToR2(file)
      updateCurrentUser({ avatarUrl: upload.url, avatarPath: upload.key })
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : 'Avatar upload failed.')
    } finally {
      setUploadingAvatar(false)
      event.target.value = ''
    }
  }

  const handleContinue = async () => {
    if (!canContinue || !currentUser?.id) return

    const nextName = fullName.trim()
    const username = generateUsernameCandidate(nextName)
    const onboardingOrganizationId = currentUser.onboarding?.organizationId

    setSaving(true)
    try {
      const organizationId = await resolveOrganizationIdForProfile(currentUser.id, onboardingOrganizationId)

      // Create the profile row linked to the organization
      const { error } = await supabase.from('profiles').upsert({
        id: currentUser.id,
        full_name: nextName,
        username,
        email: currentUser.email,
        organization_id: organizationId ?? null,
        avatar_url: currentUser.avatarUrl ?? currentUser.avatarPath ?? null,
        role_label: 'owner',
      })

      if (error) throw error

      updateCurrentUser({ name: nextName, username })
      updateOnboarding({ fullName: nextName, currentStep: 'work' })
      navigate('/onboarding/work')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save profile'
      notify.error('Profile setup failed', { description: message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <OnboardingShell
      title='Set up your profile'
      subtitle={`You're joining as ${currentUser?.email ?? 'your account'}. Add your name and photo.`}
      backTo='/onboarding/organization'
    >
      <div className='space-y-6'>
        <div className='flex items-center gap-4'>
          <Avatar className='h-16 w-16 border'>
            {currentUser?.avatarUrl ? (
              <AvatarImage src={currentUser.avatarUrl} alt={currentUser.name} className='object-cover' />
            ) : null}
            <AvatarFallback className='text-sm font-semibold'>
              {initials(fullName || currentUser?.name || 'User')}
            </AvatarFallback>
          </Avatar>
          <div>
            <input
              ref={avatarInputRef}
              type='file'
              accept='image/*'
              onChange={(event) => void handleAvatarFile(event)}
              className='hidden'
            />
            <Button
              variant='outline'
              size='sm'
              onClick={() => avatarInputRef.current?.click()}
              className='gap-1.5'
              disabled={uploadingAvatar}
            >
              <Camera className='h-4 w-4' />
              {uploadingAvatar ? 'Uploading...' : hasPhoto ? 'Change photo' : 'Add photo'}
            </Button>
            {!hasPhoto ? (
              <p className='mt-2 text-xs text-muted-foreground'>Adding a profile photo is optional.</p>
            ) : null}
            {avatarError ? <p className='mt-2 text-xs text-destructive'>{avatarError}</p> : null}
          </div>
        </div>

        <div className='space-y-2'>
          <label htmlFor='onboarding-full-name' className='text-sm font-medium text-foreground'>
            What&apos;s your full name?
          </label>
          <Input
            id='onboarding-full-name'
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            placeholder='Enter your full name'
            autoFocus
          />
          {fullName.trim().length < 2 ? (
            <p className='text-xs text-muted-foreground'>Enter your full name to continue.</p>
          ) : null}
        </div>

        <div className='space-y-2'>
          <label htmlFor='onboarding-username' className='text-sm font-medium text-foreground'>
            Username
          </label>
          <Input id='onboarding-username' value={`@${generatedUsername}`} readOnly />
          <p className='text-xs text-muted-foreground'>Generated automatically from your name.</p>
        </div>

        <Button className='w-full' disabled={!canContinue || saving || uploadingAvatar} onClick={handleContinue}>
          {saving ? 'Saving...' : 'Continue'}
        </Button>
      </div>
    </OnboardingShell>
  )
}
