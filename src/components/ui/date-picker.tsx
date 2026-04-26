import { format, isValid } from 'date-fns'
import { Calendar as CalendarIcon } from 'lucide-react'
import { useState } from 'react'
import type { Matcher } from 'react-day-picker'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export function DatePicker({
  value,
  onChange,
  placeholder = 'Pick date and time',
  disabled = false,
  disabledDays,
  className,
  fromYear = 1950,
  toYear = 2100,
  withTime = true,
}: {
  value?: Date
  onChange: (date?: Date) => void
  placeholder?: string
  disabled?: boolean
  disabledDays?: Matcher | Matcher[] | undefined
  className?: string
  fromYear?: number
  toYear?: number
  withTime?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [draftDate, setDraftDate] = useState<Date | undefined>(value)

  const safeValue = value && isValid(value) ? value : undefined
  const safeDraftDate = draftDate && isValid(draftDate) ? draftDate : undefined
  const selectedDate = safeDraftDate ?? safeValue

  const updateTime = (time: string) => {
    const [hours, minutes] = time.split(':').map(Number)
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return

    const base = selectedDate ?? new Date()
    const next = new Date(base)
    next.setHours(hours, minutes, 0, 0)
    setDraftDate(next)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) {
          setDraftDate(value ?? new Date())
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type='button'
          variant='outline'
          data-empty={!safeValue}
          disabled={disabled}
          className={cn(
            'w-full justify-start text-left font-normal data-[empty=true]:text-muted-foreground',
            className,
          )}
        >
          <CalendarIcon className='mr-2 h-4 w-4' aria-hidden='true' />
          {safeValue ? format(safeValue, withTime ? 'PPP p' : 'PPP') : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-auto overflow-hidden p-0' align='start'>
        <Calendar
          mode='single'
          selected={selectedDate}
          disabled={disabledDays}
          defaultMonth={selectedDate ?? new Date()}
          captionLayout='dropdown'
          navLayout='around'
          fromYear={fromYear}
          toYear={toYear}
          onSelect={(date) => {
            if (!date) {
              setDraftDate(undefined)
              return
            }

            const base = selectedDate ?? new Date()
            const next = new Date(date)
            next.setHours(base.getHours(), base.getMinutes(), 0, 0)
            setDraftDate(next)

            if (!withTime) {
              onChange(next)
              setOpen(false)
            }
          }}
          initialFocus
        />
        {withTime ? (
          <div className='space-y-3 border-t p-3'>
            <div className='space-y-1'>
              <label className='text-xs font-medium text-muted-foreground'>Time</label>
              <input
                type='time'
                value={selectedDate && isValid(selectedDate) ? format(selectedDate, 'HH:mm') : '09:00'}
                onChange={(event) => updateTime(event.target.value)}
                className='h-9 w-full rounded-md border bg-background px-2 text-sm'
              />
            </div>
            <div className='flex items-center justify-end gap-2'>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() => {
                  setDraftDate(undefined)
                  onChange(undefined)
                  setOpen(false)
                }}
              >
                Clear
              </Button>
              <Button
                type='button'
                size='sm'
                onClick={() => {
                  onChange(selectedDate)
                  setOpen(false)
                }}
              >
                Apply
              </Button>
            </div>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
