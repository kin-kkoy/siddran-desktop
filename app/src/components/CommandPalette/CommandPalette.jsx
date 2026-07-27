import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LuStickyNote, LuListTodo, LuCalendarDays, LuShapes } from 'react-icons/lu'
import { EDITOR_COMMANDS, WIKILINK_COMMANDS } from '../Editor/editorCommands'
import { getActiveEditor } from '../Editor/activeEditor'
import { useModalPresence } from '../../utils/modalPresence'
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

export default function CommandPalette({ notes = [], tasks = [] }) {
  const navigate = useNavigate()
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

  // Editor commands are shown but disabled with no focused editor, so the palette is
  // always predictable. The per-note/task commands are only mixed in once you've
  // typed something — otherwise an empty palette would list every note and task.
  const pool = useMemo(
    () => (query.trim() ? [...EDITOR_LIST, ...NAV_LIST, ...dynamic] : [...EDITOR_LIST, ...NAV_LIST]),
    [query, dynamic],
  )
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
            {results.map((cmd, i) => {
              const disabled = cmd.kind === 'editor' && !hasEditor
              return (
                <li
                  key={cmd.id}
                  className={`${styles.item} ${i === active ? styles.active : ''} ${disabled ? styles.disabled : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => { e.preventDefault(); if (!disabled) runCommand(cmd) }}
                  aria-disabled={disabled}
                >
                  <span className={styles.icon}>{cmd.icon ? createElement(cmd.icon, { size: 15 }) : null}</span>
                  <span className={styles.title}>{cmd.title}</span>
                  {disabled && <span className={styles.hint}>needs a note</span>}
                  {!disabled && (cmd.hint || (cmd.kind === 'nav' ? 'go' : '')) && (
                    <span className={styles.hint}>{cmd.hint || 'go'}</span>
                  )}
                </li>
              )
            })}
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
