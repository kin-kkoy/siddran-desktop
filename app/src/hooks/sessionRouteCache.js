// "Reopen where I left off" — remembers the route you were last on (per section)
// and which right-column pane was open, so a relaunch puts you back.
//
// Device-local like sidebarState/noteFoldsCache, and scoped per Bag: note and
// sandbox ids only mean anything inside their own Bag (the same reason
// `switchBag` resets the URL to '/' before opening a different one).
//
// Two rules this file exists to enforce:
//  1. `detail` is only ever written from a real /notes/:id or /sandboxes/:id
//     location — never a hub. The sidebar sends you to the hub when you're
//     already inside a section, and recording that would erase the note you
//     wanted to come back to.
//  2. Reads/writes take an EXPLICIT bag path. `switchBag` nulls the store's bag
//     before the URL settles, so anything recomputing the key at write time
//     would silently spill into the ':default' bucket.

export const SECTIONS = ['notes', 'tasks', 'sandboxes', 'calendar']

const emptySections = () =>
  SECTIONS.reduce((acc, s) => { acc[s] = { detail: null }; return acc }, {})

// How many notes keep a remembered pane. Bounded so a long-lived Bag doesn't grow
// an entry for every note ever opened; oldest-written falls off first.
export const MAX_REMEMBERED_PANES = 20

export const emptySession = () => ({
  v: 1,
  lastSection: null,
  sections: emptySections(),
  panes: {},          // noteId -> pane snapshot
})

export const sessionKeyFor = (bagPath) => `siddran_session:${bagPath || 'default'}`

// Hub route for a section — where we land when the remembered detail is gone.
export const hubFor = (section) => (section === 'notes' ? '/notes' : `/${section}`)

// Which section a pathname belongs to, or null for routes we don't track
// (/dev/*, unmatched paths, anything that would restore into NotFoundPage).
export function sectionOf(pathname) {
  const p = String(pathname || '')
  if (p === '/' || p === '/notes' || p.startsWith('/notes/')) return 'notes'
  if (p === '/tasks') return 'tasks'
  if (p === '/sandboxes' || p.startsWith('/sandboxes/')) return 'sandboxes'
  if (p === '/calendar') return 'calendar'
  return null
}

// The detail route for a pathname, or null if it's a hub. Only /notes/:id and
// /sandboxes/:id have detail routes; /calendar keeps its own view memory in
// CalendarViewContext (cinder_cal_last_view), so it needs nothing here.
export function detailOf(pathname) {
  const p = String(pathname || '')
  const m = /^\/(notes|sandboxes)\/([^/]+)/.exec(p)
  return m ? `/${m[1]}/${m[2]}` : null
}

// The id inside a detail route, for validating it still exists before we
// navigate there (a dead id becomes a permanent tab in NoteTabsContext).
export function idOf(detail) {
  const m = /^\/(?:notes|sandboxes)\/([^/]+)/.exec(String(detail || ''))
  return m ? m[1] : null
}

function normalize(raw) {
  const base = emptySession()
  if (!raw || typeof raw !== 'object') return base
  const out = base
  if (SECTIONS.includes(raw.lastSection)) out.lastSection = raw.lastSection
  if (raw.sections && typeof raw.sections === 'object') {
    for (const s of SECTIONS) {
      const d = raw.sections[s]?.detail
      out.sections[s].detail = typeof d === 'string' && detailOf(d) === d ? d : null
    }
  }
  if (raw.panes && typeof raw.panes === 'object') {
    for (const [id, pane] of Object.entries(raw.panes)) {
      if (pane && typeof pane === 'object' && pane.kind && pane.kind !== 'none') out.panes[id] = pane
    }
  }
  return out
}

export function readSession(bagPath) {
  try { return normalize(JSON.parse(localStorage.getItem(sessionKeyFor(bagPath)) || 'null')) }
  catch { return emptySession() }
}

export function writeSession(bagPath, session) {
  try { localStorage.setItem(sessionKeyFor(bagPath), JSON.stringify(session)) }
  catch { /* quota or unavailable — the feature is a convenience, never fatal */ }
}

// Where a sidebar section button should go. Already inside the section → the
// hub (so the tab stays a way back to the overview); otherwise the remembered
// detail route, falling back to the hub.
// The pane remembered for one note, if any.
export const paneFor = (session, noteId) =>
  (noteId == null ? null : session?.panes?.[String(noteId)]) || null

// Set (or clear) one note's pane, evicting the oldest entry past the cap. Returns
// the session for chaining. Keyed per note so arriving at a different note can
// never wipe the pane you left open on this one.
//
// Eviction takes UNLOCKED entries first. An unlocked pane is passive memory and
// losing it costs nothing, but a locked one was pinned deliberately — dropping
// it because twenty other notes happened to be visited since would look like the
// lock had quietly failed. Locks only fall off once there is nothing else left
// to drop.
export function setPaneFor(session, noteId, pane) {
  if (noteId == null) return session
  const key = String(noteId)
  if (!session.panes || typeof session.panes !== 'object') session.panes = {}
  delete session.panes[key]                 // re-insert so key order tracks recency
  if (pane) session.panes[key] = pane
  const keys = Object.keys(session.panes)
  let over = Math.max(0, keys.length - MAX_REMEMBERED_PANES)
  if (over === 0) return session
  // Oldest-first within each group: unlocked, then locked as a last resort.
  for (const stale of [...keys.filter(k => !session.panes[k]?.locked),
                       ...keys.filter(k => session.panes[k]?.locked)]) {
    if (over === 0) break
    delete session.panes[stale]
    over -= 1
  }
  return session
}

export function sectionTarget(session, section, pathname) {
  if (sectionOf(pathname) === section) return hubFor(section)
  return session?.sections?.[section]?.detail || hubFor(section)
}

// ── pending launch restore ──────────────────────────────────────────
// Read once when the Bag opens, consumed once by <RouteRestore/> inside the
// Router. Held in a module variable rather than applied via history.replaceState
// in main.jsx: if the last Bag is missing, the user picks a DIFFERENT Bag from
// the picker, and `openBag` (unlike `switchBag`) never resets the URL — so a
// pre-render replaceState would mount the router on the old Bag's note id.
let pending = null

export function armRestore(bagPath) {
  const session = readSession(bagPath)
  const target = session.lastSection
    ? (session.sections[session.lastSection].detail || hubFor(session.lastSection))
    : null
  pending = target ? { bagPath, target } : null

  // Set the URL now, before <BrowserRouter> mounts, so the router's very first
  // render is already the restored route — otherwise the hub paints first and you
  // see it flash past. Safe here in a way it wasn't in main.jsx: this runs inside
  // openBag, so the Bag is known and the target provably belongs to it.
  if (target && typeof window !== 'undefined') {
    try {
      if (window.location.pathname === '/') window.history.replaceState(null, '', target)
    } catch { /* the in-router restore still covers us */ }
  }
}

export function clearRestore() { pending = null }

// Peek without consuming — the pane restorer needs it after the route lands.
export function peekRestore(bagPath) {
  if (!pending) return null
  return pending.bagPath === bagPath ? pending : null
}

// Consume the route half. Guarded on the bag path so a restore armed for Bag A
// can never be applied after the user opens Bag B.
export function takeRestoreTarget(bagPath) {
  const p = peekRestore(bagPath)
  if (!p) return null
  pending = { ...pending, target: null }
  return p.target
}


