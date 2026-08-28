import { createContext, useCallback, useContext, useMemo, useState } from 'react'

// Which note, if any, has its right-column pane LOCKED to it.
//
// Unlocked (the default) is the original behaviour: the right column is global
// and follows you from note to note. Locked binds it to the note it was opened
// from, so it appears when you are in that note and nowhere else.
//
// Deliberately dumb — it holds a note id and nothing else. The pane's actual
// contents already live in the per-note `panes` map in sessionRouteCache, so
// duplicating them here would just create a second source of truth. This only
// answers "is this note's pane pinned"; RightPaneMemory does the rest.
//
// Mounted OUTSIDE SandboxView/NoteSplit/SidePane: the lock has to cover a split
// note, a sandbox and an attachment alike, and SidePaneProvider is already
// nested inside NoteSplitProvider, so it cannot live in either of them.
const PaneLockContext = createContext(null)

export function PaneLockProvider({ children }) {
  const [lockedNoteId, setLockedNoteId] = useState(null)

  const lock = useCallback((noteId) => {
    setLockedNoteId(noteId == null ? null : String(noteId))
  }, [])

  // Unlocking is a change of policy, not a close: the pane stays exactly where
  // it is and simply goes back to following you around.
  const unlock = useCallback(() => setLockedNoteId(null), [])

  const isLockedFor = useCallback(
    (noteId) => noteId != null && lockedNoteId === String(noteId),
    [lockedNoteId],
  )

  const value = useMemo(
    () => ({ lockedNoteId, isLockedFor, lock, unlock }),
    [lockedNoteId, isLockedFor, lock, unlock],
  )

  return <PaneLockContext.Provider value={value}>{children}</PaneLockContext.Provider>
}

// The hook ships alongside its provider here, same as every other context in
// this directory — the fast-refresh rule can't see that and complains anyway.
// eslint-disable-next-line react-refresh/only-export-components
export function usePaneLock() {
  const ctx = useContext(PaneLockContext)
  if (!ctx) throw new Error('usePaneLock must be used within <PaneLockProvider>')
  return ctx
}
