import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  detailOf, sectionOf, readSession, writeSession,
  peekRestore, takeRestoreTarget, idOf, hubFor,
} from '../../hooks/sessionRouteCache'
import { useNoteTabs } from '../../contexts/NoteTabsContext'
import { useSettings } from '../../contexts/SettingsContext'

// Headless. Records the route you're on (per section) and, once on launch, sends
// you back to the one you left. Must live INSIDE <BrowserRouter>.
//
// The URL is normally already correct by the time this mounts — armRestore sets it
// inside openBag, where the Bag is known, so the router's first paint is the
// restored route and no hub flashes past. This still runs because that shortcut
// can't validate: the remembered note may have been deleted, and only here (once
// the note list has actually loaded) can we tell, back out, and drop the tab that
// landing on a dead id just opened.
export default function RouteMemory({ bagPath, notes, notesReady }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { settings } = useSettings()
  const { closeTab } = useNoteTabs() || {}
  const recording = settings.rememberNoteState === true && settings.restoreLastSession === true

  // Pin the storage key at mount. switchBag nulls the store's bag path before the
  // URL settles, so anything recomputing the key at write time would spill into
  // the ':default' bucket.
  const keyRef = useRef(bagPath)
  // One-shot latch for the launch restore.
  //
  // The route recorder is deliberately NOT gated on this. Its writes are harmless
  // before a restore lands: a hub route sets only `lastSection` and never touches
  // `detail`, and `pane` survives the read-modify-write. Gating it risked wedging
  // recording permanently if the restore never resolved.
  const settledRef = useRef(false)
  // Where we started. If the note list is still loading and you navigate somewhere
  // yourself in the meantime, restoring would yank you off the page you just chose.
  const startedAtRef = useRef(location.pathname)


  useEffect(() => {
    if (settledRef.current) return
    const pending = peekRestore(keyRef.current)
    const target = pending?.target
    if (!target) { settledRef.current = true; return }

    // armRestore may have already put us on the target before the router mounted.
    if (location.pathname === target) {
      if (!target.startsWith('/notes/')) { takeRestoreTarget(keyRef.current); settledRef.current = true; return }
    } else if (location.pathname !== startedAtRef.current) {
      takeRestoreTarget(keyRef.current)     // you've moved — leave you where you are
      settledRef.current = true
      return
    }

    // A remembered note that no longer exists must not be navigated to: NoteTabsContext
    // appends whatever id is in the route to the open tabs and never prunes, so a dead
    // id would become a permanent dead tab. Sandbox ids carry no such hazard (the
    // sandbox store hydrates lazily and would stall us), so those restore optimistically.
    if (target.startsWith('/notes/')) {
      // `notesReady` is derived from notesPagination, which is only set after a real
      // response. The loading flag can't be used for this: useNotes leaves it false
      // while the Bag picker is up, and localFetch resolves fast enough that
      // setLoading(true)/setLoading(false) batch into a single commit — so `loading`
      // is observed as false both before AND after the fetch, and never as true.
      // Judging existence against the empty pre-fetch list dropped every restore.
      if (!notesReady) return
      const id = idOf(target)
      if (!notes?.some((n) => String(n.id) === String(id))) {
        takeRestoreTarget(keyRef.current)
        settledRef.current = true
        // The URL was set before the router mounted, so we may already be sitting on
        // a note that no longer exists — leave, and drop the tab it just opened.
        closeTab?.(id)
        if (location.pathname === target) navigate(hubFor('notes'), { replace: true })
        return
      }
    }

    takeRestoreTarget(keyRef.current)
    settledRef.current = true
    if (location.pathname !== target) navigate(target, { replace: true })
  }, [notes, notesReady, navigate, location.pathname, closeTab])

  useEffect(() => {
    if (!recording) return
    const section = sectionOf(location.pathname)
    if (!section) return                     // /dev/*, unmatched — never remembered
    const session = readSession(keyRef.current)
    session.lastSection = section
    // Only real detail routes are recorded. The sidebar sends you to the hub when
    // you're already inside a section; recording that would wipe the note you
    // wanted to come back to.
    const detail = detailOf(location.pathname)
    if (detail) session.sections[section].detail = detail
    writeSession(keyRef.current, session)
  }, [location.pathname, recording])

  return null
}
