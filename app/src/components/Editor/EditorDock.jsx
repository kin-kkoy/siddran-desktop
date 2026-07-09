import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import {
  FaBold, FaItalic, FaUnderline, FaStrikethrough, FaHeading, FaCode,
  FaLink, FaListUl, FaListOl, FaQuoteLeft, FaQuestion,
} from 'react-icons/fa'
import { MdCheckBox, MdHorizontalRule } from 'react-icons/md'
import { LuShapes, LuCalendarDays, LuStickyNote, LuListTodo, LuEyeOff, LuHighlighter, LuPaperclip, LuImage, LuFileText, LuMessageSquare, LuChevronDown, LuChevronUp } from 'react-icons/lu'
import { TbBracketsContain } from 'react-icons/tb'
import { useNavigate } from 'react-router-dom'
import { useCalendarView } from '../../contexts/CalendarViewContext'
import { useSandboxView } from '../../contexts/SandboxViewContext'
import { usePdfView } from '../../contexts/PdfViewContext'
import { useNoteSplit } from '../../contexts/NoteSplitContext'
import { useSidebar } from '../../contexts/SidebarContext'
import { attachImageViaPicker, attachPdfViaPicker } from '../../desktop/media'
import styles from './EditorDock.module.css'

// ── Formatting helpers ──

function wrapSelection(view, before, after = before) {
  const { from, to } = view.state.selection.main
  const selected = view.state.sliceDoc(from, to)
  view.dispatch({
    changes: { from, to, insert: before + selected + after },
    selection: { anchor: from + before.length, head: to + before.length },
  })
  view.focus()
}

function toggleLinePrefix(view, prefix) {
  const { from } = view.state.selection.main
  const line = view.state.doc.lineAt(from)
  if (line.text.startsWith(prefix)) {
    view.dispatch({ changes: { from: line.from, to: line.from + prefix.length, insert: '' } })
  } else {
    view.dispatch({ changes: { from: line.from, to: line.from, insert: prefix } })
  }
  view.focus()
}

function cycleHeading(view) {
  const { from } = view.state.selection.main
  const line = view.state.doc.lineAt(from)
  const m = /^(#{1,6})\s/.exec(line.text)
  if (!m) {
    view.dispatch({ changes: { from: line.from, to: line.from, insert: '# ' } })
  } else if (m[1].length >= 6) {
    view.dispatch({ changes: { from: line.from, to: line.from + m[0].length, insert: '' } })
  } else {
    view.dispatch({ changes: { from: line.from, to: line.from + m[1].length, insert: m[1] + '#' } })
  }
  view.focus()
}

function insertHR(view) {
  const { from } = view.state.selection.main
  const line = view.state.doc.lineAt(from)
  const insert = (line.text.length ? '\n' : '') + '---\n'
  view.dispatch({ changes: { from: line.to, insert }, selection: { anchor: line.to + insert.length } })
  view.focus()
}

function insertLink(view) {
  const { from, to } = view.state.selection.main
  const selected = view.state.sliceDoc(from, to)
  const insert = `[${selected || 'text'}](url)`
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + 1, head: from + 1 + (selected.length || 4) },
  })
  view.focus()
}

function insertWikilink(view, prefix = '') {
  const pos = view.state.selection.main.head
  const insert = `[[${prefix}`
  view.dispatch({
    changes: { from: pos, insert },
    selection: { anchor: pos + insert.length },
  })
  view.focus()
}

const ACTIONS = [
  { key: 'bold', icon: FaBold, title: 'Bold', action: v => wrapSelection(v, '**') },
  { key: 'italic', icon: FaItalic, title: 'Italic', action: v => wrapSelection(v, '*') },
  // Underline has no native markdown; we store it as <u>…</u> raw HTML. The
  // reading view (remarkUnderline), PDF export, and the editor's live preview
  // (Underline node in cm/syntaxNodes.js + cm/livePreview.js) all render it.
  { key: 'underline', icon: FaUnderline, title: 'Underline', action: v => wrapSelection(v, '<u>', '</u>') },
  { key: 'strike', icon: FaStrikethrough, title: 'Strikethrough', action: v => wrapSelection(v, '~~') },
  { key: 'heading', icon: FaHeading, title: 'Heading (cycle)', action: cycleHeading },
  { key: 'code', icon: FaCode, title: 'Inline code', action: v => wrapSelection(v, '`') },
  { key: 'highlight', icon: LuHighlighter, title: 'Highlight', action: v => wrapSelection(v, '==') },
  { key: 'spoiler', icon: LuEyeOff, title: 'Spoiler', action: v => wrapSelection(v, '||') },
  { key: 'link', icon: FaLink, title: 'Link', action: insertLink },
  { key: 'ul', icon: FaListUl, title: 'Bullet list', action: v => toggleLinePrefix(v, '- ') },
  { key: 'ol', icon: FaListOl, title: 'Numbered list', action: v => toggleLinePrefix(v, '1. ') },
  { key: 'check', icon: MdCheckBox, title: 'Checkbox', action: v => toggleLinePrefix(v, '- [ ] ') },
  { key: 'quote', icon: FaQuoteLeft, title: 'Blockquote', action: v => toggleLinePrefix(v, '> ') },
  { key: 'hr', icon: MdHorizontalRule, title: 'Horizontal rule', action: insertHR },
]

const WIKILINK_TYPES = [
  { key: 'note', icon: LuStickyNote, label: 'Note', prefix: '' },
  { key: 'task', icon: LuListTodo, label: 'Task', prefix: 'task:' },
  { key: 'sandbox', icon: LuShapes, label: 'Sandbox', prefix: 'sandbox:' },
]

// variant: 'sticky' (default) sits at the bottom of the note column and recenters
// with the sidebar. 'fixed' pins the dock to the bottom-center of the whole screen
// — used by split view, where one shared dock spans both note panes.
function EditorDock({ viewRef, sandboxes = [], variant = 'sticky', onComment }) {
  const calView = useCalendarView()
  const sandboxView = useSandboxView()
  const pdfView = usePdfView()
  const split = useNoteSplit()
  const navigate = useNavigate()
  const { collapsed: sidebarCollapsed } = useSidebar()
  const [dockVisible, setDockVisible] = useState(() => {
    try { return localStorage.getItem('cinder_dock_visible') !== 'false' } catch { return true }
  })
  const [wikilinkOpen, setWikilinkOpen] = useState(false)
  const [sandboxMenuOpen, setSandboxMenuOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [mediaOpen, setMediaOpen] = useState(false)
  const wikilinkRef = useRef(null)
  const sandboxMenuRef = useRef(null)
  const helpRef = useRef(null)
  const mediaRef = useRef(null)

  const handleAttachImage = useCallback(async () => {
    setMediaOpen(false)
    const r = await attachImageViaPicker()
    const view = viewRef.current
    if (r && view) {
      const { from, to } = view.state.selection.main
      const insert = r.markdown + '\n'
      view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } })
      view.focus()
    }
  }, [viewRef])

  const handleAttachPdf = useCallback(async () => {
    setMediaOpen(false)
    const r = await attachPdfViaPicker()
    if (!r) return
    // Persist a clickable link in the note, then open the viewer.
    const view = viewRef.current
    if (view && r.markdown) {
      const { from, to } = view.state.selection.main
      const insert = r.markdown + '\n'
      view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } })
      view.focus()
    }
    // Opening the PDF collapses a note split to the route note; if the right pane
    // was focused, promote it first so the PDF opens beside the note we edited.
    if (split.enabled && split.focusedSide === 'right' && split.splitTarget?.type === 'note') {
      navigate(`/notes/${split.splitTarget.id}`)
    }
    pdfView.requestOpen(r.path, r.name)
  }, [pdfView, viewRef, split, navigate])

  const toggleDock = useCallback(() => {
    setDockVisible(prev => {
      const next = !prev
      try { localStorage.setItem('cinder_dock_visible', String(next)) } catch { /* ignore */ }
      if (!next) {
        setWikilinkOpen(false)
        setSandboxMenuOpen(false)
        setHelpOpen(false)
        setMediaOpen(false)
      }
      return next
    })
  }, [])

  // Close dropdowns on outside click
  useEffect(() => {
    if (!wikilinkOpen && !sandboxMenuOpen && !helpOpen && !mediaOpen) return
    const handler = (e) => {
      if (wikilinkOpen && wikilinkRef.current && !wikilinkRef.current.contains(e.target)) setWikilinkOpen(false)
      if (sandboxMenuOpen && sandboxMenuRef.current && !sandboxMenuRef.current.contains(e.target)) setSandboxMenuOpen(false)
      if (helpOpen && helpRef.current && !helpRef.current.contains(e.target)) setHelpOpen(false)
      if (mediaOpen && mediaRef.current && !mediaRef.current.contains(e.target)) setMediaOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [wikilinkOpen, sandboxMenuOpen, helpOpen, mediaOpen])

  const handleAction = useCallback((action) => {
    const view = viewRef.current
    if (!view) return
    action(view)
  }, [viewRef])

  return (
    <div
      className={`${styles.dockZone} ${variant === 'fixed' ? styles.fixed : ''} ${dockVisible ? styles.open : styles.closed}`}
      style={{ '--dock-sidebar-offset': sidebarCollapsed ? '0px' : '220px' }}
    >
      <button
        className={styles.dockToggle}
        title={dockVisible ? 'Hide editor dock' : 'Show editor dock'}
        aria-label={dockVisible ? 'Hide editor dock' : 'Show editor dock'}
        aria-expanded={dockVisible}
        onMouseDown={e => { e.preventDefault(); toggleDock() }}
      >
        {dockVisible ? <LuChevronDown /> : <LuChevronUp />}
      </button>
      <div className={styles.dock} aria-hidden={!dockVisible}>
        {/* Formatting buttons */}
        {ACTIONS.map(({ key, icon: Icon, title, action }) => (
          <button
            key={key}
            className={styles.btn}
            title={title}
            aria-label={title}
            onMouseDown={e => { e.preventDefault(); handleAction(action) }}
          >
            {createElement(Icon)}
          </button>
        ))}

        {/* Wikilink with type picker */}
        <span className={styles.sep} />
        <div className={styles.dropdownAnchor} ref={wikilinkRef}>
          <button
            className={`${styles.btn} ${wikilinkOpen ? styles.active : ''}`}
            title="Insert wikilink"
            aria-label="Insert wikilink"
            onMouseDown={e => { e.preventDefault(); setWikilinkOpen(p => !p); setSandboxMenuOpen(false) }}
          >
            <TbBracketsContain />
          </button>
          {wikilinkOpen && (
            <div className={styles.dropdown}>
              {WIKILINK_TYPES.map(({ key, icon: Icon, label, prefix }) => (
                <button
                  key={key}
                  className={styles.dropdownItem}
                  onMouseDown={e => {
                    e.preventDefault()
                    setWikilinkOpen(false)
                    handleAction(v => insertWikilink(v, prefix))
                  }}
                >
                  {createElement(Icon, { size: 14 })} {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Attach media (image / PDF) */}
        <div className={styles.dropdownAnchor} ref={mediaRef}>
          <button
            className={`${styles.btn} ${mediaOpen ? styles.active : ''}`}
            title="Attach media"
            aria-label="Attach media"
            onMouseDown={e => { e.preventDefault(); setMediaOpen(p => !p); setWikilinkOpen(false); setSandboxMenuOpen(false); setHelpOpen(false) }}
          >
            <LuPaperclip />
          </button>
          {mediaOpen && (
            <div className={styles.dropdown}>
              <button className={styles.dropdownItem} onMouseDown={e => { e.preventDefault(); handleAttachImage() }}>
                <LuImage size={14} /> Image
              </button>
              <button className={styles.dropdownItem} onMouseDown={e => { e.preventDefault(); handleAttachPdf() }}>
                <LuFileText size={14} /> PDF
              </button>
            </div>
          )}
        </div>

        {/* Comment on the current selection (or open the comments panel) */}
        {onComment && (
          <button
            className={styles.btn}
            title="Comment (select text to add)"
            aria-label="Comment"
            onMouseDown={e => { e.preventDefault(); onComment() }}
          >
            <LuMessageSquare />
          </button>
        )}

        {/* Calendar + Sandbox */}
        <span className={styles.sep} />

        <button
          className={`${styles.btn} ${!calView.isHidden ? styles.active : ''}`}
          title="Calendar peek"
          aria-label="Calendar peek"
          onMouseDown={e => { e.preventDefault(); calView.toggle() }}
        >
          <LuCalendarDays />
        </button>

        <div className={styles.dropdownAnchor} ref={sandboxMenuRef}>
          <button
            className={`${styles.btn} ${!sandboxView.isHidden ? styles.active : ''}`}
            title="Sandbox dock"
            aria-label="Sandbox dock"
            onMouseDown={e => {
              e.preventDefault()
              if (sandboxes.length <= 1) {
                if (sandboxView.isHidden) sandboxView.open(sandboxes[0]?.id ?? null, 'pip')
                else sandboxView.close()
              } else {
                setSandboxMenuOpen(p => !p)
                setWikilinkOpen(false)
              }
            }}
          >
            <LuShapes />
          </button>
          {sandboxMenuOpen && (
            <div className={styles.dropdown}>
              {sandboxes.length === 0 && (
                <div className={styles.dropdownEmpty}>No sandboxes</div>
              )}
              {sandboxes.map(s => (
                <button
                  key={s.id}
                  className={styles.dropdownItem}
                  onMouseDown={e => {
                    e.preventDefault()
                    setSandboxMenuOpen(false)
                    sandboxView.open(s.id, 'pip')
                  }}
                >
                  <LuShapes size={14} /> {s.title || 'Untitled'}
                </button>
              ))}
              {!sandboxView.isHidden && (
                <button
                  className={`${styles.dropdownItem} ${styles.dropdownClose}`}
                  onMouseDown={e => { e.preventDefault(); setSandboxMenuOpen(false); sandboxView.close() }}
                >
                  Close sandbox
                </button>
              )}
            </div>
          )}
        </div>

        {/* Markdown tips (escaping + underline) */}
        <span className={styles.sep} />
        <div className={styles.dropdownAnchor} ref={helpRef}>
          <button
            className={`${styles.btn} ${helpOpen ? styles.active : ''}`}
            title="Markdown tips"
            aria-label="Markdown tips"
            onMouseDown={e => { e.preventDefault(); setHelpOpen(p => !p); setWikilinkOpen(false); setSandboxMenuOpen(false) }}
          >
            <FaQuestion />
          </button>
          {helpOpen && (
            <div className={`${styles.dropdown} ${styles.tipPopover}`}>
              <div className={styles.tipTitle}>Show a symbol literally</div>
              <p className={styles.tipLine}>
                Put <code>\</code> before it so it doesn&apos;t format:
              </p>
              <ul className={styles.tipList}>
                <li><code>\*\*word\*\*</code> → **word**</li>
                <li><code>\[a\]</code>, <code>\#tag</code>, <code>\=\=x\=\=</code></li>
              </ul>
              <p className={styles.tipLine}>
                Or wrap in backticks to show as code: <code>`code`</code>
              </p>
              <div className={styles.tipTitle}>Underline</div>
              <p className={styles.tipLine}>
                Wrap text in <code>&lt;u&gt;…&lt;/u&gt;</code> (or use the underline button).
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default EditorDock
