import type { ReactNode } from 'react'
import { Avatar, Button, cn } from '../design/ui'
import { suggestedName, useAuth } from '../auth/context'
import { supabase } from '../lib/supabase'
import wordmark from '../assets/videosdk-wordmark-black.svg'

/* The doctor pages' frame: a white sticky bar, a lavender wash band holding
   the page's own header, and content that rides up over the band's lower
   edge. 1120px of content at desktop, the mockups' 80px gutters at 1280. */

export interface DoctorShellProps {
  /** The page header, drawn on the wash band. */
  band: ReactNode
  children: ReactNode
  /** Show Sign out in the bar. The dashboard has it; Details does not. */
  signOut?: boolean
}

const COLUMN = 'mx-auto w-full max-w-[1168px] px-4 sm:px-6'

export function DoctorShell({ band, children, signOut = false }: DoctorShellProps) {
  const { user } = useAuth()
  /* Same name api/visits.ts stamps on every visit as doctor_name. */
  const name = suggestedName(user)

  return (
    <div className="h-full overflow-y-auto bg-subtle">
      <header className="sticky top-0 z-10 h-14 border-b border-hairline bg-card">
        <div className={cn(COLUMN, 'flex h-full items-center justify-between gap-4')}>
          <div className="flex shrink-0 items-center gap-3">
            <img src={wordmark} alt="VideoSDK" className="h-3.5 shrink-0" />
            <span className="hidden h-4 w-px shrink-0 bg-hairline sm:block" />
            <span className="hidden text-base font-medium text-ink sm:inline">Clinic</span>
          </div>
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={name} size="md" />
            <span className="truncate text-base font-medium text-ink">Dr. {name}</span>
            {signOut && (
              <Button
                variant="text"
                className="-mr-3 shrink-0 max-sm:h-11"
                onClick={() => void supabase.auth.signOut()}
              >
                Sign out
              </Button>
            )}
          </div>
        </div>
      </header>

      <section className="border-b border-accent-soft bg-accent-wash">
        <div className={cn(COLUMN, 'pt-6 pb-[88px] sm:pt-8')}>{band}</div>
      </section>

      <div className={cn(COLUMN, 'relative -mt-16 pb-16')}>{children}</div>
    </div>
  )
}
