import { Check, Search, UserPlus, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import type { FolderShareMember } from '@/features/dashboard/lib/drive-folder-sharing'

function initials(value: string) {
  const words = value.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'U'
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')
}

export function FolderShareDialog({
  open,
  onOpenChange,
  folderName,
  members,
  initialSelectedMemberIds,
  onSave,
  saving = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  folderName: string
  members: FolderShareMember[]
  initialSelectedMemberIds: string[]
  onSave: (memberIds: string[]) => Promise<void> | void
  saving?: boolean
}) {
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([])
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!open) return
    setSelectedMemberIds(Array.from(new Set(initialSelectedMemberIds)))
    setSearch('')
  }, [initialSelectedMemberIds, open])

  const selectedMembers = useMemo(
    () => selectedMemberIds.map((memberId) => members.find((member) => member.id === memberId)).filter((member): member is FolderShareMember => Boolean(member)),
    [members, selectedMemberIds],
  )

  const filteredMembers = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return members
    return members.filter((member) => {
      const haystack = `${member.fullName ?? ''} ${member.username ?? ''} ${member.email ?? ''}`.toLowerCase()
      return haystack.includes(query)
    })
  }, [members, search])

  const toggleMember = (memberId: string) => {
    setSelectedMemberIds((current) =>
      current.includes(memberId) ? current.filter((id) => id !== memberId) : [...current, memberId],
    )
  }

  const handleSave = () => {
    void onSave(Array.from(new Set(selectedMemberIds)))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-2xl gap-0 p-0'>
        <div className='space-y-5 p-6'>
          <DialogHeader className='space-y-2'>
            <DialogTitle>Share access</DialogTitle>
            <DialogDescription>
              Choose organization members who can open <span className='font-medium text-foreground'>{folderName}</span> and everything inside it.
            </DialogDescription>
          </DialogHeader>

          <div className='space-y-3 rounded-2xl border border-border/70 bg-muted/20 p-3'>
            <div className='flex items-center justify-between gap-3'>
              <p className='text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground'>
                Selected members
              </p>
              <span className='text-xs text-muted-foreground'>
                {selectedMembers.length} selected
              </span>
            </div>

            {selectedMembers.length > 0 ? (
              <div className='flex flex-wrap gap-2'>
                {selectedMembers.map((member) => {
                  const displayName = member.fullName ?? member.username ?? member.email ?? 'Unknown member'
                  return (
                    <span key={member.id} className='inline-flex items-center gap-2 rounded-full border bg-background px-2.5 py-1 text-xs'>
                      <Avatar className='h-5 w-5 border'>
                        {member.avatarUrl ? <AvatarImage src={member.avatarUrl} alt={displayName} /> : null}
                        <AvatarFallback className='text-[9px] font-semibold'>{initials(displayName)}</AvatarFallback>
                      </Avatar>
                      <span className='max-w-28 truncate'>{displayName}</span>
                      <button
                        type='button'
                        className='inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground'
                        onClick={() => toggleMember(member.id)}
                        aria-label={`Remove ${displayName}`}
                      >
                        <X className='h-3 w-3' />
                      </button>
                    </span>
                  )
                })}
              </div>
            ) : (
              <p className='text-sm text-muted-foreground'>No members selected.</p>
            )}
          </div>

          <div className='space-y-2'>
            <div className='flex items-center gap-2 rounded-xl border border-input bg-background px-3'>
              <Search className='h-4 w-4 text-muted-foreground' />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder='Search organization members'
                className='border-0 bg-transparent px-0 shadow-none focus-visible:ring-0'
              />
            </div>

            <div className='max-h-[22rem] overflow-y-auto rounded-2xl border border-border/70 bg-background p-2'>
              {filteredMembers.length === 0 ? (
                <div className='flex min-h-36 items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 text-center text-sm text-muted-foreground'>
                  No members found.
                </div>
              ) : (
                filteredMembers.map((member) => {
                  const displayName = member.fullName ?? member.username ?? member.email ?? 'Unknown member'
                  const selected = selectedMemberIds.includes(member.id)

                  return (
                    <button
                      key={member.id}
                      type='button'
                      onClick={() => toggleMember(member.id)}
                      className={cn(
                        'flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-accent',
                        selected && 'bg-accent/70',
                      )}
                    >
                      <span className='flex min-w-0 items-center gap-3'>
                        <Avatar className='h-9 w-9 border'>
                          {member.avatarUrl ? <AvatarImage src={member.avatarUrl} alt={displayName} /> : null}
                          <AvatarFallback className='text-[10px] font-semibold'>{initials(displayName)}</AvatarFallback>
                        </Avatar>
                        <span className='min-w-0'>
                          <span className='block truncate text-sm font-medium text-foreground'>{displayName}</span>
                          <span className='block truncate text-xs text-muted-foreground'>
                            {member.username ? `@${member.username}` : member.email ?? 'Organization member'}
                          </span>
                        </span>
                      </span>
                      <span
                        className={cn(
                          'inline-flex h-5 w-5 items-center justify-center rounded-full border',
                          selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-transparent',
                        )}
                      >
                        <Check className='h-3.5 w-3.5' />
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        </div>

        <DialogFooter className='border-t border-border/70 bg-muted/10 px-6 py-4'>
          <Button type='button' variant='outline' onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type='button' onClick={handleSave} disabled={saving}>
            <UserPlus className='mr-2 h-4 w-4' />
            {saving ? 'Saving...' : 'Save access'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
