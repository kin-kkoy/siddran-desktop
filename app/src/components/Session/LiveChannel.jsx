import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { publishPresence, clearPresence, listenRequests } from '../../desktop/presence'
import { getActiveEditor } from '../Editor/activeEditor'
import { toast } from '../../utils/toast'
import * as sandboxStore from '../../hooks/sandboxStore'

// What an AI working through `siddran mcp` can know about this window, and the
// one thing it can ask of it.
//
// Publishes: the page, the open note or board, and the text selected in the
// note editor — so "tidy up the paragraph I selected" can be done without the
// user copying anything. Only ever what is already on screen.
//
// Accepts: "open this note / board / page". Showing something is all an outside
// request can do here; every change to content goes through the Bag files,
// where the store's merge already guards it.
const MAX_SELECTION = 4000

function selectionOf() {
  const view = getActiveEditor()
  if (!view || !view.hasFocus) return null
  const { from, to } = view.state.selection.main
  if (from === to) return null
  const doc = view.state.doc
  return {
    text: doc.sliceString(from, Math.min(to, from + MAX_SELECTION)),
    truncated: to - from > MAX_SELECTION,
    from_line: doc.lineAt(from).number,
    to_line: doc.lineAt(to).number,
  }
}

export default function LiveChannel({ bagPath, notes }) {
  const sandboxes = useSyncExternalStore(sandboxStore.subscribe, sandboxStore.getSnapshot)
  const location = useLocation()
  const navigate = useNavigate()
  const last = useRef('')
  const timer = useRef(null)
  const lookup = useRef({ notes, sandboxes })
  lookup.current = { notes, sandboxes }

  // Publish on navigation and on selection changes, debounced, and only when
  // the picture actually changed — no write per keystroke.
  useEffect(() => {
    if (!bagPath) return
    const publish = () => {
      const path = location.pathname
      const page = (path.split('/')[1] || 'notes')
      const noteId = /^\/notes\/([^/]+)/.exec(path)?.[1]
      const boardId = /^\/sandboxes\/([^/]+)/.exec(path)?.[1]
      const note = noteId ? lookup.current.notes?.find((n) => String(n.id) === noteId) : null
      const board = boardId ? lookup.current.sandboxes?.find((s) => s.id === boardId) : null
      const state = {
        running: true,
        bag: bagPath,
        page,
        route: path + location.search,
        note: noteId ? { id: noteId, title: note?.title ?? null } : null,
        sandbox: boardId ? { id: boardId, title: board?.title ?? null } : null,
        selection: noteId ? selectionOf() : null,
      }
      const key = JSON.stringify(state)
      if (key === last.current) return
      last.current = key
      publishPresence(bagPath, { ...state, updated_at: new Date().toISOString() })
    }
    const soon = () => { clearTimeout(timer.current); timer.current = setTimeout(publish, 400) }
    soon()
    document.addEventListener('selectionchange', soon)
    return () => { clearTimeout(timer.current); document.removeEventListener('selectionchange', soon) }
  }, [bagPath, location.pathname, location.search, notes, sandboxes])

  // Withdraw on close so the AI does not keep describing a Bag nobody has open.
  useEffect(() => {
    if (!bagPath) return
    return () => { last.current = ''; clearPresence(bagPath) }
  }, [bagPath])

  useEffect(() => {
    if (!bagPath) return
    let off = () => {}
    let cancelled = false
    listenRequests(bagPath, (req) => {
      if (req.action !== 'open') return
      if (req.note != null) {
        navigate(`/notes/${req.note}`)
        const t = lookup.current.notes?.find((n) => String(n.id) === String(req.note))?.title
        toast.success(t ? `Opened "${t}" for your assistant` : 'Opened a note for your assistant')
      } else if (req.sandbox) {
        navigate(`/sandboxes/${req.sandbox}`)
      } else if (['notes', 'tasks', 'calendar', 'sandboxes'].includes(req.page)) {
        navigate(`/${req.page}`)
      }
    }).then((f) => { if (cancelled) f(); else off = f }).catch(() => {})
    return () => { cancelled = true; off() }
  }, [bagPath, navigate])

  return null
}
