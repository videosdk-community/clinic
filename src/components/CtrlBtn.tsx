import type { ReactNode } from 'react'
import { cn } from '../design/ui'

/* A control-bar button.

   `text` renders the word beside the glyph. Use it wherever the glyph alone
   is a guess - first-time users misread bare glyphs, and could not identify
   the leave button at all.

   `off` is self-mute / camera-off: a red tint, the one convention every
   conferencing app shares, so "am I muted" is answerable at a glance rather
   than by hunting for a diagonal line through a glyph. A tint, not a fill:
   solid red is kept for the two things that are actually serious, ending the
   visit and a running recording (`danger`).

   `split` squares the right edge so a DeviceMenu chevron can sit flush
   against it, as one control with two halves. */

export interface CtrlBtnProps {
  children: ReactNode
  label: string
  text?: string
  danger?: boolean
  active?: boolean
  off?: boolean
  disabled?: boolean
  split?: boolean
  onClick?: () => void
}

export function CtrlBtn({
  children,
  label,
  text,
  danger,
  active,
  off,
  disabled,
  split,
  onClick,
}: CtrlBtnProps) {
  /* bg-inset, not bg-raised: in light, raised is the same white as the bar
     it sits on. */
  const tone = danger
    ? 'bg-danger-solid text-white hover:bg-danger-hover'
    : off
      ? 'bg-danger-bg text-danger-fg shadow-[inset_0_0_0_1px_var(--danger-border)]'
      : active
        ? 'bg-accent text-accent-fg hover:bg-accent-hover'
        : 'bg-inset text-ink-secondary hover:bg-hairline hover:text-ink'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={off !== undefined ? off : active}
      className={cn(
        'flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border-0',
        split && 'rounded-r-none',
        'transition-colors duration-[120ms] ease-standard',
        text ? 'px-3' : 'w-10',
        tone,
        disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
      )}
    >
      {children}
      {text && <span className="text-base font-medium">{text}</span>}
    </button>
  )
}
