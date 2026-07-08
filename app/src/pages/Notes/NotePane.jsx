import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import styles from './NotePage.module.css'
import { IoMdArrowRoundBack } from "react-icons/io"
import { FaStar, FaRegStar, FaEllipsisV } from 'react-icons/fa'
import { MdChromeReaderMode } from "react-icons/md";
import { HiPencilSquare } from "react-icons/hi2";
import { HiOutlineDownload, HiOutlineCog, HiOutlineDocumentText } from "react-icons/hi";
import { LuMaximize, LuMinimize, LuColumns2, LuX } from "react-icons/lu";
import CodeMirrorEditor from '../../components/Editor/CodeMirrorEditor'
import { printNoteToPdf } from '../../components/Editor/utils/exportPdf'
import ConfirmModal from '../../components/Common/ConfirmModal'
import TaskDetailsModal from '../../components/Common/TaskDetailsModal'
import { useApi } from '../../contexts/ApiContext'
import { useSandboxes } from '../../hooks/useSandboxes'
import { readViewMode, writeViewMode } from '../../hooks/noteViewModeCache'
import { useNoteSplit } from '../../contexts/NoteSplitContext'
import { toast } from '../../utils/toast'
import Skeleton from '../../components/Common/Skeleton'
import { NOTE_COLORS } from '../../components/Notes/noteColors'
import NoteSettingsPopup from '../../components/Settings/NoteSettingsPopup'

// A single editable note surface (header + title + CodeMirror editor + modals).
// Extracted from NotePage so it can be rendered twice in split view. The primary
// pane is route-driven (/notes/:id); a secondary pane is fed its `noteId` directly
// and shows a close (×) button instead of "Back to Notes".
function NotePane({
  noteId,
  isPrimary = true,
  otherNoteId,
  onEnterSplit,
  onClose,
  notes,
  notesLoading,
  editTitle,
  editBody,
  updateTags,
  toggleFavorite,
  updateColor,
  exportNote,
  setSidebarCollapsed,
  lessDistraction = false,
  setLessDistraction,
  tasks,
  addNote,
  updateTask,
  bundles,
}) {

  const split = useNoteSplit()
  const { authFetch, API } = useApi()
  const { sandboxes, sandboxesLoaded } = useSandboxes()

  const navigate = useNavigate()
  // Match by string for optimistic temp ids and by number for synced server ids
  const note = notes && notes.length
    ? notes.find(n => n.id === noteId || n.id === Number(noteId))
    : null
  const isOptimistic = note?._optimistic === true

  // Opening a note (wikilink, created-note, link click) stays within this pane:
  // the primary pane drives the route; a secondary pane swaps its own note via
  // context. If the target is already open in the OTHER pane, don't duplicate it
  // (both editors would share a draft/save key) — just focus that pane instead.
  const navigateToNote = useCallback((id) => {
    if (split.enabled && otherNoteId != null && id == otherNoteId) { // loose: route id is a string, note ids are numbers
      split.setFocusedSide(isPrimary ? 'right' : 'left')
      return
    }
    if (isPrimary) navigate(`/notes/${id}`)
    else split.setSplitNoteId(id)
  }, [isPrimary, otherNoteId, navigate, split])

  // All hooks must be called before any early return (Rules of Hooks)
  const [newTitle, setNewTitle] = useState(note?.title || "")
  const [newTags, setNewTags] = useState(note?.tags || "")
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState('below') // 'above' or 'below'
  const [searchParams, setSearchParams] = useSearchParams() //how to display said note
  const titleInputReference = useRef(null); // `useRef` is basically just React's way of doing: `document.querySelectorAll()` or `.getElementByID()`
  // View mode resolution. The primary pane honours an explicit `?view=` URL param
  // (deep links, the card's "open in read mode"), falling back to the note's
  // remembered mode in localStorage. A secondary pane can't use the URL param
  // (only one note fits in it), so it keeps a local override and falls back to the
  // same per-note cache. Either way every toggle is persisted to the cache.
  const viewParam = isPrimary ? searchParams.get('view') : null
  const cachedViewMode = useMemo(() => readViewMode(noteId), [noteId])
  const [localRead, setLocalRead] = useState(null) // secondary-pane override; null = use cache
  useEffect(() => { setLocalRead(null) }, [noteId])
  const viewMode = isPrimary
    ? (viewParam ? viewParam === 'read' : cachedViewMode === 'read')
    : (localRead !== null ? localRead : cachedViewMode === 'read') // true = read, false = write
  const menuRef = useRef(null)
  const buttonRef = useRef(null)
  const isDirtyRef = useRef(false)
  const headerObserverRef = useRef(null)
  const [headerVisible, setHeaderVisible] = useState(true)
  // Callback ref (not useRef + mount effect): on a hard refresh the page first
  // renders the skeleton, so a mount-time effect would run before the real header
  // exists and the observer would never attach (sticky toggle then never shows).
  // A callback ref fires whenever the header element mounts/unmounts.
  const headerRowRef = useCallback((el) => {
    if (headerObserverRef.current) { headerObserverRef.current.disconnect(); headerObserverRef.current = null }
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => setHeaderVisible(entry.isIntersecting),
      { threshold: 0 }
    )
    observer.observe(el)
    headerObserverRef.current = observer
  }, [])
  const [noteSettingsOpen, setNoteSettingsOpen] = useState(false)
  // Wikilink "create note?" confirm flow: holds the clicked unresolved title.
  const [linkModalTitle, setLinkModalTitle] = useState(null)
  const [creatingLink, setCreatingLink] = useState(false)
  // [[task:id]] cross-link → task details modal hosted here.
  const [openTask, setOpenTask] = useState(null)
  const openingTaskRef = useRef(false)
  // [[sandbox:id]] that resolves to no known board → "not found" notice modal.
  const [sandboxNotFound, setSandboxNotFound] = useState(false)

  // re-renders if note changes (parent changes)
  useEffect(() => {
    if(note){
      setNewTitle(note.title)
      setNewTags(note.tags || "")
    }
  }, [note])

  // Remember each note's view mode so it reopens the way it was left. Covers
  // both the in-note toggle and arriving via the card's read-mode button.
  useEffect(() => {
    if (note) writeViewMode(note.id, viewMode ? 'read' : 'write')
  }, [note?.id, viewMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Click outside detection for menu
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false)
      }
    }

    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [menuOpen])

  // this is for auto-selecting title when first created and visited
  useLayoutEffect(() => {
    if(newTitle === "Untitled" && titleInputReference.current){
      titleInputReference.current.select()
    }
  }, [newTitle, noteId])

  // Warn user before closing tab with unsaved changes
  useEffect(() => {
    const handler = (e) => {
      if (isDirtyRef.current) {
        e.preventDefault()
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  const handleDirtyChange = useCallback((dirty) => {
    isDirtyRef.current = dirty
  }, [])

  // Save handler for the editor - receives markdown content
  const handleEditorSave = useCallback(async (markdownContent) => {
    if (!note) return false
    return await editBody(note.id, markdownContent)
  }, [note?.id, editBody])

  // Confirm-creating a note from an unresolved [[wikilink]]: create it (awaiting
  // the synced note so we land on its real id), then navigate.
  const handleCreateLinkedNote = useCallback(async () => {
    const title = linkModalTitle
    if (!title || creatingLink || !addNote) return
    setCreatingLink(true)
    const newNote = await addNote(title)
    setCreatingLink(false)
    setLinkModalTitle(null)
    if (newNote) navigateToNote(newNote.id)
  }, [linkModalTitle, creatingLink, addNote, navigateToNote])

  // Open a [[task:id]] link: prefer the already-loaded task, else fetch by id.
  const handleOpenTask = useCallback(async (id) => {
    if (openingTaskRef.current) return
    const local = (tasks || []).find(t => String(t.id) === String(id))
    if (local) { setOpenTask(local); return }
    openingTaskRef.current = true
    try {
      const res = await authFetch(`${API}/tasks/${id}`)
      if (!res.ok) { toast.error('That linked item no longer exists.'); return }
      setOpenTask(await res.json())
    } catch {
      toast.error('Could not open that linked item.')
    } finally {
      openingTaskRef.current = false
    }
  }, [tasks, authFetch, API])

  // Open a [[sandbox:id]] link, or show a "not found" modal if no such board.
  // While the list hasn't hydrated yet, fall through to navigation rather than
  // false-flag a valid board as missing; once hydrated, a genuinely-missing board
  // (including for a user with zero boards) shows the not-found modal.
  const handleOpenSandbox = useCallback((id) => {
    if (!sandboxesLoaded || sandboxes.some(s => String(s.id) === String(id))) {
      navigate(`/sandboxes/${id}`)
    } else {
      setSandboxNotFound(true)
    }
  }, [sandboxes, sandboxesLoaded, navigate])

  // Clicking a #hashtag opens the notes list filtered by that term.
  const handleSearchTag = useCallback((tag) => {
    if (tag) navigate(`/notes?q=${encodeURIComponent(tag)}`)
  }, [navigate])

  // Clicking a [[link]] in the reading view — same behaviours as the editor.
  const handleOpenLink = useCallback((el) => {
    const kind = el.getAttribute('data-link-kind')
    if (kind === 'task') { handleOpenTask(el.getAttribute('data-link-id')); return }
    if (kind === 'sandbox') { handleOpenSandbox(el.getAttribute('data-link-id')); return }
    if (kind === 'bundle') { navigate(`/tasks?bundle=${el.getAttribute('data-link-id')}`); return }
    const target = (el.getAttribute('data-target') || '').trim()
    const found = (notes || []).find(n => (n.title || '').trim().toLowerCase() === target.toLowerCase())
    if (found) navigateToNote(found.id)
    else if (target) setLinkModalTitle(target)
  }, [handleOpenTask, handleOpenSandbox, navigate, navigateToNote, notes])

  // Draft recovery: decide the editor's initial content once per note. The
  // decision (is there a localStorage draft newer than the server copy?) is
  // computed purely here, keyed on note.id so it tracks the editor's remount
  // and never re-runs on incidental re-renders. The side effects (consuming the
  // draft + toasting) live in the effect below — running them inline on every
  // render is what caused the toast to fire repeatedly while editing.
  const initialContentInfo = useMemo(() => {
    if (!note) return { content: '' }
    const draftKey = `cinder_draft_${note.id}`
    try {
      const draft = localStorage.getItem(draftKey)
      if (draft) {
        const { content, savedAt } = JSON.parse(draft)
        const noteUpdated = new Date(note.updated_at).getTime()
        if (savedAt > noteUpdated) {
          return { content, recoveredKey: draftKey }
        }
        return { content: note.body || '', staleKey: draftKey } // stale draft, clean up
      }
    } catch { /* ignore malformed draft */ }
    return { content: note.body || '' }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id])

  // Consume the draft (and toast once) after mount. Stable per note.id, so this
  // runs exactly once per note — not on every re-render.
  useEffect(() => {
    if (initialContentInfo.recoveredKey) {
      localStorage.removeItem(initialContentInfo.recoveredKey)
      toast.warning('Recovered unsaved changes from local backup')
    } else if (initialContentInfo.staleKey) {
      localStorage.removeItem(initialContentInfo.staleKey)
    }
  }, [initialContentInfo])

  // Skeleton shown while loading notes from server, or while a freshly-created
  // optimistic note is still syncing with the backend
  const skeletonView = (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <Skeleton width="140px" height="36px" radius={4} />
        <Skeleton width="100%" height="40px" radius={6} style={{ flex: 1 }} />
        <Skeleton width="36px" height="36px" radius={4} />
        <Skeleton width="36px" height="36px" radius={4} />
      </div>
      <div className={styles.editorSurface}>
        <Skeleton width="60%" height="42px" radius={4} style={{ marginBottom: 24 }} />
        <Skeleton width="100%" height="18px" radius={4} style={{ marginBottom: 12 }} />
        <Skeleton width="92%" height="18px" radius={4} style={{ marginBottom: 12 }} />
        <Skeleton width="86%" height="18px" radius={4} style={{ marginBottom: 12 }} />
        <Skeleton width="70%" height="18px" radius={4} style={{ marginBottom: 24 }} />
        <Skeleton width="100%" height="18px" radius={4} style={{ marginBottom: 12 }} />
        <Skeleton width="78%" height="18px" radius={4} />
      </div>
    </div>
  )

  // Early return AFTER all hooks
  if (!note) {
    if (notesLoading) return skeletonView
    return (
      <div className={styles.container}>
        <p style={{ color: 'var(--text-muted)' }}>Note not found.</p>
      </div>
    )
  }

  // Optimistic note that hasn't synced yet — show skeleton instead of mounting
  // the editor so we don't fire PUT /notes/temp-... requests that will 404
  if (isOptimistic) return skeletonView

  // the api calls to save title/body/tags
  const saveTitle = async () => {
    if(!newTitle.trim()){
      toast.warning('Title cannot be empty')
      setNewTitle(note.title) // revert back to original title
      return;
    }
    if(newTitle === note.title) return; // no change, skip PUT
    editTitle(note.id, newTitle)
  }
  const saveTags = async () => {
     if (newTags === (note.tags || "")) return
     updateTags(note.id, newTags)
  }

  // QoL: after pressing enter on title, move to body (editor)
  const handleKeyDown = e => {
    if(e.key === "Enter" || e.key === "Tab"){
      e.preventDefault();
      // Focus the editor's content editable
      const editorElement = document.querySelector('[contenteditable="true"]');
      editorElement?.focus();
    }
  }

  // for back button (primary pane only)
  const handleGoBackBtn = () =>{
    navigate('/notes')
  }

  const toggleViewMode = () => {
    // Always write an explicit value (never delete): an absent param means
    // "freshly opened, use the remembered mode", so toggling to write must be
    // distinguishable from that — otherwise it'd fall back to the cache.
    const next = !viewMode
    if (isPrimary) {
      searchParams.set('view', next ? 'read' : 'write')
      setSearchParams(searchParams) // set after altering the params
    } else {
      setLocalRead(next)
    }
  }

  const toggleMenu = (e) => {
    e.preventDefault()
    e.stopPropagation()

    if (!menuOpen && buttonRef.current) {
      // Calculate if there's enough space below
      const buttonRect = buttonRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - buttonRect.bottom
      const menuHeight = 180 // Approximate menu height

      // If not enough space below, show above
      setMenuPosition(spaceBelow < menuHeight ? 'above' : 'below')
    }

    setMenuOpen(!menuOpen)
  }

  const handleFavoriteToggle = (e) => {
    e.preventDefault()
    e.stopPropagation()
    toggleFavorite(note.id)
    setMenuOpen(false)
  }

  const handleColorChange = (e, color) => {
    e.preventDefault()
    e.stopPropagation()
    updateColor(note.id, color)
  }

  const toggleLessDistraction = () => {
    setLessDistraction(prev => {
      const next = !prev
      // On enable, collapse the sidebar. On disable, leave it where the user
      // put it — toggling off is just for getting the page styling back.
      if (next && setSidebarCollapsed) setSidebarCollapsed(true)
      return next
    })
  }

  return (
    <div className={styles.container}>

      <div className={`${styles.viewToggleWrapper} ${headerVisible ? styles.viewToggleHidden : ''}`}>
        <button
          onClick={toggleViewMode}
          className={styles.viewToggleFloating}
          aria-label={viewMode ? 'Switch to edit mode' : 'Switch to read mode'}
        >
          {viewMode ? <HiPencilSquare /> : <MdChromeReaderMode />}
        </button>
      </div>

      {/* Header row with back/close button, tags input, and menu */}
      <div className={styles.headerRow} ref={headerRowRef}>
        {isPrimary ? (
          <button onClick={handleGoBackBtn} className={styles.backBtn}>
            <IoMdArrowRoundBack /> Back to Notes
          </button>
        ) : (
          <button onClick={onClose} className={styles.backBtn} aria-label="Close split view">
            <LuX /> Close split
          </button>
        )}

        <input
          className={styles.tagsInput}
          type='text'
          value={newTags}
          onChange={ e => setNewTags(e.target.value)}
          onBlur={saveTags}
          placeholder='Tags (e.g., personal, work, ideas...)'
          readOnly={viewMode}
        />

        <button onClick={toggleViewMode} className={styles.backBtn} aria-label={viewMode ? 'Switch to edit mode' : 'Switch to read mode'}>
          {viewMode ? <HiPencilSquare /> : <MdChromeReaderMode />}
        </button>

        {isPrimary && (
          <button
            onClick={onEnterSplit}
            className={styles.backBtn}
            title="Split view (experimental)"
            aria-label="Open split view (experimental)"
          >
            <LuColumns2 />
          </button>
        )}

        {isPrimary && (
          <button
            onClick={toggleLessDistraction}
            className={styles.backBtn}
            aria-pressed={lessDistraction}
            title={lessDistraction ? 'Exit less-distraction mode' : 'Less distraction mode'}
            aria-label={lessDistraction ? 'Exit less-distraction mode' : 'Enter less-distraction mode'}
          >
            {lessDistraction ? <LuMinimize /> : <LuMaximize />}
          </button>
        )}

        <div className={styles.menuContainer} ref={menuRef}>
          <button ref={buttonRef} onClick={toggleMenu} className={styles.menuBtn}>
            <FaEllipsisV />
          </button>

          {menuOpen && (
            <div className={`${styles.menu} ${menuPosition === 'above' ? styles.menuAbove : styles.menuBelow}`}>
              <button onClick={handleFavoriteToggle} className={styles.menuItem}>
                {note.is_favorite ? <FaStar color="#fbbf24" /> : <FaRegStar />}
                <span>{note.is_favorite ? 'Unfavorite' : 'Favorite'}</span>
              </button>

              <button
                onClick={() => { exportNote?.(note.id); setMenuOpen(false) }}
                className={styles.menuItem}
              >
                <HiOutlineDownload />
                <span>Export as markdown</span>
              </button>

              <button
                onClick={() => { printNoteToPdf(note); setMenuOpen(false) }}
                className={styles.menuItem}
              >
                <HiOutlineDocumentText />
                <span>Export as PDF</span>
              </button>

              <button
                onClick={() => { setNoteSettingsOpen(true); setMenuOpen(false) }}
                className={styles.menuItem}
              >
                <HiOutlineCog />
                <span>Note Settings</span>
              </button>

              <div className={styles.colorPicker}>
                <span className={styles.colorLabel}>Color:</span>
                <div className={styles.colorOptions}>
                  {NOTE_COLORS.map(c => {
                    const isSelected = (note.color ?? null) === c.key
                    return (
                      <button
                        key={c.name ?? 'default'}
                        onClick={(e) => handleColorChange(e, c.key)}
                        className={`${styles.colorBtn} ${isSelected ? styles.selected : ''}`}
                        style={{ backgroundColor: c.key ?? '#1e1e1e' }}
                        title={c.name}
                        aria-label={`Set color: ${c.name}`}
                        aria-pressed={isSelected}
                      />
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className={`${styles.editorSurface} ${lessDistraction ? styles.lessDistraction : ''}`}>
        <input
          ref={titleInputReference}
          className={styles.titleInput}
          type='text'
          value={newTitle}
          onChange={ e => setNewTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={handleKeyDown}
          readOnly={viewMode}
        />

        {/* CodeMirror editor stays mounted across the read/edit toggle (readMode prop)
            so unsaved edits are never lost; in read mode it renders its own reading
            view from the live doc. */}
        <CodeMirrorEditor
          key={note.id}
          readMode={viewMode}
          initialContent={initialContentInfo.content}
          onSave={handleEditorSave}
          noteId={note.id}
          onDirtyChange={handleDirtyChange}
          placeholder='Start typing here...'
          interfaceMode={false}
          notes={notes}
          onNavigateNote={navigateToNote}
          onCreateNote={(title) => setLinkModalTitle(title)}
          onOpenTask={handleOpenTask}
          onOpenSandbox={handleOpenSandbox}
          onOpenBundle={(id) => navigate(`/tasks?bundle=${id}`)}
          onSearchTag={handleSearchTag}
          onOpenLink={handleOpenLink}
          tasks={tasks}
          bundles={bundles}
          sandboxes={sandboxes}
        />
      </div>

      <NoteSettingsPopup
        isOpen={noteSettingsOpen}
        onClose={() => setNoteSettingsOpen(false)}
      />

      <ConfirmModal
        isOpen={linkModalTitle !== null}
        title='Create note?'
        message={`"${linkModalTitle}" doesn't exist yet. Create it and go there?`}
        confirmText='Create & open'
        cancelText='No'
        confirmVariant='primary'
        busy={creatingLink}
        busyText='Creating…'
        busyContent={
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Skeleton height={18} width='55%' />
            <Skeleton height={12} width='90%' />
            <Skeleton height={12} width='80%' />
            <Skeleton height={12} width='70%' />
          </div>
        }
        onClose={() => { if (!creatingLink) setLinkModalTitle(null) }}
        onConfirm={handleCreateLinkedNote}
      />

      {openTask && (
        <TaskDetailsModal
          task={openTask}
          updateTask={updateTask}
          onClose={() => setOpenTask(null)}
          onOpenInHub={() => { navigate(`/tasks?task=${openTask.id}`); setOpenTask(null) }}
        />
      )}

      <ConfirmModal
        isOpen={sandboxNotFound}
        title='Sandbox not found'
        message="This sandbox doesn't exist anymore (it may have been deleted)."
        confirmText='OK'
        confirmVariant='primary'
        hideCancel
        glow='danger'
        onConfirm={() => setSandboxNotFound(false)}
        onClose={() => setSandboxNotFound(false)}
      />
    </div>
  )
}

export default NotePane
