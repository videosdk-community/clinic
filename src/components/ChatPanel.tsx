import { useState } from 'react'
import { RoomIcon } from './icons'
import { Input, cn } from '../design/ui'
import type { ChatMessage } from '../domain/visit'

/* Chat, on an unpersisted pubsub topic.

   Keys are synthesised at the seam. A message's wire id is built as
   `messageId || ""`, so the hazard is not an absent field but an empty
   string: falsy, equal to every other empty string, and `key={m.id}` collides
   silently instead of failing loudly.

   This list renders in arrival order and never sorts. `timestamp`'s clock
   domain is not established, and sorting a live conversation by an untrusted
   clock reorders it on screen. */

export interface ChatPanelProps {
  messages: ChatMessage[]
  onSend: (text: string) => Promise<void>
}

export function ChatPanel({ messages, onSend }: ChatPanelProps) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  const text = draft.trim()
  const canSend = text !== '' && !sending

  /* Cleared only after the publish resolves. Clearing on click looks faster
     and loses the message when the publish throws. */
  const send = async () => {
    if (!canSend) return
    setSending(true)
    try {
      await onSend(text)
      setDraft('')
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
        {messages.length === 0 && (
          <p className="m-auto max-w-[240px] text-center text-sm text-ink-tertiary">
            Messages are only kept while the visit is open.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex flex-col ${m.mine ? 'items-end' : 'items-start'}`}>
            {!m.mine && <span className="mb-0.5 px-1 text-sm text-ink-tertiary">{m.who}</span>}
            <div
              className={cn(
                'max-w-[85%] break-words rounded-xl px-3 py-2 text-base',
                m.mine
                  ? 'rounded-br-xs bg-accent text-accent-fg'
                  : 'rounded-bl-xs bg-inset text-ink',
              )}
            >
              {m.text}
            </div>
          </div>
        ))}
      </div>

      {/* h-16 matches the control bar in the main column, so the two border-t
          lines meet across the panel seam instead of missing by a dozen px. */}
      <div className="flex h-16 shrink-0 items-center gap-2 border-t border-line px-2">
        <Input
          size="lg"
          className="flex-1"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void send()
          }}
          placeholder="Send a message"
        />
        <button
          type="button"
          disabled={!canSend}
          onClick={() => void send()}
          aria-label="Send"
          className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-ink-tertiary hover:bg-inset hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RoomIcon name="send" size={16} />
        </button>
      </div>
    </>
  )
}
