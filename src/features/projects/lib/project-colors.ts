export const DEFAULT_PROJECT_COLOR = '#3B82F6'

export const PROJECT_COLOR_OPTIONS = ['#3B82F6', '#06B6D4', '#10B981', '#F59E0B', '#8B5CF6', '#F43F5E', '#EF4444', '#14B8A6'] as const

const LEGACY_TAILWIND_COLOR_MAP: Record<string, string> = {
  'bg-blue-500': '#3B82F6',
  'bg-sky-500': '#0EA5E9',
  'bg-cyan-500': '#06B6D4',
  'bg-emerald-500': '#10B981',
  'bg-teal-500': '#14B8A6',
  'bg-amber-500': '#F59E0B',
  'bg-orange-500': '#F97316',
  'bg-violet-500': '#8B5CF6',
  'bg-indigo-500': '#6366F1',
  'bg-rose-500': '#F43F5E',
  'bg-red-500': '#EF4444',
}

export function normalizeProjectColor(value: string | null | undefined) {
  if (!value) return DEFAULT_PROJECT_COLOR
  const color = value.trim()
  if (!color) return DEFAULT_PROJECT_COLOR
  if (LEGACY_TAILWIND_COLOR_MAP[color]) return LEGACY_TAILWIND_COLOR_MAP[color]
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color
  if (/^#[0-9a-fA-F]{3}$/.test(color)) return color
  return DEFAULT_PROJECT_COLOR
}

export function projectDotStyle(value: string | null | undefined) {
  return { backgroundColor: normalizeProjectColor(value) }
}
