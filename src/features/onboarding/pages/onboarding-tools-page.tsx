import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CircleHelp } from 'lucide-react'
import type { IconType } from 'react-icons'
import { FaMicrosoft, FaSalesforce } from 'react-icons/fa6'
import {
  SiCanva,
  SiDropbox,
  SiFigma,
  SiGithub,
  SiGmail,
  SiGoogledrive,
  SiHubspot,
  SiJira,
  SiNotion,
  SiSlack,
  SiZapier,
  SiZendesk,
  SiZoom,
} from 'react-icons/si'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAuth } from '@/features/auth/context/auth-context'

import { OnboardingShell } from '../components/onboarding-shell'

const TOOLS = [
  'Gmail',
  'Google Drive',
  'OneDrive',
  'Outlook',
  'Teams',
  'Slack',
  'Zoom',
  'Dropbox',
  'GitHub',
  'Figma',
  'Canva',
  'Jira',
  'Notion',
  'Salesforce',
  'Zendesk',
  'HubSpot',
  'Zapier',
  'Other',
] as const

const TOOL_ICONS: Record<(typeof TOOLS)[number], IconType | typeof CircleHelp> = {
  Gmail: SiGmail,
  'Google Drive': SiGoogledrive,
  OneDrive: FaMicrosoft,
  Outlook: FaMicrosoft,
  Teams: FaMicrosoft,
  Slack: SiSlack,
  Zoom: SiZoom,
  Dropbox: SiDropbox,
  GitHub: SiGithub,
  Figma: SiFigma,
  Canva: SiCanva,
  Jira: SiJira,
  Notion: SiNotion,
  Salesforce: FaSalesforce,
  Zendesk: SiZendesk,
  HubSpot: SiHubspot,
  Zapier: SiZapier,
  Other: CircleHelp,
}

const TOOL_BRAND_COLORS: Record<(typeof TOOLS)[number], string> = {
  Gmail: '#EA4335',
  'Google Drive': '#0F9D58',
  OneDrive: '#0078D4',
  Outlook: '#0078D4',
  Teams: '#6264A7',
  Slack: '#4A154B',
  Zoom: '#0B5CFF',
  Dropbox: '#0061FF',
  GitHub: '#181717',
  Figma: '#F24E1E',
  Canva: '#00C4CC',
  Jira: '#0052CC',
  Notion: '#111111',
  Salesforce: '#00A1E0',
  Zendesk: '#03363D',
  HubSpot: '#FF7A59',
  Zapier: '#FF4F00',
  Other: '#64748B',
}

export function OnboardingToolsPage() {
  const navigate = useNavigate()
  const { currentUser, completeOnboarding } = useAuth()
  const [selectedTools, setSelectedTools] = useState<string[]>(currentUser?.onboarding?.tools ?? [])

  const toggleTool = (tool: string) => {
    setSelectedTools((current) =>
      current.includes(tool) ? current.filter((item) => item !== tool) : [...current, tool],
    )
  }

  return (
    <OnboardingShell
      title='What tools do you use?'
      subtitle='We’ll personalize your organization setup based on your existing workflow stack.'
      backTo='/onboarding/work'
    >
      <div className='space-y-5'>
        <div className='grid grid-cols-2 gap-2 sm:grid-cols-3'>
          {TOOLS.map((tool) => {
            const selected = selectedTools.includes(tool)
            const Icon = TOOL_ICONS[tool]
            const iconColor = selected ? TOOL_BRAND_COLORS[tool] : undefined
            return (
              <button
                key={tool}
                type='button'
                onClick={() => toggleTool(tool)}
                className={cn(
                  'flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                  selected ? 'border-primary bg-primary/10 text-foreground' : 'bg-background text-muted-foreground hover:bg-accent',
                )}
              >
                <Icon className='h-4 w-4 shrink-0 text-current' style={iconColor ? { color: iconColor } : undefined} />
                <span className='truncate'>{tool}</span>
              </button>
            )
          })}
        </div>

        <Button
          className='w-full'
          onClick={async () => {
            await completeOnboarding({ tools: selectedTools, currentStep: 'tools' })
            navigate('/dashboard/home')
          }}
        >
          Finish setup
        </Button>
      </div>
    </OnboardingShell>
  )
}
