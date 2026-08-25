import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  LuStickyNote, LuListTodo, LuCalendarDays, LuShapes, LuSettings, LuPalette,
  LuRefreshCw, LuFilePlus, LuCirclePlus, LuPanelLeft, LuBookOpen, LuFolderOpen, LuImage, LuFileText, LuCode, LuFileInput } from 'react-icons/lu'
import { EDITOR_COMMANDS, WIKILINK_COMMANDS } from '../Editor/editorCommands'
import { getActiveEditor } from '../Editor/activeEditor'
import { useModalPresence } from '../../utils/modalPresence'
import { useSettings } from '../../contexts/SettingsContext'
import { useSidebar } from '../../contexts/SidebarContext'
import { readViewMode } from '../../hooks/noteViewModeCache'
import { readSyncConfig, writeLastSync } from '../../hooks/syncConfig'
import { syncNow } from '../../desktop/sync/client'
import { toast } from '../../utils/toast'
import { rankCommands } from './fuzzy'
import styles from './CommandPalette.module.css'

// Navigation commands — always available, act via react-router.
const NAV_COMMANDS = [
  { id: 'nav-notes', title: 'Go to Notes', keywords: 'notes hub', icon: LuStickyNote, to: '/notes' },
  { id: 'nav-tasks', title: 'Go to Tasks', keywords: 'todo tasks hub', icon: LuListTodo, to: '/tasks' },
  { id: 'nav-calendar', title: 'Go to Calendar', keywords: 'schedule events', icon: LuCalendarDays, to: '/calendar' },
  { id: 'nav-sandboxes', title: 'Go to Sandboxes', keywords: 'canvas draw', icon: LuShapes, to: '/sandboxes' },
]

// The editor commands (formatting + wikilinks) only do anything with a focused note
// editor. We snapshot the editor that was focused when the palette OPENED, because
// opening the overlay blurs it — CM6 keeps its selection, so acting on that snapshot
// preserves the caret/selection the user was working with.
const EDITOR_LIST = [...EDITOR_COMMANDS, ...WIKILINK_COMMANDS].map((c) => ({ ...c, kind: 'editor' }))
const NAV_LIST = NAV_COMMANDS.map((c) => ({ ...c, kind: 'nav' }))

export default function CommandPalette({ notes = [], tasks = [], addNote, closeBag }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const { openSettings, settings, updateSetting } = useSettings()
  const { collapsed, setCollapsed } = useSidebar()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const capturedView = useRef(null)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  // Global open shortcut: Ctrl/Cmd+Shift+P (standard command-palette binding).
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        capturedView.current = getActiveEditor()
        setQuery('')
        setActive(0)
        setOpen(true)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  const hasEditor = !!capturedView.current

  // ── app-level actions ────────────────────────────────────────────
  const runSync = useCallback(async () => {
    const { endpoint, token } = readSyncConfig()
    if (!endpoint || !token) { openSettings('sync'); toast.error('Set the sync endpoint and token first.'); return }
    const id = toast.loading ? toast.loading('Syncing…') : null
    try {
      const res = await syncNow({ endpoint, token })
      writeLastSync(new Date().toISOString())
      const n = res.conflicts?.length || 0
      const msg = n ? `Synced — ${n} conflict${n === 1 ? '' : 's'} resolved.` : 'Synced.'
      id ? toast.update(id, msg, 'success') : toast.success(msg)
    } catch (e) {
      const map = { 'no-bag': 'Open a Bag first.', unauthorized: 'The server rejected that token.' }
      const msg = map[e?.code] || e?.message || 'Sync failed.'
      id ? toast.update(id, msg, 'error') : toast.error(msg)
    }
  }, [openSettings])

  const newNote = useCallback(() => {
    if (!addNote) return
    addNote('Untitled', (created) => { if (created?.id) navigate(`/notes/${created.id}`) })
  }, [addNote, navigate])

  // Read/write is driven by the `?view=` param on a note route (NotePane falls back
  // to the per-note cache when it's absent), so the palette can flip it from here.
  const toggleViewMode = useCallback(() => {
    const noteId = /^\/notes\/([^/]+)/.exec(location.pathname)?.[1]
    if (!noteId) return
    const current = searchParams.get('view') || readViewMode(noteId)
    const next = new URLSearchParams(searchParams)
    next.set('view', current === 'read' ? 'write' : 'read')
    setSearchParams(next, { replace: true })
  }, [location.pathname, searchParams, setSearchParams])

  const onNotePage = /^\/notes\/[^/]+/.test(location.pathname)
  const appCommands = useMemo(() => {
    const cmds = [
      { id: 'app-settings', title: 'Open Settings', keywords: 'preferences options', icon: LuSettings, kind: 'nav', hint: 'app', run: () => openSettings() },
      { id: 'app-settings-themes', title: 'Settings: Themes', keywords: 'colour color appearance brightness', icon: LuPalette, kind: 'nav', hint: 'app', run: () => openSettings('appearance') },
      { id: 'app-settings-sync', title: 'Settings: Sync', keywords: 'endpoint token worker', icon: LuRefreshCw, kind: 'nav', hint: 'app', run: () => openSettings('sync') },
      { id: 'app-sync-now', title: 'Sync now', keywords: 'push pull upload', icon: LuRefreshCw, kind: 'nav', hint: 'app', run: runSync },
      { id: 'app-new-note', title: 'New note', keywords: 'create add', icon: LuFilePlus, kind: 'nav', hint: 'app', run: newNote },
      {
        id: 'app-new-task', title: 'New task', keywords: 'create add todo', icon: LuCirclePlus, kind: 'nav', hint: 'app',
        // Navigate first, then ask the (freshly mounted) add-task card to open.
        run: () => { navigate('/tasks'); setTimeout(() => window.dispatchEvent(new CustomEvent('siddran:new-task')), 80) },
      },
      {
        id: 'app-note-layout',
        title: settings.noteLayout === 'book' ? 'Note layout: switch to Scroll' : 'Note layout: switch to Book',
        keywords: 'landscape pages spread reading columns', icon: LuBookOpen, kind: 'nav', hint: 'app',
        run: () => updateSetting('noteLayout', settings.noteLayout === 'book' ? 'scroll' : 'book'),
      },
      {
        id: 'app-sidebar', title: collapsed ? 'Show sidebar' : 'Hide sidebar',
        keywords: 'toggle panel', icon: LuPanelLeft, kind: 'nav', hint: 'app', run: () => setCollapsed(!collapsed),
      },
      {
        id: 'app-bags', title: 'Close Bag — choose another',
        keywords: 'switch vault open folder landing picker', icon: LuFolderOpen, kind: 'nav', hint: 'app',
        run: async () => { if (closeBag) await closeBag(); navigate('/') },
      },
    ]
    if (onNotePage) {
      cmds.splice(4, 0, {
        id: 'app-view-mode', title: 'Toggle read / write mode',
        keywords: 'preview edit reading', icon: LuBookOpen, kind: 'nav', hint: 'note', run: toggleViewMode,
      })
      // The editor owns the caret, so the dock does the actual insert — see the
      // `siddran:attach` listener in EditorDock.
      const attach = (kind) => () =>
        window.dispatchEvent(new CustomEvent('siddran:attach', { detail: { kind } }))
      cmds.push(
        {
          id: 'app-attach-image', title: 'Attach image at cursor',
          keywords: 'insert picture photo png jpg media upload', icon: LuImage,
          kind: 'nav', hint: 'note', run: attach('image'),
        },
        {
          id: 'app-attach-pdf', title: 'Attach PDF at cursor',
          keywords: 'insert document file media attachment', icon: LuFileText,
          kind: 'nav', hint: 'note', run: attach('pdf'),
        },
        {
          id: 'app-attach-html', title: 'Attach HTML page at cursor',
          keywords: 'insert web page file media attachment viewer', icon: LuCode,
          kind: 'nav', hint: 'note', run: attach('html'),
        },
        {
          id: 'app-import-html', title: 'Import HTML as markdown at cursor',
          keywords: 'convert web page text paste readable', icon: LuFileInput,
          kind: 'nav', hint: 'note', run: attach('import-html'),
        },
      )
    }
    return cmds
  }, [openSettings, settings.noteLayout, updateSetting, collapsed, setCollapsed, closeBag, navigate, onNotePage, runSync, newNote, toggleViewMode])

  // "Open note/task: <title>" commands, built from the live note/task lists. Opening
  // a note routes to it; opening a task uses the ?task= deep-link TasksHub already
  // handles (fetches + opens its detail modal).
  const dynamic = useMemo(() => {
    const noteCmds = (notes || []).map((n) => ({
      id: `open-note-${n.id}`,
      title: (n.title || '').trim() || 'Untitled',
      keywords: 'note open', icon: LuStickyNote, kind: 'nav', hint: 'note',
      run: (nav) => nav(`/notes/${n.id}`),
    }))
    const taskCmds = (tasks || []).map((t) => ({
      id: `open-task-${t.id}`,
      title: (t.title || '').trim() || 'Untitled',
      keywords: 'task open todo', icon: LuListTodo, kind: 'nav', hint: 'task',
      run: (nav) => nav(`/tasks?task=${t.id}`),
    }))
    return [...noteCmds, ...taskCmds]
  }, [notes, tasks])

  // In-context: the formatting/insert commands only appear when a note editor was
  // focused (i.e. you're editing a note). Navigation and "open note/task" commands
  // are always available, so you can jump elsewhere from inside a note or from any
  // other page. The per-note/task commands are mixed in only once you've typed,
  // otherwise an empty palette would list every note and task.
  const pool = useMemo(() => {
    const base = [...(hasEditor ? EDITOR_LIST : []), ...NAV_LIST, ...appCommands]
    return query.trim() ? [...base, ...dynamic] : base
  }, [query, dynamic, hasEditor, appCommands])
  const results = useMemo(() => rankCommands(query, pool).slice(0, 50), [query, pool])

  // Keep the highlighted row in range as the list shrinks.
  useEffect(() => { setActive((i) => Math.min(i, Math.max(0, results.length - 1))) }, [results.length])

  const close = useCallback(() => {
    setOpen(false)
    // Return focus to the editor the user came from, if any.
    const v = capturedView.current
    if (v && v.dom?.isConnected) v.focus()
  }, [])

  const runCommand = useCallback((cmd) => {
    if (!cmd) return
    if (cmd.kind === 'editor') {
      const v = capturedView.current
      if (!v || !v.dom?.isConnected) return   // disabled row; ignore
      setOpen(false)
      cmd.run(v)                              // run() focuses the editor itself
    } else {
      setOpen(false)
      cmd.run ? cmd.run(navigate) : navigate(cmd.to)
    }
  }, [navigate])

  const onKeyDown = useCallback((e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); return }
    if (e.key === 'Enter') {
      e.preventDefault()
      const cmd = results[active]
      if (cmd?.kind === 'editor' && !hasEditor) return
      runCommand(cmd)
    }
  }, [results, active, hasEditor, runCommand, close])

  // Scroll the active row into view.
  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.children[active]
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  if (!open) return null

  return (
    <>
      <PresenceActive />
      <div className={styles.backdrop} onMouseDown={close}>
        <div className={styles.palette} onMouseDown={(e) => e.stopPropagation()}>
          <input
            ref={inputRef}
            className={styles.input}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0) }}
            onKeyDown={onKeyDown}
            placeholder="Type a command…"
            aria-label="Command palette"
          />
          <ul className={styles.list} ref={listRef}>
            {results.length === 0 && <li className={styles.empty}>No matching commands</li>}
            {results.map((cmd, i) => (
              <li
                key={cmd.id}
                className={`${styles.item} ${i === active ? styles.active : ''}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => { e.preventDefault(); runCommand(cmd) }}
              >
                <span className={styles.icon}>{cmd.icon ? createElement(cmd.icon, { size: 15 }) : null}</span>
                <span className={styles.title}>{cmd.title}</span>
                {cmd.kind === 'nav' && <span className={styles.hint}>{cmd.hint || 'go'}</span>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  )
}

// Mounted only while the palette is open, so useModalPresence's mount/unmount
// bracketing matches the open/close lifecycle and pauses StarCanvas meanwhile.
function PresenceActive() {
  useModalPresence()
  return null
}
