import { useEffect } from 'react'

/* Back-navigation and reload guards for a live visit.

   A two-finger horizontal swipe on a trackpad is a history-back gesture, and
   an accidental one should not drop someone out of a consult. Two layers,
   because they fail differently:

   - `overscroll-behavior-x: none` in index.css stops the gesture reaching the
     browser at all. It just cannot cover a keyboard Back, a mouse thumb button
     or a reload.
   - This hook catches whatever gets through. A sentinel history entry absorbs
     one Back per attempt and is pushed straight back, so the room URL never
     changes and the visit carries on behind the confirmation.

   `beforeunload` covers the other exit: reload, tab close, typing a new URL.
   The browser draws that dialog itself and ignores any custom message.

   The sentinel outlives an intentional leave: the room is left with a
   `replace`, which overwrites the sentinel rather than the room entry, so Back
   afterwards returns to the visit's precall. That is the honest cost of the
   trap, and precall is a screen this participant can safely see. */
export function useExitGuard(active: boolean, onBack: () => void) {
  useEffect(() => {
    if (!active) return

    window.history.pushState({ visitGuard: true }, '')

    const onPopState = () => {
      /* Re-arm first. The entry is already gone by the time this runs, and a
         second swipe before the dialog is answered must not leave the room. */
      window.history.pushState({ visitGuard: true }, '')
      onBack()
    }
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault()

    window.addEventListener('popstate', onPopState)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('popstate', onPopState)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [active, onBack])
}
