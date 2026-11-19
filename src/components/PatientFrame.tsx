import { Fragment, type ReactNode } from 'react'
import { Avatar, cn } from '../design/ui'
import { RoomIcon } from './icons'
import { formatVisitTime } from '../lib/visits'
import wordmark from '../assets/videosdk-wordmark-black.svg'

/* The patient's frame: a lavender wash band with the brand, who the visit is
   with, and where they are in the three steps, over a white body.

   Phone first: full bleed on a phone, a centred 440px column on anything
   wider. The doctor's precall and every stopping point use it too, without
   the doctor card or the steps. */

const STEPS = ["Why you're here", 'Devices', 'Wait'] as const

export type FrameStep = 1 | 2 | 3

export interface PatientFrameProps {
  /** The doctor's name as stamped on the visit, without "Dr.". Omit to drop the doctor card. */
  doctorName?: string
  scheduledAt?: string
  step?: FrameStep | null
  /** Extra band content (the ended screen's check and heading). The body then overlaps the band. */
  hero?: ReactNode
  children: ReactNode
}

export function PatientFrame({ doctorName, scheduledAt, step = null, hero, children }: PatientFrameProps) {
  const when = scheduledAt ? formatVisitTime(scheduledAt) : ''

  return (
    <div className="h-full overflow-y-auto bg-card sm:bg-subtle sm:px-4 sm:py-10">
      <div
        className={cn(
          'mx-auto flex min-h-full w-full max-w-[440px] flex-col sm:min-h-0 sm:overflow-hidden sm:rounded-2xl sm:border sm:border-hairline sm:shadow-sm',
          hero ? 'bg-subtle' : 'bg-card',
        )}
      >
        <header
          className={cn(
            'flex flex-col border-b border-accent-soft bg-accent-wash px-5 pt-4',
            hero ? 'gap-10 pb-24' : 'gap-4 pb-5',
          )}
        >
          <div className="flex items-center gap-2">
            <img src={wordmark} alt="VideoSDK" className="h-3.5" />
            <span className="h-3.5 w-px bg-accent-tint" />
            <span className="text-sm font-medium text-ink">Clinic</span>
          </div>

          {doctorName && (
            <div className="flex items-center gap-3">
              <span className="relative inline-flex">
                {step === 3 && (
                  <span
                    aria-hidden
                    className="absolute -inset-1.5 rounded-pill border-2 border-accent-line motion-safe:animate-pulse"
                  />
                )}
                <Avatar
                  name={doctorName}
                  size={48}
                  className="[&>span]:bg-card [&>span]:shadow-[0_0_0_1px_var(--color-accent-tint)]"
                />
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-lg font-semibold text-ink">Dr. {doctorName}</span>
                <span className="text-sm text-ink-secondary">
                  Your video visit{when && ` · ${when}`}
                </span>
              </div>
            </div>
          )}

          {step && <Stepper step={step} />}
          {hero}
        </header>

        <main className={cn('flex flex-1 flex-col px-5 pb-5', hero ? '-mt-16' : 'pt-6')}>{children}</main>
      </div>
    </div>
  )
}

function Stepper({ step }: { step: FrameStep }) {
  return (
    <ol aria-label="Steps" className="m-0 flex list-none items-center gap-2 p-0">
      {STEPS.map((label, i) => {
        const n = i + 1
        const state = n < step ? 'done' : n === step ? 'active' : 'pending'
        return (
          <Fragment key={label}>
            {i > 0 && <li role="presentation" className="h-px flex-1 bg-accent-tint" />}
            <li
              aria-current={state === 'active' ? 'step' : undefined}
              className={cn(
                'flex shrink-0 items-center gap-1.5 text-sm font-medium',
                state === 'active' ? 'text-accent-ink' : 'text-ink-tertiary',
              )}
            >
              <span
                className={cn(
                  'inline-flex size-5 items-center justify-center rounded-pill text-xs font-semibold',
                  state === 'done' && 'bg-accent-soft text-accent-ink',
                  state === 'active' && 'bg-accent-mid text-white',
                  state === 'pending' && 'bg-muted text-ink-secondary',
                )}
              >
                {state === 'done' ? <RoomIcon name="check" size={10} strokeWidth={3} /> : n}
              </span>
              {label}
              {state === 'done' && <span className="sr-only"> (done)</span>}
            </li>
          </Fragment>
        )
      })}
    </ol>
  )
}
