import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

import { cn } from '@/lib/utils'

export type MentionOption = {
  id: string
  name: string
  username?: string | null
}

type MentionDraft = {
  start: number
  end: number
  query: string
}

export type MentionRichTextEditorHandle = {
  focus: () => void
  insertText: (text: string) => void
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function mentionHandleForOption(option: MentionOption) {
  const explicit = option.username?.trim()
  if (explicit) return explicit
  return option.name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9._-]/g, '')
}

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? ''
  }
  if (!(node instanceof HTMLElement)) {
    return ''
  }
  if (node.tagName === 'BR') return '\n'
  const mentionHandle = node.dataset.mentionHandle
  if (mentionHandle) return `@${mentionHandle}`

  let text = ''
  node.childNodes.forEach((child) => {
    text += serializeNode(child)
  })
  return text
}

function serializeEditor(root: HTMLElement) {
  let text = ''
  root.childNodes.forEach((child) => {
    text += serializeNode(child)
  })
  return text.replace(/\u00a0/g, ' ')
}

function getCaretOffset(root: HTMLElement) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || !selection.anchorNode) return 0
  const range = selection.getRangeAt(0).cloneRange()
  range.selectNodeContents(root)
  range.setEnd(selection.anchorNode, selection.anchorOffset)
  return range.toString().length
}

function setCaretAtOffset(root: HTMLElement, offset: number) {
  const selection = window.getSelection()
  if (!selection) return

  const range = document.createRange()
  let current = 0

  const walk = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? ''
      const next = current + text.length
      if (offset <= next) {
        range.setStart(node, Math.max(0, offset - current))
        range.collapse(true)
        return true
      }
      current = next
      return false
    }

    if (!(node instanceof HTMLElement)) return false

    if (node.tagName === 'BR') {
      if (offset <= current + 1) {
        range.setStartAfter(node)
        range.collapse(true)
        return true
      }
      current += 1
      return false
    }

    if (node.dataset.mentionHandle) {
      const mentionLen = (`@${node.dataset.mentionHandle}`).length
      if (offset <= current + mentionLen) {
        range.setStartAfter(node)
        range.collapse(true)
        return true
      }
      current += mentionLen
      return false
    }

    for (const child of Array.from(node.childNodes)) {
      if (walk(child)) return true
    }
    return false
  }

  for (const child of Array.from(root.childNodes)) {
    if (walk(child)) {
      selection.removeAllRanges()
      selection.addRange(range)
      return
    }
  }

  range.selectNodeContents(root)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}

function getMentionDraft(value: string, cursor: number | null): MentionDraft | null {
  if (cursor === null || cursor < 0) return null
  const beforeCursor = value.slice(0, cursor)
  const match = beforeCursor.match(/(^|\s)@([a-zA-Z0-9._-]*)$/)
  if (!match) return null

  const query = match[2] ?? ''
  const start = cursor - query.length - 1
  return { start, end: cursor, query }
}

export const MentionRichTextEditor = forwardRef<
  MentionRichTextEditorHandle,
  {
    value: string
    onChange: (value: string) => void
    mentionOptions: MentionOption[]
    placeholder?: string
    disabled?: boolean
    minHeightClassName?: string
    className?: string
    onBlur?: () => void
    onKeyDown?: (event: ReactKeyboardEvent<HTMLDivElement>) => void
  }
>(function MentionRichTextEditor(
  {
    value,
    onChange,
    mentionOptions,
    placeholder = 'Type here...',
    disabled = false,
    minHeightClassName = 'min-h-[120px]',
    className,
    onBlur,
    onKeyDown,
  },
  ref,
) {
  const editorRef = useRef<HTMLDivElement | null>(null)
  const didInitialSyncRef = useRef(false)
  const [internalValue, setInternalValue] = useState(value)
  const [mentionDraft, setMentionDraft] = useState<MentionDraft | null>(null)
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0)

  const mentionByHandle = useMemo(() => {
    const next = new Map<string, MentionOption>()
    mentionOptions.forEach((option) => {
      next.set(mentionHandleForOption(option).toLowerCase(), option)
    })
    return next
  }, [mentionOptions])

  const filteredMentionOptions = useMemo(() => {
    if (!mentionDraft) return [] as MentionOption[]
    const query = mentionDraft.query.trim().toLowerCase()
    if (!query) return mentionOptions.slice(0, 6)
    return mentionOptions
      .filter((option) => {
        const handle = mentionHandleForOption(option).toLowerCase()
        return option.name.toLowerCase().includes(query) || handle.includes(query)
      })
      .slice(0, 6)
  }, [mentionDraft, mentionOptions])

  const renderHtmlFromValue = useCallback(
    (nextValue: string) => {
      const regex = /@([a-zA-Z0-9._-]+)/g
      let html = ''
      let lastIndex = 0
      let match: RegExpExecArray | null

      while ((match = regex.exec(nextValue)) !== null) {
        const [token, handleRaw] = match
        const handle = handleRaw.toLowerCase()
        const before = nextValue.slice(lastIndex, match.index)
        html += escapeHtml(before).replace(/\n/g, '<br/>')

        if (mentionByHandle.has(handle)) {
          html += `<span data-mention-handle="${escapeHtml(handle)}" contenteditable="false" class="inline-flex items-center rounded-full border border-primary/40 bg-primary/[0.12] px-2 py-0.5 text-xs font-medium text-primary align-middle dark:border-primary/[0.55] dark:bg-primary/[0.22] dark:text-primary">@${escapeHtml(handleRaw)}</span>`
        } else {
          html += escapeHtml(token)
        }
        lastIndex = match.index + token.length
      }

      html += escapeHtml(nextValue.slice(lastIndex)).replace(/\n/g, '<br/>')
      return html
    },
    [mentionByHandle],
  )

  const syncEditorDom = useCallback(
    (nextValue: string, caretOffset?: number) => {
      const editor = editorRef.current
      if (!editor) return
      const html = renderHtmlFromValue(nextValue)
      editor.innerHTML = html
      if (typeof caretOffset === 'number') {
        setCaretAtOffset(editor, caretOffset)
      }
    },
    [renderHtmlFromValue],
  )

  const refreshMentionDraft = useCallback((nextValue: string) => {
    const editor = editorRef.current
    if (!editor) return
    setMentionDraft(getMentionDraft(nextValue, getCaretOffset(editor)))
  }, [])

  const applyValue = useCallback(
    (nextValue: string, caretOffset?: number) => {
      if (nextValue === internalValue && typeof caretOffset !== 'number') {
        refreshMentionDraft(nextValue)
        return
      }
      setInternalValue(nextValue)
      onChange(nextValue)
      syncEditorDom(nextValue, caretOffset)
      refreshMentionDraft(nextValue)
    },
    [internalValue, onChange, refreshMentionDraft, syncEditorDom],
  )

  const insertMention = useCallback(
    (option: MentionOption) => {
      if (!mentionDraft) return
      const handle = mentionHandleForOption(option)
      const mentionText = `@${handle} `
      const nextValue = `${internalValue.slice(0, mentionDraft.start)}${mentionText}${internalValue.slice(mentionDraft.end)}`
      const nextCaret = mentionDraft.start + mentionText.length
      applyValue(nextValue, nextCaret)
      setMentionDraft(null)
      setMentionActiveIndex(0)
      editorRef.current?.focus()
    },
    [applyValue, internalValue, mentionDraft],
  )

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        editorRef.current?.focus()
      },
      insertText: (text: string) => {
        const editor = editorRef.current
        if (!editor) return
        const caret = getCaretOffset(editor)
        const nextValue = `${internalValue.slice(0, caret)}${text}${internalValue.slice(caret)}`
        applyValue(nextValue, caret + text.length)
        editor.focus()
      },
    }),
    [applyValue, internalValue],
  )

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    if (!didInitialSyncRef.current) {
      syncEditorDom(internalValue)
      didInitialSyncRef.current = true
      return
    }

    // Keep DOM in sync when external value changes while editor is not focused.
    if (document.activeElement !== editor) {
      const currentDomValue = serializeEditor(editor)
      if (currentDomValue !== internalValue) {
        syncEditorDom(internalValue)
      }
    }
  }, [internalValue, syncEditorDom])

  useEffect(() => {
    if (value === internalValue) return
    const editor = editorRef.current
    const shouldKeepCaret = Boolean(editor && document.activeElement === editor)
    const caretOffset = shouldKeepCaret && editor ? getCaretOffset(editor) : undefined
    setInternalValue(value)
    syncEditorDom(value, caretOffset)
  }, [internalValue, syncEditorDom, value])

  useEffect(() => {
    setMentionActiveIndex(0)
  }, [mentionDraft?.query])

  return (
    <div className='relative w-full min-w-0'>
      <div
        ref={editorRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        role='textbox'
        aria-multiline='true'
        onInput={() => {
          const editor = editorRef.current
          if (!editor) return
          const caret = getCaretOffset(editor)
          const nextValue = serializeEditor(editor)
          applyValue(nextValue, caret)
        }}
        onClick={() => {
          const editor = editorRef.current
          if (!editor) return
          refreshMentionDraft(serializeEditor(editor))
        }}
        onKeyUp={() => {
          const editor = editorRef.current
          if (!editor) return
          refreshMentionDraft(serializeEditor(editor))
        }}
        onKeyDown={(event) => {
          if (mentionDraft && filteredMentionOptions.length > 0) {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setMentionActiveIndex((index) => (index + 1) % filteredMentionOptions.length)
              return
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setMentionActiveIndex((index) => (index - 1 + filteredMentionOptions.length) % filteredMentionOptions.length)
              return
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              const selected = filteredMentionOptions[mentionActiveIndex]
              if (selected) insertMention(selected)
              return
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              setMentionDraft(null)
              return
            }
          }
          onKeyDown?.(event)
        }}
        onBlur={() => {
          setMentionDraft(null)
          onBlur?.()
        }}
        className={cn(
          'block h-full w-full min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30',
          minHeightClassName,
          disabled && 'cursor-not-allowed opacity-70',
          className,
        )}
      />

      {!internalValue ? (
        <div className='pointer-events-none absolute left-3 top-2 text-sm text-muted-foreground'>{placeholder}</div>
      ) : null}

      {mentionDraft && filteredMentionOptions.length > 0 ? (
        <div className='absolute bottom-full left-2 z-20 mb-2 w-[min(20rem,calc(100%-1rem))] rounded-md border bg-card p-1 shadow-lg'>
          {filteredMentionOptions.map((option, index) => (
            <button
              key={option.id}
              type='button'
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insertMention(option)}
              className={cn(
                'flex w-full items-center rounded px-2 py-1.5 text-left text-sm',
                index === mentionActiveIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
              )}
            >
              <div className='min-w-0'>
                <span className='block truncate'>{option.name}</span>
                <span className='block truncate text-[11px] text-muted-foreground'>@{mentionHandleForOption(option)}</span>
              </div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
})
