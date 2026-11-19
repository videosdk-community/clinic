import type { User } from '@supabase/supabase-js'
import { suggestedName } from '../auth/context'

/* The name the other side sees, typed on the join page and remembered by the
   browser.

   localStorage rather than a column on the profile: this is a per-device
   preference, not account state, and writing it through Supabase would put a
   network round trip between typing your name and joining. The stored value
   is only ever a fallback for the suggestion, so losing it costs nothing. */

const KEY = 'clinic:displayName'

/** The stored name, or the suggestion from the signed-in email. */
export function readDisplayName(user: User | null): string {
  /* Private-mode Safari throws on access rather than returning null, and a
     name field is not worth taking the whole screen down for. */
  try {
    const stored = window.localStorage.getItem(KEY)?.trim()
    if (stored) return stored
  } catch {
    /* No storage available; the suggestion below is still correct. */
  }
  return suggestedName(user)
}

export function writeDisplayName(name: string): void {
  try {
    window.localStorage.setItem(KEY, name.trim())
  } catch {
    /* The name still applies to this session, it just will not outlive it. */
  }
}
