import { Check, ChevronDown, Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { projectDotStyle } from '@/features/projects/lib/project-colors'
import { cn } from '@/lib/utils'

export type ProjectOption = {
  id: string
  name: string
  color: string | null
}

type ProjectPickerPopoverProps = {
  value: string
  projects: ProjectOption[]
  onChange: (projectId: string) => void
  disabled?: boolean
  ariaLabel?: string
  emptyLabel?: string
  searchPlaceholder?: string
  className?: string
  contentClassName?: string
}

export function ProjectPickerPopover({
  value,
  projects,
  onChange,
  disabled = false,
  ariaLabel = 'Project',
  emptyLabel = 'No project',
  searchPlaceholder = 'Search projects',
  className,
  contentClassName,
}: ProjectPickerPopoverProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const selectedProject = useMemo(() => projects.find((project) => project.id === value) ?? null, [projects, value])
  const filteredProjects = useMemo(
    () =>
      projects.filter((project) =>
        project.name.toLowerCase().includes(search.trim().toLowerCase()),
      ),
    [projects, search],
  )

  const close = () => {
    setOpen(false)
    setSearch('')
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) setSearch('')
      }}
    >
      <PopoverTrigger asChild>
        <button
          type='button'
          disabled={disabled}
          className={cn(
            'flex w-full items-center justify-between gap-3 rounded-md border border-input bg-background px-3 py-2 text-left text-sm ring-offset-background transition-colors hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60',
            className,
          )}
          aria-label={ariaLabel}
        >
          <span className='flex min-w-0 items-center gap-2'>
            {selectedProject ? <span className='h-2.5 w-2.5 shrink-0 rounded-full' style={projectDotStyle(selectedProject.color)} /> : null}
            <span className={cn('truncate', selectedProject ? 'text-foreground' : 'text-muted-foreground')}>
              {selectedProject?.name ?? emptyLabel}
            </span>
          </span>
          <ChevronDown className='h-4 w-4 shrink-0 text-muted-foreground' />
        </button>
      </PopoverTrigger>
      <PopoverContent className={cn('w-[320px] p-0', contentClassName)} align='start'>
        <div className='border-b p-3'>
          <div className='flex items-center gap-2 rounded-md border bg-background px-3'>
            <Search className='h-4 w-4 text-muted-foreground' />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={searchPlaceholder}
              className='h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground'
            />
          </div>
        </div>

        <div className='max-h-72 overflow-y-auto p-2'>
          <button
            type='button'
            onClick={() => {
              onChange('')
              close()
            }}
            className='flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent'
          >
            <span className='text-muted-foreground'>{emptyLabel}</span>
            {!value ? <Check className='h-4 w-4 text-primary' /> : null}
          </button>

          {filteredProjects.length === 0 ? (
            <div className='px-3 py-8 text-center text-sm text-muted-foreground'>No projects found.</div>
          ) : (
            filteredProjects.map((project) => (
              <button
                key={project.id}
                type='button'
                onClick={() => {
                  onChange(project.id)
                  close()
                }}
                className='flex w-full items-center justify-between rounded-md px-3 py-2 text-left transition-colors hover:bg-accent'
              >
                <span className='flex min-w-0 items-center gap-2'>
                  <span className='h-2.5 w-2.5 shrink-0 rounded-full' style={projectDotStyle(project.color)} />
                  <span className='truncate text-sm font-medium text-foreground'>{project.name}</span>
                </span>
                <Check className={cn('h-4 w-4 text-primary', value === project.id ? 'opacity-100' : 'opacity-0')} />
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
