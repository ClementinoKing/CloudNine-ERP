import { Info, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { normalizeProjectColor, projectDotStyle } from '@/features/projects/lib/project-colors'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

type ProjectOption = {
  id: string
  name: string
  color: string | null
}

function splitEmails(input: string) {
  return input
    .split(/[\n,;]+/g)
    .map((item) => item.trim())
    .filter(Boolean)
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export function InvitePeopleDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [emailInput, setEmailInput] = useState('')
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false

    void supabase
      .from('projects')
      .select('id, name, color')
      .order('name', { ascending: true })
      .then(({ data }) => {
        if (cancelled) return
        setProjects((data ?? []).map((project) => ({ id: project.id, name: project.name ?? 'Untitled project', color: normalizeProjectColor(project.color) })))
      })

    return () => {
      cancelled = true
    }
  }, [])

  const parsedEmails = useMemo(() => splitEmails(emailInput), [emailInput])
  const invalidEmails = useMemo(() => parsedEmails.filter((email) => !isValidEmail(email)), [parsedEmails])
  const canSend = parsedEmails.length > 0 && invalidEmails.length === 0 && selectedProjectIds.length > 0

  const toggleProject = (projectId: string) => {
    setSelectedProjectIds((current) =>
      current.includes(projectId) ? current.filter((id) => id !== projectId) : [...current, projectId],
    )
  }

  const removeProject = (projectId: string) => {
    setSelectedProjectIds((current) => current.filter((id) => id !== projectId))
  }

  const reset = () => {
    setEmailInput('')
    setSelectedProjectIds(projects[0] ? [projects[0].id] : [])
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) reset()
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent className='max-w-3xl p-0'>
        <DialogHeader className='border-b px-6 py-5'>
          <DialogTitle className='text-2xl leading-tight'>Invite people to your organization</DialogTitle>
          <DialogDescription className='text-sm'>Add one or multiple emails and assign access to projects.</DialogDescription>
        </DialogHeader>

        <div className='space-y-6 px-6 py-5'>
          <div className='space-y-2'>
            <label className='text-sm font-medium text-foreground'>Email addresses</label>
            <textarea
              rows={5}
              value={emailInput}
              onChange={(event) => setEmailInput(event.target.value)}
              placeholder='name@gmail.com, name@gmail.com, ...'
              className='flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
            />
            <div className='flex items-center justify-between text-xs text-muted-foreground'>
              <span>{parsedEmails.length} recipient(s)</span>
              {invalidEmails.length > 0 ? <span className='text-destructive'>Invalid: {invalidEmails.join(', ')}</span> : <span>All emails valid</span>}
            </div>
          </div>

          <div className='space-y-3'>
            <div className='flex items-center gap-1.5'>
              <label className='text-sm font-medium text-foreground'>Add to projects</label>
              <Info className='h-4 w-4 text-muted-foreground' aria-hidden='true' />
            </div>

            <div className='min-h-11 rounded-md border bg-background p-2'>
              <div className='flex flex-wrap gap-2'>
                {selectedProjectIds.length === 0 ? (
                  <p className='px-1 py-1 text-sm text-muted-foreground'>No project selected</p>
                ) : (
                  selectedProjectIds.map((id) => {
                    const project = projects.find((item) => item.id === id)
                    if (!project) return null
                    return (
                      <span key={project.id} className='inline-flex items-center gap-2 rounded-md border bg-muted/50 px-2 py-1 text-sm'>
                        <span className='h-2.5 w-2.5 rounded-full' style={projectDotStyle(project.color)} />
                        {project.name}
                        <button
                          type='button'
                          onClick={() => removeProject(project.id)}
                          className='inline-flex h-4 w-4 items-center justify-center text-muted-foreground hover:text-foreground'
                          aria-label={`Remove ${project.name}`}
                        >
                          <X className='h-3 w-3' />
                        </button>
                      </span>
                    )
                  })
                )}
              </div>
            </div>

            <div className='flex flex-wrap gap-2'>
              {projects.map((project) => {
                const selected = selectedProjectIds.includes(project.id)
                return (
                  <button
                    key={project.id}
                    type='button'
                    onClick={() => toggleProject(project.id)}
                    className={cn(
                      'inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors',
                      selected ? 'border-primary/50 bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-accent',
                    )}
                  >
                    <span className='h-2.5 w-2.5 rounded-full' style={projectDotStyle(project.color)} />
                    {project.name}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <DialogFooter className='border-t px-6 py-4'>
          <Button
            type='button'
            variant='outline'
            onClick={() => {
              reset()
              onOpenChange(false)
            }}
          >
            Cancel
          </Button>
          <Button
            type='button'
            disabled={!canSend}
            onClick={() => {
              reset()
              onOpenChange(false)
            }}
          >
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
