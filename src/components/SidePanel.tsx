import { ChatPanel } from './ChatPanel'
import { RoomIcon } from './icons'
import { IconButton, cn } from '../design/ui'
import type { ChatMessage } from '../domain/visit'

/* The right-hand chat column, 320px, on tablet and desktop. Phone gets the
   same ChatPanel in a BottomSheet instead.

   On a tablet the column floats over the stage rather than taking width from
   it, so the other person's video is never squeezed to a sliver. */

export const SIDE_PANEL_WIDTH = 320

export interface SidePanelProps {
  messages: ChatMessage[]
  onSend: (text: string) => Promise<void>
  overlay: boolean
  onHide: () => void
}

export function SidePanel({ messages, onSend, overlay, onHide }: SidePanelProps) {
  return (
    <aside
      data-side-panel={overlay ? 'overlay' : 'docked'}
      className={cn(
        'flex shrink-0 flex-col border-l border-line bg-card',
        /* bottom-16, not inset-y-0. The control bar is the last 64px of the
           main column, and a panel that floats over it takes Leave with it. */
        overlay && 'absolute right-0 top-0 bottom-16 z-30',
      )}
      style={{
        width: SIDE_PANEL_WIDTH,
        boxShadow: overlay ? 'var(--elevation-lg)' : undefined,
      }}
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <RoomIcon name="chat" size={15} className="text-ink-tertiary" />
        <span className="text-base font-semibold text-ink">Messages</span>
        <IconButton
          variant="ghost"
          size="sm"
          className="ml-auto"
          aria-label="Hide chat"
          onClick={onHide}
        >
          <RoomIcon name="close" size={16} />
        </IconButton>
      </div>
      <ChatPanel messages={messages} onSend={onSend} />
    </aside>
  )
}
