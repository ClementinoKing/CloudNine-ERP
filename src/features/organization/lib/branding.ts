import { DEFAULT_BRANDING_ACCENT_COLOR, DEFAULT_BRANDING_PRIMARY_COLOR } from '@/types/organization'

type HslColor = {
  h: number
  s: number
  l: number
}

const DARK_FOREGROUND = '222.2 47.4% 11.2%'
const LIGHT_FOREGROUND = '0 0% 100%'
const BRANDING_CACHE_KEY = 'cloudnine.organization-branding-cache'
const LAST_ACTIVE_ORGANIZATION_ID_KEY = 'cloudnine.last-active-organization-id'

type OrganizationBrandingCacheEntry = {
  primaryColor: string
  accentColor: string
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function readJsonValue<T>(key: string): T | null {
  if (typeof window === 'undefined') return null
  const rawValue = window.localStorage.getItem(key)
  if (!rawValue) return null

  try {
    return JSON.parse(rawValue) as T
  } catch {
    return null
  }
}

function writeJsonValue(key: string, value: unknown) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(key, JSON.stringify(value))
}

function hexToRgb(value: string) {
  const hex = value.trim().replace(/^#/, '')
  if (![3, 6].includes(hex.length)) return null

  const expanded = hex.length === 3 ? hex.split('').map((part) => `${part}${part}`).join('') : hex
  const parsed = Number.parseInt(expanded, 16)
  if (Number.isNaN(parsed)) return null

  return {
    r: (parsed >> 16) & 255,
    g: (parsed >> 8) & 255,
    b: parsed & 255,
  }
}

function rgbToHsl({ r, g, b }: { r: number; g: number; b: number }): HslColor {
  const red = r / 255
  const green = g / 255
  const blue = b / 255

  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const lightness = (max + min) / 2

  if (max === min) {
    return { h: 0, s: 0, l: lightness * 100 }
  }

  const delta = max - min
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  let hue = 0

  switch (max) {
    case red:
      hue = (green - blue) / delta + (green < blue ? 6 : 0)
      break
    case green:
      hue = (blue - red) / delta + 2
      break
    default:
      hue = (red - green) / delta + 4
      break
  }

  return {
    h: Math.round(hue * 60),
    s: Math.round(saturation * 100),
    l: Math.round(lightness * 100),
  }
}

export function normalizeBrandColor(value: string | null | undefined, fallback: string) {
  if (!value) return fallback
  const trimmed = value.trim()
  return /^#[0-9a-fA-F]{3}$/.test(trimmed) || /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed : fallback
}

export function normalizeBrandingLogoUrl(value: string | null | undefined) {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : ''
}

export function formatHexColor(value: string) {
  const normalized = normalizeBrandColor(value, DEFAULT_BRANDING_PRIMARY_COLOR)
  return normalized.toUpperCase()
}

export function getBrandForeground(hexColor: string) {
  const rgb = hexToRgb(hexColor)
  if (!rgb) return LIGHT_FOREGROUND

  const relativeLuminance =
    0.2126 * (rgb.r / 255) ** 2.2 + 0.7152 * (rgb.g / 255) ** 2.2 + 0.0722 * (rgb.b / 255) ** 2.2

  return relativeLuminance > 0.48 ? DARK_FOREGROUND : LIGHT_FOREGROUND
}

export function hexToHslCss(value: string) {
  const rgb = hexToRgb(value)
  if (!rgb) return null
  const { h, s, l } = rgbToHsl(rgb)
  return `${h} ${s}% ${l}%`
}

export function lightenHexColor(value: string, amount: number) {
  const rgb = hexToRgb(value)
  if (!rgb) return value
  const { h, s, l } = rgbToHsl(rgb)
  const nextLightness = clamp(l + amount, 0, 100)
  return `${h} ${s}% ${nextLightness}%`
}

export function applyOrganizationBrandingTheme(primaryColor: string | null | undefined, accentColor: string | null | undefined) {
  if (typeof document === 'undefined') return

  const primary = normalizeBrandColor(primaryColor, DEFAULT_BRANDING_PRIMARY_COLOR)
  const accent = normalizeBrandColor(accentColor, DEFAULT_BRANDING_ACCENT_COLOR)

  const primaryHsl = hexToHslCss(primary)
  const accentHsl = hexToHslCss(accent)
  const rootStyle = document.documentElement.style

  if (primaryHsl) {
    rootStyle.setProperty('--primary', primaryHsl)
    rootStyle.setProperty('--ring', primaryHsl)
    rootStyle.setProperty('--onboarding-cyan-ring', primaryHsl)
    rootStyle.setProperty('--onboarding-cyan-glow', lightenHexColor(primary, 14))
    rootStyle.setProperty('--primary-foreground', getBrandForeground(primary))
  }

  if (accentHsl) {
    rootStyle.setProperty('--accent', accentHsl)
    rootStyle.setProperty('--accent-foreground', getBrandForeground(accent))
  }
}

export function cacheOrganizationBranding(organizationId: string, primaryColor: string, accentColor: string) {
  const cache = readJsonValue<Record<string, OrganizationBrandingCacheEntry>>(BRANDING_CACHE_KEY) ?? {}
  cache[organizationId] = {
    primaryColor: normalizeBrandColor(primaryColor, DEFAULT_BRANDING_PRIMARY_COLOR),
    accentColor: normalizeBrandColor(accentColor, DEFAULT_BRANDING_ACCENT_COLOR),
  }
  writeJsonValue(BRANDING_CACHE_KEY, cache)
}

export function clearOrganizationBrandingCache(organizationId: string) {
  const cache = readJsonValue<Record<string, OrganizationBrandingCacheEntry>>(BRANDING_CACHE_KEY)
  if (!cache || !(organizationId in cache)) return

  delete cache[organizationId]
  if (Object.keys(cache).length === 0) {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(BRANDING_CACHE_KEY)
    }
    return
  }

  writeJsonValue(BRANDING_CACHE_KEY, cache)
}

export function readCachedOrganizationBranding(organizationId: string) {
  const cache = readJsonValue<Record<string, OrganizationBrandingCacheEntry>>(BRANDING_CACHE_KEY)
  return cache?.[organizationId] ?? null
}

export function writeLastActiveOrganizationId(organizationId: string) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(LAST_ACTIVE_ORGANIZATION_ID_KEY, organizationId)
}

export function readLastActiveOrganizationId() {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(LAST_ACTIVE_ORGANIZATION_ID_KEY)
}
