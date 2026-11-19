import { cn } from '../design/ui'

/* The patient's 0-10 pain score as 10 segments, `value` of them filled, so a
   0 reads as an empty bar. The aria-label carries the number either way. */

export interface PainBarProps {
  value: number
  size?: 'sm' | 'md'
}

export function PainBar({ value, size = 'md' }: PainBarProps) {
  return (
    <div
      role="img"
      aria-label={`Pain ${value} of 10`}
      className={cn('flex w-full', size === 'md' ? 'gap-1' : 'gap-0.5')}
    >
      {Array.from({ length: 10 }, (_, i) => (
        <span
          key={i}
          className={cn(
            'flex-1 rounded-xs',
            size === 'md' ? 'h-2.5' : 'h-1.5',
            i < value ? 'bg-accent-mid' : 'bg-inset',
          )}
        />
      ))}
    </div>
  )
}
