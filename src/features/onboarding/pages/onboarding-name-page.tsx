import { Camera, CheckCircle2, Loader2, XCircle } from 'lucide-react'
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

type UsernameAvailability = {
  username: string
  available: boolean
  suggested_username: string
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
  const { currentUser, updateCurrentUser, updateOnboarding, refreshCurrentUserProfile } = useAuth()
  const [fullName, setFullName] = useState(currentUser?.onboarding?.fullName || currentUser?.name || '')
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [saving, setSaving] = useState(false)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const [usernameAvailability, setUsernameAvailability] = useState<UsernameAvailability | null>(null)
  const [checkingUsername, setCheckingUsername] = useState(false)
  const [usernameCheckError, setUsernameCheckError] = useState<string | null>(null)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setFullName(currentUser?.onboarding?.fullName || currentUser?.name || '')
  }, [currentUser?.name, currentUser?.onboarding?.fullName])

  const generatedUsername = generateUsernameCandidate(fullName)
  const resolvedUsername = usernameAvailability?.suggested_username ?? generatedUsername
  const hasPhoto = Boolean(currentUser?.avatarUrl || currentUser?.avatarPath)
  const hasValidName = fullName.trim().length >= 2
  const usernameReady = Boolean(usernameAvailability) && !checkingUsername && !usernameCheckError
  const canContinue = hasValidName && usernameReady

  useEffect(() => {
    if (!currentUser?.id || fullName.trim().length < 2) {
      setUsernameAvailability(null)
      setUsernameCheckError(null)
      setCheckingUsername(false)
      return
    }

    let active = true
    const timeoutId = window.setTimeout(() => {
      setCheckingUsername(true)
      setUsernameCheckError(null)

      const checkUsername = async () => {
        try {
          const { data, error } = await supabase.rpc('check_username_availability', {
            p_username: generatedUsername,
            p_profile_id: currentUser.id,
          })

          if (!active) return
          if (error) throw error

          const availability = Array.isArray(data) ? (data[0] as UsernameAvailability | undefined) : undefined
          if (!availability?.suggested_username) {
            throw new Error('Unable to check username availability.')
          }

          setUsernameAvailability(availability)
        } catch (error) {
          if (!active) return
          setUsernameAvailability(null)
          setUsernameCheckError(error instanceof Error ? error.message : 'Unable to check username availability.')
        } finally {
          if (active) setCheckingUsername(false)
        }
      }

      void checkUsername()
    }, 350)

    return () => {
      active = false
      window.clearTimeout(timeoutId)
    }
  }, [currentUser?.id, fullName, generatedUsername])

  const handleAvatarFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !file.type.startsWith('image/')) return

    setUploadingAvatar(true)
    setAvatarError(null)
    try {
      const upload = await uploadAvatarToR2(file)
      updateCurrentUser({ avatarUrl: upload.url, avatarPath: upload.key })
      void refreshCurrentUserProfile({ avatarUrl: upload.url, avatarPath: upload.key })
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
    const username = usernameAvailability?.suggested_username ?? generateUsernameCandidate(nextName)
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
        active_organization_id: organizationId ?? null,
        avatar_url: currentUser.avatarUrl ?? currentUser.avatarPath ?? null,
        role_label: 'owner',
        onboarding_completed: false,
        onboarding_step: 'work',
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
          <div className='relative'>
            <Input id='onboarding-username' value={`@${resolvedUsername}`} readOnly className='pr-10' />
            <div className='absolute right-3 top-1/2 -translate-y-1/2'>
              {checkingUsername ? <Loader2 className='h-4 w-4 animate-spin text-muted-foreground' /> : null}
              {!checkingUsername && usernameAvailability?.available ? (
                <CheckCircle2 className='h-4 w-4 text-emerald-600' />
              ) : null}
              {!checkingUsername && usernameAvailability && !usernameAvailability.available ? (
                <CheckCircle2 className='h-4 w-4 text-emerald-600' />
              ) : null}
              {!checkingUsername && usernameCheckError ? <XCircle className='h-4 w-4 text-destructive' /> : null}
            </div>
          </div>
          {checkingUsername ? (
            <p className='text-xs text-muted-foreground'>Checking username availability...</p>
          ) : usernameCheckError ? (
            <p className='text-xs text-destructive'>{usernameCheckError}</p>
          ) : usernameAvailability?.available ? (
            <p className='text-xs text-emerald-600'>@{resolvedUsername} is available.</p>
          ) : usernameAvailability ? (
            <p className='text-xs text-muted-foreground'>
              @{usernameAvailability.username} is taken. We&apos;ll use @{resolvedUsername}.
            </p>
          ) : (
            <p className='text-xs text-muted-foreground'>Generated automatically from your name.</p>
          )}
        </div>

        <Button className='w-full' disabled={!canContinue || saving || uploadingAvatar} onClick={handleContinue}>
          {saving ? 'Saving...' : 'Continue'}
        </Button>
      </div>
    </OnboardingShell>
  )
}
