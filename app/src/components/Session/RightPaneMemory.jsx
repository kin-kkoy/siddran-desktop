import { useEffect, useRef } from 'react'
import { useNoteSplit } from '../../contexts/NoteSplitContext'
import { useSandboxView, SANDBOX_VIEW_MODES } from '../../contexts/SandboxViewContext'
import { useSidePane } from '../../contexts/SidePaneContext'
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
function snapshot(split, sandboxView, sidePane) {
  if (split.enabled) {
    return { kind: 'split', splitTarget: split.splitTarget, focusedSide: split.focusedSide }
  }
  // close() only clears `mode` — activeSandboxId survives it, so occupancy has to
  // be read from the mode and never from the id being set.
  if (!sandboxView.isHidden) {
    return { kind: 'sandbox', sandboxMode: sandboxView.mode, activeSandboxId: sandboxView.activeSandboxId }
  }
  if (sidePane.isOpen) {
    return { kind: 'attachment', file: sidePane.file }
  }
  return null
}

export default function RightPaneMemory({ noteId }) {
  const split = useNoteSplit()
  const sandboxView = useSandboxView()
  const sidePane = useSidePane()
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

  // Reopen the pane this note had. Runs on every NotePage mount, not just at
  // launch: NotePage.jsx unmount-closes all three panes whenever you leave
  // /notes/*, so returning from Calendar or Tasks would otherwise always drop it.
  //
  // Keyed per note, so arriving at a DIFFERENT note gets a clean pane instead of
  // inheriting the previous note's — and cannot wipe the pane that note left open.
  // Switching notes in-session doesn't remount NotePage, so that path is untouched.
  useEffect(() => {
    if (settledRef.current) return
    settledRef.current = true
    const pane = paneFor(readSession(keyRef.current), noteId)
    if (!pane) return
    justRestoredRef.current = true

    // Exactly ONE occupant. NotePage keeps the right column single-tenant via an
    // effect on [split.enabled, sandboxView.isHidden] that closes the PDF — set two
    // here and it would wipe one on the very next commit.
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
      if (f?.path) sidePane.restore(f.path, f.name)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!recording || !settledRef.current) return
    if (justRestoredRef.current) { justRestoredRef.current = false; return }
    const session = readSession(keyRef.current)
    setPaneFor(session, noteId, snapshot(split, sandboxView, sidePane))
    writeSession(keyRef.current, session)
    // Depends on the pane VALUES, not the context objects — those are new on every
    // provider render and would rewrite storage on unrelated updates.
  }, [recording, noteId, split.enabled, split.splitTarget, split.focusedSide, sandboxView.mode, sandboxView.activeSandboxId, sidePane.file]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}
