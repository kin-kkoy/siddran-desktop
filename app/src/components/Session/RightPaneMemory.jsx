import { useCallback, useEffect, useRef } from 'react'
import { useNoteSplit } from '../../contexts/NoteSplitContext'
import { useSandboxView, SANDBOX_VIEW_MODES } from '../../contexts/SandboxViewContext'
import { useSidePane } from '../../contexts/SidePaneContext'
import { usePaneLock } from '../../contexts/PaneLockContext'
import { useSettings } from '../../contexts/SettingsContext'
import { readSession, writeSession, paneFor, setPaneFor } from '../../hooks/sessionRouteCache'
import { getBagPath } from '../../desktop/localStore'

// Remembers which right-column pane each note had open, and reopens it whenever
// you return to that note — on launch, and after any trip to Calendar/Tasks.
//
// This MUST live inside NotePage rather than at App level. NotePage's unmount
// cleanup closes all three panes, so an App-level observer would see "nothing
// open" every time you navigate away and record that over the real state. Mounted
// here it unmounts alongside NotePage: React commits those closes in a later pass,
// by which point this fiber is gone and the effect can no longer fire.
function snapshot(split, sandboxView, sidePane, locked) {
  if (split.enabled) {
    return { kind: 'split', splitTarget: split.splitTarget, focusedSide: split.focusedSide, locked }
  }
  // close() only clears `mode` — activeSandboxId survives it, so occupancy has to
  // be read from the mode and never from the id being set.
  if (!sandboxView.isHidden) {
    return { kind: 'sandbox', sandboxMode: sandboxView.mode, activeSandboxId: sandboxView.activeSandboxId, locked }
  }
  if (sidePane.isOpen) {
    return { kind: 'attachment', file: sidePane.file, locked }
  }
  return null
}

export default function RightPaneMemory({ noteId }) {
  const split = useNoteSplit()
  const sandboxView = useSandboxView()
  const sidePane = useSidePane()
  const paneLock = usePaneLock()
  const { settings } = useSettings()
  const recording = settings.rememberNoteState === true && settings.restoreLastSession === true

  const keyRef = useRef(getBagPath())
  // Holds the recorder off until restore has run. Otherwise its first commit —
  // which happens with the panes still at their defaults — writes "nothing open"
  // over the snapshot we are about to read, wiping it on every launch.
  const settledRef = useRef(false)
  // The restore's setState lands in a LATER commit, so the recorder's first pass
  // would still see empty panes and write that null over what we just restored.
  const justRestoredRef = useRef(false)

  // Reopen one stored pane. Exactly ONE occupant: NotePage keeps the right column
  // single-tenant via an effect on [split.enabled, sandboxView.isHidden] that
  // closes the PDF — set two here and it would wipe one on the very next commit.
  const applyPane = useCallback((pane) => {
    if (pane.kind === 'split') {
      split.enable()
      if (pane.splitTarget) split.setSplitTarget(pane.splitTarget)
      if (pane.focusedSide) split.setFocusedSide(pane.focusedSide)
    } else if (pane.kind === 'sandbox') {
      const mode = Object.values(SANDBOX_VIEW_MODES).includes(pane.sandboxMode)
        ? pane.sandboxMode
        : SANDBOX_VIEW_MODES.HALF
      if (pane.activeSandboxId) sandboxView.open(pane.activeSandboxId, mode)
    } else if (pane.kind === 'attachment' || pane.kind === 'pdf') {
      // 'pdf' is the pre-rename spelling — sessions written before HTML existed.
      const f = pane.file || pane.pdf
      // restore(), not requestOpen(): the confirm modal has no business appearing
      // when we are the ones putting the pane back. That bypass already exists.
      if (f?.path) sidePane.restore(f.path, f.name)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const clearPanes = useCallback(() => {
    split.disable()
    sandboxView.close()
    sidePane.close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reopen the pane this note had. Runs on every NotePage mount, not just at
  // launch: NotePage.jsx unmount-closes all three panes whenever you leave
  // /notes/*, so returning from Calendar or Tasks would otherwise always drop it.
  //
  // Keyed per note, so arriving at a DIFFERENT note gets a clean pane instead of
  // inheriting the previous note's — and cannot wipe the pane that note left open.
  // Switching notes in-session doesn't remount NotePage; the lock effect below is
  // what covers that path.
  useEffect(() => {
    if (settledRef.current) return
    settledRef.current = true
    const pane = paneFor(readSession(keyRef.current), noteId)
    if (!pane) return
    justRestoredRef.current = true
    // Bring the live lock state back in line with what was stored, so the button
    // reads correctly and the note-change effect below knows what it is leaving.
    if (pane.locked) paneLock.lock(noteId)
    applyPane(pane)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The lock itself. The restore above is guarded by settledRef and runs ONCE per
  // mount, but switching notes in-session doesn't remount NotePage — so without
  // this nothing would react to a note change and a locked pane would still
  // follow you around like an unlocked one.
  //
  // Arriving at a note with a locked pane reopens it; leaving a locked note takes
  // its pane away. Everything else is left alone, which is exactly the unlocked
  // behaviour: the pane comes with you.
  const prevNoteRef = useRef(noteId)
  useEffect(() => {
    if (prevNoteRef.current === noteId) return
    const prev = prevNoteRef.current
    prevNoteRef.current = noteId
    if (!settledRef.current) return

    const pane = paneFor(readSession(keyRef.current), noteId)
    const leavingLocked = paneLock.isLockedFor(prev)

    if (pane?.locked) {
      justRestoredRef.current = true
      paneLock.lock(noteId)
      applyPane(pane)
    } else if (leavingLocked) {
      justRestoredRef.current = true
      paneLock.unlock()
      clearPanes()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId])

  const locked = paneLock.isLockedFor(noteId)
  useEffect(() => {
    if (!settledRef.current) return
    if (justRestoredRef.current) { justRestoredRef.current = false; return }
    const session = readSession(keyRef.current)
    // Locking is an explicit act rather than passive memory, so a locked pane is
    // written even with "remember note state" off — otherwise pressing lock would
    // do nothing after a relaunch, silently, and the one thing the lock exists to
    // survive is a relaunch. With recording off and nothing locked, the only write
    // left to make is clearing a lock this note used to have.
    const stored = paneFor(session, noteId)
    if (!recording && !locked && !stored?.locked) return
    const pane = (recording || locked) ? snapshot(split, sandboxView, sidePane, locked) : null
    setPaneFor(session, noteId, pane)
    writeSession(keyRef.current, session)
    // Depends on the pane VALUES, not the context objects — those are new on every
    // provider render and would rewrite storage on unrelated updates.
  }, [recording, locked, noteId, split.enabled, split.splitTarget, split.focusedSide, sandboxView.mode, sandboxView.activeSandboxId, sidePane.file]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}
