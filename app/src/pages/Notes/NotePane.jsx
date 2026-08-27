import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useSearchParams } from 'react-router-dom'
import styles from './NotePage.module.css'
import { FaThumbtack, FaEllipsisV } from 'react-icons/fa'
import { MdChromeReaderMode } from "react-icons/md";
import { HiPencilSquare } from "react-icons/hi2";
import { HiOutlineDownload, HiOutlineCog, HiOutlineDocumentText } from "react-icons/hi";
import { LuColumns2, LuTag, LuMessageSquare, LuListTree, LuSearch } from "react-icons/lu";
import CodeMirrorEditor from '../../components/Editor/CodeMirrorEditor'
import NoteOutline from '../../components/Notes/NoteOutline'
import NoteSearch from '../../components/Notes/NoteSearch'
import { parseHeadings } from '../../utils/headings'
import { printNoteToPdf } from '../../components/Editor/utils/exportPdf'
import ConfirmModal from '../../components/Common/ConfirmModal'
import TaskDetailsModal from '../../components/Common/TaskDetailsModal'
import { useApi } from '../../contexts/ApiContext'
import { useSandboxes } from '../../hooks/useSandboxes'
import { readViewMode, writeViewMode } from '../../hooks/noteViewModeCache'
import { readOutlineOpen, writeOutlineOpen } from '../../hooks/noteOutlineCache'
import { useComments } from '../../hooks/useComments'
import CommentsPanel from '../../components/Comments/CommentsPanel'
import { useNoteSplit } from '../../contexts/NoteSplitContext'
import { useSidePane } from '../../contexts/SidePaneContext'
import { isAttachmentHref, isExternalHref, nameFromHref } from '../../utils/attachmentLinks'
import { requestOpenExternal } from '../../desktop/openExternal'
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
  controlsSlot,
  ownsControls = true,
  showDock = true,
  editorViewRef,
  commentActionRef,
  notes,
  notesLoading,
  editTitle,
  editBody,
  updateTags,
  toggleFavorite,
  updateColor,
  exportNote,
  tasks,
  addNote,
  updateTask,
  bundles,
  docCache,
}) {

  const split = useNoteSplit()
  const sidePane = useSidePane()
  const { authFetch, API } = useApi()
  const { sandboxes, sandboxesLoaded } = useSandboxes()

  const navigate = useNavigate()
  // Match by string for optimistic temp ids and by number for synced server ids
  const note = notes && notes.length
    ? notes.find(n => n.id === noteId || n.id === Number(noteId))
    : null
  const isOptimistic = note?._optimistic === true

  // Comments (Google-Docs style). React owns thread content; the editor owns live
  // anchor positions and feeds remaps back through `applyRemap`.
  const comments = useComments(note?.id)
  const commentApiRef = useRef(null)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [activeThreadId, setActiveThreadId] = useState(null)
  const [draftAnchor, setDraftAnchor] = useState(null) // captured selection awaiting its first comment
  useEffect(() => { setCommentsOpen(false); setActiveThreadId(null); setDraftAnchor(null) }, [noteId])

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
  // Document outline (right rail). Per-pane state so each split pane toggles its
  // own; the open/closed choice is remembered per note across sessions.
  const [outlineOpen, setOutlineOpen] = useState(() => readOutlineOpen(noteId))
  useEffect(() => { setOutlineOpen(readOutlineOpen(noteId)) }, [noteId])
  const outlineOpenRef = useRef(outlineOpen)
  useEffect(() => { outlineOpenRef.current = outlineOpen }, [outlineOpen])
  const scrollToLineRef = useRef(null)
  // In-note search (Ctrl+F). Per-pane so split view searches only the focused note;
  // ephemeral (not persisted). `searchApiRef` is the editor's imperative find API.
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchFocusToken, setSearchFocusToken] = useState(0)
  const searchApiRef = useRef(null)
  useEffect(() => { setSearchOpen(false) }, [noteId])
  // Ctrl/Cmd+F opens the find bar — only on the pane that owns the controls (the
  // focused one in split view), so a single handler targets the right note.
  useEffect(() => {
    if (!ownsControls) return
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        setSearchOpen(true)
        setSearchFocusToken((t) => t + 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ownsControls])
  // Headings update live as you type: while the outline is open we mirror the
  // editor's current text into `liveBody` (debounced); null falls back to the
  // saved body (fresh note / outline closed).
  const [liveBody, setLiveBody] = useState(null)
  const liveBodyTimer = useRef(null)
  useEffect(() => { setLiveBody(null) }, [noteId])
  useEffect(() => () => { if (liveBodyTimer.current) clearTimeout(liveBodyTimer.current) }, [])
  const outlineHeadings = useMemo(
    () => parseHeadings(liveBody != null ? liveBody : (note?.body || '')),
    [liveBody, note?.body],
  )
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
  const [tagsModalOpen, setTagsModalOpen] = useState(false)
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

  const handleDirtyChange = useCallback((dirty) => {
    isDirtyRef.current = dirty
  }, [])

  // Save handler for the editor - receives markdown content
  const handleEditorSave = useCallback(async (markdownContent) => {
    if (!note) return false
    return await editBody(note.id, markdownContent)
  }, [note?.id, editBody])

  // Every editor edit: keep the layout-remount cache current, and (while the
  // outline is open) refresh its headings live with a small debounce.
  const handleDocChange = useCallback((md) => {
    if (note) docCache?.set(String(note.id), md)
    if (outlineOpenRef.current) {
      if (liveBodyTimer.current) clearTimeout(liveBodyTimer.current)
      liveBodyTimer.current = setTimeout(() => setLiveBody(md), 250)
    }
  }, [docCache, note?.id])

  // Toggle the outline; persist the choice and seed live headings from the
  // editor's current text when opening so it's accurate immediately.
  const toggleOutline = useCallback(() => {
    setOutlineOpen(prev => {
      const next = !prev
      writeOutlineOpen(noteId, next)
      if (next && note) setLiveBody(docCache?.get(String(note.id)) ?? note.body ?? '')
      return next
    })
  }, [noteId, note, docCache])

  // ── Comments ──
  const { threads: commentThreads, addThread, addReply, resolveThread, deleteThread, deleteComment, applyRemap } = comments
  const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `c-${Date.now()}-${Math.random().toString(36).slice(2)}`)

  // Comment button: with a text selection (editor or reading view) → start a new
  // thread; otherwise just toggle the panel.
  const handleCommentButton = useCallback(() => {
    let anchor = commentApiRef.current?.captureSelection?.()
    if (!anchor) {
      const sel = typeof window !== 'undefined' ? window.getSelection?.() : null
      const text = sel && !sel.isCollapsed ? sel.toString().trim() : ''
      if (text) anchor = commentApiRef.current?.locateSelectionText?.(text)
    }
    if (anchor) { setDraftAnchor({ id: uid(), ...anchor }); setCommentsOpen(true) }
    else setCommentsOpen(o => !o)
  }, [])

  // Expose the comment action so the shared split-view dock (owned by NotePage)
  // can trigger it on whichever pane is focused.
  useEffect(() => {
    if (!commentActionRef) return
    commentActionRef.current = handleCommentButton
    return () => { if (commentActionRef.current === handleCommentButton) commentActionRef.current = null }
  }, [commentActionRef, handleCommentButton])

  const submitDraft = useCallback((text) => {
    setDraftAnchor(d => {
      if (d && text.trim()) { addThread(d, text); setActiveThreadId(d.id) }
      return null
    })
  }, [addThread])

  const selectThread = useCallback((id) => {
    setActiveThreadId(id)
    commentApiRef.current?.setActive?.(id)
    commentApiRef.current?.scrollTo?.(id)
  }, [])

  // A highlight (editor or reading view) was clicked → focus its thread.
  const handleCommentClick = useCallback((id) => {
    setCommentsOpen(true)
    setActiveThreadId(id)
    commentApiRef.current?.setActive?.(id)
  }, [])

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

  // Open a PDF attachment link in the side viewer (shared by editor + reading view).
  // Opening a PDF collapses any note split back to the route note, so if this is
  // the secondary pane, promote its note to the route first — the PDF then opens
  // beside the note you clicked from instead of jumping to the first tab.
  const handleOpenPdf = useCallback((href) => {
    if (!href) return
    if (!isPrimary && noteId != null) navigate(`/notes/${noteId}`)
    sidePane.requestOpen(href, nameFromHref(href))
  }, [sidePane, isPrimary, noteId, navigate])

  // Clicking a [[link]] in the reading view — same behaviours as the editor.
  const handleOpenLink = useCallback((el) => {
    const kind = el.getAttribute('data-link-kind')
    if (kind === 'task') { handleOpenTask(el.getAttribute('data-link-id')); return }
    if (kind === 'sandbox') { handleOpenSandbox(el.getAttribute('data-link-id')); return }
    if (kind === 'bundle') { navigate(`/tasks?bundle=${el.getAttribute('data-link-id')}`); return }
    const href = el.getAttribute('data-href')
    // Attachments first: a remote PDF is an attachment, not web browsing.
    if (href && isAttachmentHref(href)) { handleOpenPdf(href); return }
    if (href && isExternalHref(href)) { requestOpenExternal(href); return }
    const target = (el.getAttribute('data-target') || '').trim()
    const found = (notes || []).find(n => (n.title || '').trim().toLowerCase() === target.toLowerCase())
    if (found) navigateToNote(found.id)
    else if (target) setLinkModalTitle(target)
  }, [handleOpenTask, handleOpenSandbox, handleOpenPdf, navigate, navigateToNote, notes])

  // The editor's initial content, resolved once per note.id (it's remount-keyed).
  // Prefer the live in-memory cache — set on every edit — so a layout-mode remount
  // reopens with the current text; fall back to the saved body on first open.
  const initialContent = useMemo(() => {
    if (!note) return ''
    const cached = docCache?.get(String(note.id))
    return cached != null ? cached : (note.body || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id])

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

  return (
    <div className={styles.paneRoot}>
    <div className={styles.mainCol}>
    {ownsControls && searchOpen && (
      <NoteSearch
        searchRef={searchApiRef}
        viewMode={viewMode}
        focusToken={searchFocusToken}
        onClose={() => setSearchOpen(false)}
      />
    )}
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

      {/* Header controls → portaled into the tab bar's right slot for the primary
          note (tabs + controls share one row); rendered inline otherwise. */}
      {ownsControls && (() => {
        const headerContent = (
          <div className={`${styles.headerRow} ${controlsSlot ? styles.headerRowSlotted : ''}`} ref={headerRowRef}>
        <button onClick={toggleViewMode} className={styles.backBtn} aria-label={viewMode ? 'Switch to edit mode' : 'Switch to read mode'}>
          {viewMode ? <HiPencilSquare /> : <MdChromeReaderMode />}
        </button>

        {/* Enter-split is offered only when we're NOT already in a split. */}
        {isPrimary && !split.enabled && (
          <button
            onClick={onEnterSplit}
            className={styles.backBtn}
            title="Split view (experimental)"
            aria-label="Open split view (experimental)"
          >
            <LuColumns2 />
          </button>
        )}

        <button
          onClick={handleCommentButton}
          className={styles.backBtn}
          aria-pressed={commentsOpen}
          title="Comments (select text to add)"
          aria-label="Comments"
        >
          <LuMessageSquare />
        </button>

        <button
          onClick={toggleOutline}
          className={styles.backBtn}
          aria-pressed={outlineOpen}
          title="Document outline"
          aria-label="Document outline"
        >
          <LuListTree />
        </button>

        <button
          onClick={() => { setSearchOpen(v => !v); setSearchFocusToken(t => t + 1) }}
          className={styles.backBtn}
          aria-pressed={searchOpen}
          title="Search in note (Ctrl+F)"
          aria-label="Search in note"
        >
          <LuSearch />
        </button>

        <div className={styles.menuContainer} ref={menuRef}>
          <button ref={buttonRef} onClick={toggleMenu} className={styles.menuBtn}>
            <FaEllipsisV />
          </button>

          {menuOpen && (
            <div className={`${styles.menu} ${menuPosition === 'above' ? styles.menuAbove : styles.menuBelow}`}>
              <button onClick={handleFavoriteToggle} className={styles.menuItem}>
                {note.is_favorite ? <FaThumbtack color="#fbbf24" /> : <FaThumbtack style={{ opacity: 0.45 }} />}
                <span>{note.is_favorite ? 'Unpin' : 'Pin'}</span>
              </button>

              <button onClick={() => { setTagsModalOpen(true); setMenuOpen(false) }} className={styles.menuItem}>
                <LuTag />
                <span>Edit tags</span>
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
        )
        // The focused pane owns the shared control cluster in the tab bar. Fall
        // back to inline rendering only if the slot isn't mounted yet.
        return controlsSlot ? createPortal(headerContent, controlsSlot) : headerContent
      })()}

      <div className={styles.editorSurface}>
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
          initialContent={initialContent}
          onSave={handleEditorSave}
          onDocChange={handleDocChange}
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
          onOpenPdf={handleOpenPdf}
          tasks={tasks}
          bundles={bundles}
          sandboxes={sandboxes}
          scrollApiRef={scrollToLineRef}
          searchApiRef={searchApiRef}
          showDock={showDock}
          editorViewRef={editorViewRef}
          comments={commentThreads}
          onCommentsRemap={applyRemap}
          onCommentClick={handleCommentClick}
          commentApiRef={commentApiRef}
          onComment={handleCommentButton}
        />
      </div>

      {tagsModalOpen && (
        <div
          className={styles.tagsBackdrop}
          onClick={(e) => { if (e.target === e.currentTarget) { saveTags(); setTagsModalOpen(false) } }}
        >
          <div className={styles.tagsModal}>
            <label className={styles.tagsModalLabel}>Tags</label>
            <input
              className={styles.tagsModalInput}
              type="text"
              value={newTags}
              onChange={(e) => setNewTags(e.target.value)}
              placeholder="personal, work, ideas..."
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') { saveTags(); setTagsModalOpen(false) } }}
            />
            <button className={styles.tagsModalDone} onClick={() => { saveTags(); setTagsModalOpen(false) }}>Done</button>
          </div>
        </div>
      )}

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
    </div>
    {outlineOpen && (
      <NoteOutline
        headings={outlineHeadings}
        onJump={(line) => scrollToLineRef.current?.(line)}
        onClose={() => setOutlineOpen(false)}
      />
    )}
    {commentsOpen && (
      <CommentsPanel
        threads={commentThreads}
        draft={draftAnchor}
        activeId={activeThreadId}
        onSubmitDraft={submitDraft}
        onCancelDraft={() => setDraftAnchor(null)}
        onSelectThread={selectThread}
        onReply={addReply}
        onResolve={resolveThread}
        onDelete={(id) => { deleteThread(id); setActiveThreadId(a => (a === id ? null : a)) }}
        onDeleteComment={deleteComment}
        onClose={() => setCommentsOpen(false)}
      />
    )}
    </div>
  )
}

export default NotePane
