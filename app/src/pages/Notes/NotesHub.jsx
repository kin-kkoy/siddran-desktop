import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Card from '../../components/Notes/Card'
import HorizontalCard from '../../components/Notes/HorizontalCard'
import styles from './NotesHub.module.css'
import NotebookStrip, { UNFILED, EVERYTHING } from '../../components/Notebooks/NotebookStrip'
import { coverTone, lipTone } from '../../components/Notebooks/notebookTones'
import NotebookModal from '../../components/Notebooks/NotebookModal'
import CreateNotebookModal from '../../components/Notebooks/CreateNotebookModal'
import ImportNotebookModal from '../../components/Notebooks/ImportNotebookModal'
import ConfirmModal from '../../components/Common/ConfirmModal'
import { HiOutlineTrash, HiOutlineViewGrid, HiOutlineViewList, HiOutlineUpload } from 'react-icons/hi'
import { LuNotebookPen, LuFilePlus } from 'react-icons/lu'
import { useSettings } from '../../contexts/SettingsContext'
import { toast } from '../../utils/toast'
import { compareByOrder, compareByFavoriteThenOrder } from '../../utils/noteSorting'
import { useDragReorder } from '../../hooks/useDragReorder'
import Skeleton from '../../components/Common/Skeleton'

// Height of the prev/next bar, reserved whether or not it is showing. A measured
// value would oscillate: the bar only appears at 2+ pages, so its height changes
// the row count, which changes the page count, which removes the bar.
const PAGER_BAR_H = 48

// obtains the notes and
// Remembered list-view page. localStorage rather than settings.siddran for the same
// reason as notesViewMode / notesFilter above it: this is device-local UI state, not
// something to carry between machines.
const PAGE_KEY = 'notesPage'

function readStoredPage() {
  try {
    const v = JSON.parse(localStorage.getItem(PAGE_KEY) || 'null')
    if (!v || typeof v.page !== 'number') return 0
    // Only honour it for the view + notebook it was stored against; anything else
    // and page 3 of a list you are no longer looking at is just a wrong start.
    const sameView = v.viewMode === (localStorage.getItem('notesViewMode') || 'list')
    const sameFilter = v.filter === (localStorage.getItem('notesFilter') || UNFILED)
    return sameView && sameFilter ? Math.max(0, v.page) : 0
  } catch { return 0 }
}

function writeStoredPage(page, viewMode, filter) {
  try { localStorage.setItem(PAGE_KEY, JSON.stringify({ page, viewMode, filter })) } catch { /* ignore */ }
}

function NotesHub({ notes, notebooks, notesLoading, notebookNotesById, notesPagination, notebooksPagination, loadMoreNotes, loadMoreNotebooks, loadingMore, addNote, deleteNote, toggleFavorite, updateColor, createNotebook, deleteNotebook, toggleFavoriteNotebook, updateNotebookColor, updateNotebookTags, renameNotebook, removeNoteFromNotebook, addNotesToNotebook, importMarkdownFiles, reorderNotes, authFetch, API }) {

  // List view is PAGED, not scrolled: the area is fixed to the viewport and the
  // wheel swaps which notes are shown rather than moving the window. Rows are a
  // uniform height here, so how many fit is arithmetic — measured once per resize.
  const navigate = useNavigate()
  const pagerRef = useRef(null)
  const pagerBarRef = useRef(null)
  // Which page you were on survives leaving NotesHub: opening a note from page 2
  // and coming back landed you on page 1, so you had to page forward again every
  // time. Stored alongside the view mode and filter it belongs to — a remembered
  // page means nothing once you've switched notebooks or view.
  const [page, setPage] = useState(readStoredPage)
  const [perPage, setPerPage] = useState(16)

  // Persist view mode in localStorage
  const [viewMode, setViewMode] = useState(() => {
    return localStorage.getItem('notesViewMode') || 'list'
  })
  // Which notebook the hub is showing. Notebooks are a filter now, so this is
  // the hub's main state rather than a detail — persisted, because coming back to
  // the notebook you were in is the whole reason to have opened it.
  const [filter, setFilter] = useState(() => localStorage.getItem('notesFilter') || UNFILED)
  const [density, setDensity] = useState(() => localStorage.getItem('notesDensity') || 'comfortable')
  const { settings } = useSettings()
  const notebookView = settings.notebookView || 'notebooks'
  // Selection mode can be: null, 'delete', or 'create'
  const [selectionMode, setSelectionMode] = useState(null)
  const [selectedNotes, setSelectedNotes] = useState([])
  const [selectedNotebook, setSelectedNotebook] = useState(null)
  // Seed the search from a ?q= param (e.g. clicking a #hashtag in a note).
  const [searchParams] = useSearchParams()
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') || "")
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [pendingImportFiles, setPendingImportFiles] = useState(null)
  const importInputRef = useRef(null)

  // Helper to check if in any selection mode
  const isSelectionMode = selectionMode !== null

  // Refs for infinite scroll sentinels
  const notesSentinelRef = useRef(null)
  const notebooksSentinelRef = useRef(null)
  const scrollIntentTimeoutRef = useRef(null)
  const notebookScrollTimeoutRef = useRef(null)

  const hasMoreNotes = notesPagination?.hasNextPage
  const hasMoreNotebooks = notebooksPagination?.hasNextPage

  // Intersection Observer for notes infinite scroll
  useEffect(() => {
    if (!hasMoreNotes || loadingMore) return

    const sentinel = notesSentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries
        if (entry.isIntersecting && !loadingMore) {
          scrollIntentTimeoutRef.current = setTimeout(() => {
            loadMoreNotes()
          }, 300)
        } else {
          if (scrollIntentTimeoutRef.current) {
            clearTimeout(scrollIntentTimeoutRef.current)
          }
        }
      },
      { root: null, rootMargin: '100px', threshold: 0 }
    )

    observer.observe(sentinel)

    return () => {
      observer.disconnect()
      if (scrollIntentTimeoutRef.current) {
        clearTimeout(scrollIntentTimeoutRef.current)
      }
    }
  }, [hasMoreNotes, loadingMore, loadMoreNotes])

  // Intersection Observer for notebooks infinite scroll
  useEffect(() => {
    if (!hasMoreNotebooks || loadingMore) return

    const sentinel = notebooksSentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries
        if (entry.isIntersecting && !loadingMore) {
          notebookScrollTimeoutRef.current = setTimeout(() => {
            loadMoreNotebooks()
          }, 300)
        } else {
          if (notebookScrollTimeoutRef.current) {
            clearTimeout(notebookScrollTimeoutRef.current)
          }
        }
      },
      { root: null, rootMargin: '100px', threshold: 0 }
    )

    observer.observe(sentinel)

    return () => {
      observer.disconnect()
      if (notebookScrollTimeoutRef.current) {
        clearTimeout(notebookScrollTimeoutRef.current)
      }
    }
  }, [hasMoreNotebooks, loadingMore, loadMoreNotebooks])

  const changeView = () => {
    const newMode = viewMode === "list" ? "grid" : "list"
    setViewMode(newMode)
    localStorage.setItem('notesViewMode', newMode)
  }

  const chooseFilter = useCallback((key) => {
    // Clicking the notebook you are already in opens it for renaming, retagging
    // and bulk moves — the only way into NotebookModal now that notebooks are no
    // longer cards you can click.
    if (key === filter && key !== UNFILED && key !== EVERYTHING) {
      const nb = notebooks.find(n => String(n.id) === key)
      if (nb) setSelectedNotebook(nb)
      return
    }
    setFilter(key)
    localStorage.setItem('notesFilter', key)
    setPage(0)
    setSearchQuery('')
  }, [filter, notebooks])

  const chooseDensity = (v) => { setDensity(v); localStorage.setItem('notesDensity', v) }


  // Batch delete selected notes
  const handleBatchDelete = () => {
    if (selectedNotes.length === 0) return
    setShowDeleteModal(true)
  }

  const confirmBatchDelete = () => {
    selectedNotes.forEach(id => deleteNote(id))
    setSelectedNotes([])
    setSelectionMode(null)
    setShowDeleteModal(false)
  }

  const enterDeleteMode = () => {
    setSelectionMode('delete')
    setSelectedNotes([])
  }

  const enterCreateMode = () => {
    setSelectionMode('create')
    setSelectedNotes([])
  }

  const exitSelectionMode = () => {
    setSelectionMode(null)
    setSelectedNotes([])
  }

  const toggleNoteSelection = useCallback(noteId => {
    setSelectedNotes(prevNote => prevNote.includes(noteId) ? prevNote.filter(id => id !== noteId) : [...prevNote, noteId])
  }, [])

  // An empty notebook is worth creating now that notes are filed by dragging
  // them onto one, so no selection is required — pick notes first if you want it
  // to start with some, or make it empty and drag into it.
  const handleOpenCreateModal = () => setShowCreateModal(true)

  // The only way to add a note. The grid tile and the list row are gone, so this
  // is also the only place that has to guard against a double-click.
  const [addingNote, setAddingNote] = useState(false)
  const handleAddNote = async () => {
    if (addingNote) return
    setAddingNote(true)
    const toastId = toast.loading('Creating note…')
    try {
      const result = await addNote(
        'Untitled',
        (optimistic) => { if (optimistic?.id) navigate(`/notes/${optimistic.id}`) },
        (real) => { if (real?.id) navigate(`/notes/${real.id}`, { replace: true }) },
      )
      if (result) toast.update(toastId, 'Note created', 'success')
      else toast.dismiss(toastId)
    } finally {
      setAddingNote(false)
    }
  }

  const handleCreateNotebook = async (name, tags) => {
    await createNotebook(name, selectedNotes, tags)
    setSelectionMode(null)
    setSelectedNotes([])
    setShowCreateModal(false)
  }

  const handleImportClick = () => importInputRef.current?.click()

  const handleImportFilesSelected = (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (files.length === 0) return
    if (files.length === 1) {
      importMarkdownFiles(files, null)
    } else {
      setPendingImportFiles(files)
    }
  }

  const handleConfirmImportNotebook = async (notebookName) => {
    const files = pendingImportFiles
    setPendingImportFiles(null)
    if (files) await importMarkdownFiles(files, notebookName)
  }

  const handleCloseModal = () => setSelectedNotebook(null)

  // One pass over notes → note-count per notebook + a Set of notebook ids, so the render below
  // doesn't do an O(notes) scan per notebook and the orphan test isn't O(notebooks) per note.
  const notebookIdSet = useMemo(() => new Set(notebooks.map(nb => nb.id)), [notebooks])
  const countByNotebook = useMemo(() => {
    const m = new Map()
    for (const n of notes) if (n.notebook_id != null) m.set(n.notebook_id, (m.get(n.notebook_id) || 0) + 1)
    return m
  }, [notes])

  const isFiled = useCallback((note) => (
    note.notebook_id != null
    && note.notebook_id !== 'null'
    && notebookIdSet.has(note.notebook_id)
  ), [notebookIdSet])

  const sortedNotebooks = useMemo(() => notebooks.slice().sort(compareByOrder), [notebooks])
  // A note filed in a notebook borrows that notebook's paper unless it was given
  // a colour of its own. Resolved here rather than written to the note — see
  // paperTone() for why that matters.
  const toneByNotebook = useMemo(() => {
    const m = new Map()
    for (const nb of notebooks) m.set(String(nb.id), coverTone(nb.color))
    return m
  }, [notebooks])

  const activeNotebook = useMemo(
    () => notebooks.find(nb => String(nb.id) === filter) || null,
    [notebooks, filter])
  // The open notebook colours the page. Not decoration — it is the answer to
  // "where am I", repeated quietly in the few places you are already looking:
  // the stats rule, the search focus ring, the empty state, a card's hover edge.
  const hue = activeNotebook
    ? lipTone(activeNotebook.color)
    : filter === EVERYTHING ? 'var(--text-muted)' : 'var(--accent-warning)'
  const unfiledCount = useMemo(() => notes.filter(n => !isFiled(n)).length, [notes, isFiled])

  // A stale filter is only stale once the notebooks have actually arrived. On the
  // first render `notebooks` is [], so testing against it there would throw the
  // user back to Unfiled on every launch — the same trap that wiped the kanban
  // placements. `notebooksPagination` only exists after a real response.
  useEffect(() => {
    if (!notebooksPagination) return
    if (filter === UNFILED || filter === EVERYTHING) return
    if (!notebooks.some(nb => String(nb.id) === filter)) setFilter(UNFILED)
  }, [notebooksPagination, notebooks, filter])

  const matchesQuery = useCallback((note) => {
    const query = searchQuery.toLowerCase().trim()
    if (!query) return true
    const title = note.title?.toLowerCase() || ''
    const tags = note.tags?.toLowerCase() || ''
    if (title.includes(query)) return true
    // "#work" and "work" are the same search, but only against tags.
    const term = query.startsWith('#') ? query.slice(1) : query
    return tags.includes(term)
  }, [searchQuery])

  // What the grid holds. Search deliberately ignores the open notebook and spans
  // all of them: filing a note takes it out of the hub, so a search scoped to the
  // open notebook would make a filed note genuinely unreachable.
  const visibleNotes = useMemo(() => {
    const searching = !!searchQuery.trim()
    return notes.filter(note => {
      if (!matchesQuery(note)) return false
      if (searching) return true
      if (filter === EVERYTHING) return true
      if (filter === UNFILED) return !isFiled(note)
      return String(note.notebook_id) === filter
    }).sort(compareByFavoriteThenOrder)
  }, [notes, filter, searchQuery, matchesQuery, isFiled])

  // Drag-to-reorder, and drag-to-file onto the notebook strip. Reordering is off
  // while searching or selecting — you would only be reordering the filtered
  // subset — but filing stays on, because it is the point of the strip.
  // Also off in Everything: reorderNotes renumbers the ids it is handed 0..n, so
  // reordering a view that mixes filed and unfiled notes would hand the same
  // positions to two different scopes and scramble both.
  const canReorder = !searchQuery.trim() && !isSelectionMode && filter !== EVERYTHING
  const visibleNoteIds = useMemo(() => visibleNotes.map(n => n.id), [visibleNotes])
  const noteById = useMemo(() => new Map(visibleNotes.map(n => [String(n.id), n])), [visibleNotes])

  const fileNote = useCallback(async (noteId, key) => {
    const note = notes.find(n => String(n.id) === String(noteId))
    if (!note || key === EVERYTHING) return
    if (key === UNFILED) {
      if (!isFiled(note)) return
      await removeNoteFromNotebook(note.notebook_id, note.id)
      toast.success('Taken out of its notebook')
      return
    }
    if (String(note.notebook_id) === key) return
    // The API adds without removing, and a note has one notebook_id, so moving
    // between notebooks has to give the old one its count back explicitly.
    if (isFiled(note)) await removeNoteFromNotebook(note.notebook_id, note.id)
    await addNotesToNotebook(key, [note.id])
    const target = notebooks.find(nb => String(nb.id) === key)
    toast.success(`Filed in ${target?.name || 'notebook'}`)
  }, [notes, notebooks, isFiled, removeNoteFromNotebook, addNotesToNotebook])

  // glue, not animate. Glue is the part that matters: the card you grabbed follows
  // the cursor, so the drag is visible. FLIP for the other forty cards is what was
  // making them jump around and flicker — it re-measures every card on every
  // reorder, and its stored rects survive a filter change, so opening a notebook
  // slid the new notes in from wherever the old ones happened to be.
  const noteDrag = useDragReorder(visibleNoteIds, reorderNotes, canReorder, 'notes', {
    glue: true,
    dropSelector: '[data-drop-zone]',
    onDropZone: fileNote,
  })

  const pagedItems = useMemo(
    () => noteDrag.order.map(id => ({ kind: 'note', id })),
    [noteDrag.order])

  const pageCount = Math.max(1, Math.ceil(pagedItems.length / perPage))
  const safePage = Math.min(page, pageCount - 1)
  const visibleItems = viewMode === 'list'
    ? pagedItems.slice(safePage * perPage, safePage * perPage + perPage)
    : pagedItems

  // How many rows fit between the top of the list and the bottom of the scrolling
  // pane. Nothing in list view may ever scroll — the wheel turns pages instead — so
  // the list has to be sized to what is actually left, at every window size.
  //
  // Deliberately NOT a ResizeObserver on the list: the list's height depends on
  // perPage, so observing it means each measurement triggers another — that fed back
  // on itself and locked the window up. The pane and the row height are the only
  // inputs that don't depend on the result.
  const [pageHeight, setPageHeight] = useState(null)
  const [rowHeight, setRowHeight] = useState(null)
  useLayoutEffect(() => {
    if (viewMode !== 'list') return
    let raf = null
    const measure = () => {
      const el = pagerRef.current
      if (!el) return

      // Measure against the scrolling pane, not the window. Both rects are in
      // viewport coordinates, so their difference is independent of how far that
      // pane is currently scrolled — reading window.innerHeight while it was
      // scrolled fed the previous overflow straight into the next measurement.
      let scroller = el.parentElement
      while (scroller && scroller !== document.body) {
        const oy = getComputedStyle(scroller).overflowY
        if (oy === 'auto' || oy === 'scroll') break
        scroller = scroller.parentElement
      }
      const bottom = (scroller && scroller !== document.body)
        ? scroller.getBoundingClientRect().bottom
        : window.innerHeight

      const cs = getComputedStyle(el)
      // border-box is global, so the list's own vertical padding eats into the
      // height we set — count it separately from the rows.
      const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
      // Everything that still has to fit below the list. The pager bar is a
      // constant, never measured: it only exists at 2+ pages, so measuring it would
      // let the row count decide its own input. The container's bottom padding was
      // previously unaccounted for and overflowed the pane by exactly its 40px.
      const container = el.closest('.' + styles.container)
      const padBottom = container
        ? (parseFloat(getComputedStyle(container).paddingBottom) || 0)
        : 0
      const avail = bottom - el.getBoundingClientRect().top - PAGER_BAR_H - padBottom

      // The row height is a CSS constant, not a measurement. Rows are forced to it
      // by `grid-auto-rows`, so this is exact for every row — reading one rendered
      // row instead under-counted whenever a later row was taller (tags, a wrapped
      // title, a notebook row), and overflow:hidden then sliced the last one.
      // It is a MINIMUM: it decides how many rows fit, not how tall they end up.
      const minRow = Math.max(40, parseFloat(cs.getPropertyValue('--row-h')) || 72)
      const gap = parseFloat(cs.rowGap) || 12
      // Columns come from the grid itself. Below 900px it collapses to one, and
      // assuming two packed twice as many rows in as could fit — which is what made
      // a narrow window scroll.
      const cols = Math.max(1, cs.gridTemplateColumns.split(' ').filter(Boolean).length)
      const rows = Math.max(1, Math.floor((avail - padY + gap) / (minRow + gap)))
      // Then spend the remainder on the rows rather than leaving it at the bottom.
      // Dividing by a fixed row height always rounds down, and the leftover — up to a
      // whole row's worth — was dead space under the pager. Stretching absorbs it,
      // and it can't run away: the leftover is by definition less than one row, so
      // spread across `rows` rows it adds at most (minRow + gap) / rows pixels each.
      const rowH = Math.max(24, Math.floor((avail - padY - (rows - 1) * gap) / rows))
      // Size the box to a WHOLE number of rows. Using `avail` directly left a partial
      // row visible at the bottom, which overflow:hidden then sliced in half.
      const exact = rows * rowH + (rows - 1) * gap + padY
      // Never bail out on a cramped window. Returning early left the previous, larger
      // height in place, and that is precisely what let the list outgrow the pane and
      // put a scrollbar on it. Clip the single row instead — a shrinking window may
      // cost you the bottom of a row, but it never starts scrolling.
      const height = Math.max(0, Math.min(exact, avail))
      setPerPage(prev => (prev === rows * cols ? prev : rows * cols))
      setRowHeight(prev => (prev === rowH ? prev : rowH))
      setPageHeight(prev => (prev === height ? prev : height))
    }
    // After layout, so `top` reflects the real header height rather than a
    // pre-paint estimate — measuring too early made `avail` too generous, which is
    // what left the page itself scrollable.
    raf = requestAnimationFrame(measure)
    window.addEventListener('resize', measure)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', measure) }
    // isSelectionMode is a dependency because entering it swaps the header buttons
    // and drops the add-note row, both of which move the top of the list.
  }, [viewMode, isSelectionMode])

  // Switching view or searching starts over — but NOT on mount, which would throw
  // away the page we just restored.
  const didMount = useRef(false)
  useEffect(() => {
    if (!didMount.current) { didMount.current = true; return }
    setPage(0)
  }, [viewMode, searchQuery])

  useEffect(() => { writeStoredPage(safePage, viewMode, filter) }, [safePage, viewMode, filter])

  // The wheel turns pages instead of scrolling — nothing here actually moves.
  const onPagerWheel = useCallback((e) => {
    if (viewMode !== 'list') return
    e.preventDefault()
    if (Math.abs(e.deltaY) < 4) return
    setPage(p => Math.min(Math.max(p + (e.deltaY > 0 ? 1 : -1), 0), pageCount - 1))
  }, [viewMode, pageCount])

  // Nothing scrolls any more, so the observers never fire — pull the next batch as
  // you approach the last page instead.
  useEffect(() => {
    if (viewMode !== 'list') return
    if (safePage >= pageCount - 2 && hasMoreNotes && !loadingMore) loadMoreNotes?.()
  }, [safePage, pageCount, hasMoreNotes, loadingMore, loadMoreNotes, viewMode])


  if (notesLoading && notes.length === 0 && notebooks.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <Skeleton width="180px" height="36px" />
          <Skeleton width="220px" height="14px" style={{ marginTop: 4 }} />
          <Skeleton width="100%" height="40px" radius={8} style={{ marginTop: 12 }} />
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: 12 }}>
            <Skeleton width="36px" height="36px" radius={6} />
            <Skeleton width="160px" height="36px" radius={6} />
            <Skeleton width="36px" height="36px" radius={6} />
            <Skeleton width="36px" height="36px" radius={6} />
          </div>
        </div>
        <div className={viewMode === "grid" ? styles.gridView : styles.listView}>
          {Array.from({ length: viewMode === "grid" ? 6 : 5 }).map((_, i) => (
            <Skeleton
              key={i}
              width="100%"
              height={viewMode === "grid" ? "200px" : "80px"}
              radius={10}
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container} style={{ '--hue': hue }}>


      <div className={styles.header}>
        <h1>Notes</h1>

        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search notes and notebooks by title or tags (e.g., #work)..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <input
            ref={importInputRef}
            type="file"
            accept=".md,text/markdown"
            multiple
            style={{ display: 'none' }}
            onChange={handleImportFilesSelected}
          />

          {/* Only the two that CREATE something keep a button around them, so the
              row has one weight for "make a thing" and a quieter one for the rest.
              These are also the ONLY way to add: the add-note tile in the grid and
              the add-note row above the list are gone, so a new note always starts
              from the same place whichever view you are in. */}
          {!isSelectionMode && (
            <button onClick={handleAddNote} className={styles.createNotebookBtn} disabled={addingNote}>
              <LuFilePlus size={15} />
              Note
            </button>
          )}

          {selectionMode !== 'delete' && (
            <button
              onClick={selectionMode === 'create' ? handleOpenCreateModal : enterCreateMode}
              className={styles.createNotebookBtn}
            >
              <LuNotebookPen size={15} />
              {selectionMode === 'create'
                ? (selectedNotes.length ? `Create (${selectedNotes.length})` : 'Create empty')
                : 'Notebook'}
            </button>
          )}

          {isSelectionMode && (
            <button onClick={exitSelectionMode} className={styles.toggleBtn}>
              Cancel
            </button>
          )}

          <span className={styles.iconGroup}>
            {!isSelectionMode && (
              <button onClick={handleImportClick} className={styles.iconBtn} title="Import markdown files">
                <HiOutlineUpload size={17} />
              </button>
            )}

            {selectionMode !== 'create' && (
              <button
                onClick={selectionMode === 'delete' ? handleBatchDelete : enterDeleteMode}
                className={`${styles.iconBtn} ${selectionMode === 'delete' ? styles.iconBtnDanger : ''}`}
                disabled={selectionMode === 'delete' && selectedNotes.length === 0}
                title={selectionMode === 'delete' ? "Delete selected notes" : "Select notes to delete"}
              >
                <HiOutlineTrash size={17} />
              </button>
            )}

            <button onClick={changeView} className={styles.iconBtn} title={viewMode === "list" ? "Card View" : "List View"}>
              {viewMode === "list" ? <HiOutlineViewGrid size={17} /> : <HiOutlineViewList size={17} />}
            </button>
          </span>
        </div>
      </div>


      {/* Notebooks: a filter above the notes, not cards among them. The rail is
          the one presentation that sits beside the grid rather than over it. */}
      <div className={`${styles.hubBody} ${notebookView === 'rail' ? styles.hubRail : ''}`}>
        {notebookView === 'rail' && (
          <NotebookStrip
            view="rail"
            notebooks={sortedNotebooks}
            countByNotebook={countByNotebook}
            unfiledCount={unfiledCount}
            totalCount={notes.length}
            active={filter}
            onSelect={chooseFilter}
            hoverZone={noteDrag.hoverZone}
          />
        )}

        <div className={styles.hubMain}>
          {notebookView !== 'rail' && (
            <NotebookStrip
              view={notebookView}
              notebooks={sortedNotebooks}
              countByNotebook={countByNotebook}
              unfiledCount={unfiledCount}
              totalCount={notes.length}
              active={filter}
              onSelect={chooseFilter}
              hoverExpand={settings.notebookHoverExpand !== false}
              hoverZone={noteDrag.hoverZone}
            />
          )}

          {/* One stats line, on the row with the view controls. It used to be split
              between the header and here, which said the same thing twice. */}
          <div className={styles.toolbar}>
            <span className={styles.stats}>
              <b>{visibleNotes.length}</b>{' '}
              {searchQuery.trim()
                ? `match${visibleNotes.length === 1 ? '' : 'es'} across every notebook`
                : filter === UNFILED
                  ? `unfiled · ${notes.length - unfiledCount} filed`
                  : filter === EVERYTHING
                    ? 'notes, filed and not'
                    : `in ${activeNotebook?.name || 'this notebook'}`}
              {' · '}{notebooks.length} {notebooks.length === 1 ? 'notebook' : 'notebooks'}
              {isSelectionMode && ` · ${selectedNotes.length} selected`}
            </span>

            {viewMode === 'grid' && (
              <div className={styles.densityGroup} role="group" aria-label="Card size">
                {['comfortable', 'compact', 'dense'].map(d => (
                  <button
                    key={d}
                    type="button"
                    className={`${styles.densityBtn} ${density === d ? styles.densityOn : ''}`}
                    onClick={() => chooseDensity(d)}
                  >
                    {d[0].toUpperCase() + d.slice(1)}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* notes display area && ADD NOTE FOR CARD VIEW */}
          <div
            ref={pagerRef}
            className={`${viewMode === "grid" ? styles.gridView : styles.listView} ${viewMode === 'grid' ? styles['d_' + density] : ''}`}
            onWheel={onPagerWheel}
            style={viewMode === 'list' && pageHeight
              ? { height: pageHeight, gridAutoRows: rowHeight ? `${rowHeight}px` : undefined }
              : undefined}
          >
            {visibleItems.map(({ id: nId }) => {
              const note = noteById.get(String(nId))
              if (!note) return null
              return (
                <div
                  key={note.id}
                  data-row
                  className={styles.dragCell}
                  /* Set only on the card actually in flight, and only while it is
                     over a notebook: it shrinks into the gap the notebook opens. */
                  data-swallowed={
                    noteDrag.hoverZone != null && String(noteDrag.activeId) === String(note.id)
                      ? '' : undefined
                  }
                  {...noteDrag.dragProps(note.id)}
                >
                  {viewMode === "list" ? (
                    <HorizontalCard
                      note={note}
                      deleteNote={deleteNote}
                      toggleFavorite={toggleFavorite}
                      updateColor={updateColor}
                      isSelectionMode={isSelectionMode}
                      isSelected={selectedNotes.includes(note.id)}
                      onToggleSelect={toggleNoteSelection}
                    />
                  ) : (
                    <Card
                      note={note}
                      deleteNote={deleteNote}
                      toggleFavorite={toggleFavorite}
                      updateColor={updateColor}
                      isSelectionMode={isSelectionMode}
                      isSelected={selectedNotes.includes(note.id)}
                      onToggleSelect={toggleNoteSelection}
                      inheritTone={toneByNotebook.get(String(note.notebook_id))}
                    />
                  )}
                </div>
              )
            })}

            {visibleNotes.length === 0 && !notesLoading && (
              <div className={styles.emptyState}>
                <h3>{searchQuery.trim() ? 'Nothing matches that' : 'Nothing filed here yet'}</h3>
                <p>
                  {searchQuery.trim()
                    ? 'Search covers every notebook, so this note is not in the Bag under that name or tag.'
                    : filter === UNFILED
                      ? 'Every note is put away. Open a notebook above, or start a new note.'
                      : 'Drag a note onto this notebook to file it. Filed notes show up here and nowhere else.'}
                </p>
              </div>
            )}
          </div>

      {/* Page controls. The wheel already turns pages; these make that discoverable
          and give the keyboard a way in. */}
      {viewMode === "list" && pageCount > 1 && (
        <div className={styles.pagerBar} ref={pagerBarRef}>
          <button
            type="button"
            className={styles.pagerBtn}
            onClick={() => setPage(p => Math.max(p - 1, 0))}
            disabled={safePage === 0}
            aria-label="Previous page"
          >‹</button>
          <span className={styles.pagerCount}>
            {safePage + 1} / {pageCount}
          </span>
          <button
            type="button"
            className={styles.pagerBtn}
            onClick={() => setPage(p => Math.min(p + 1, pageCount - 1))}
            disabled={safePage >= pageCount - 1}
            aria-label="Next page"
          >›</button>
        </div>
      )}

      {/* Infinite scroll sentinels */}
      {/* Notebooks are the strip now, not rows in the grid — but they still page
          in, so the sentinel stays and simply sits under the notes. */}
      {hasMoreNotebooks && (
        <div ref={notebooksSentinelRef} className={styles.sentinel}>
          {loadingMore ? <span className={styles.loadingDots}>...</span> : <span className={styles.moreDots}>...</span>}
        </div>
      )}
      {viewMode !== "list" && hasMoreNotes && (
        <div ref={notesSentinelRef} className={styles.sentinel}>
          {loadingMore ? <span className={styles.loadingDots}>...</span> : <span className={styles.moreDots}>...</span>}
        </div>
      )}
        </div>
      </div>


      {/* Modal area */}
      {selectedNotebook && (
        <NotebookModal
          notebook={selectedNotebook}
          onClose={handleCloseModal}
          authFetch={authFetch}
          API={API}
          updateNotebookTags={updateNotebookTags}
          renameNotebook={renameNotebook}
          removeNoteFromNotebook={removeNoteFromNotebook}
          addNotesToNotebook={addNotesToNotebook}
          notebookNotes={notebookNotesById[selectedNotebook.id]}
          allNotes={notes}
          deleteNotebook={deleteNotebook}
          toggleFavoriteNotebook={toggleFavoriteNotebook}
          updateNotebookColor={updateNotebookColor}
        />
      )}

      {/* Create Notebook Modal */}
      {showCreateModal && (
        <CreateNotebookModal
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreateNotebook}
          selectedNotesCount={selectedNotes.length}
        />
      )}

      {/* Import Notebook Modal (bulk import) */}
      {pendingImportFiles && (
        <ImportNotebookModal
          fileCount={pendingImportFiles.length}
          onClose={() => setPendingImportFiles(null)}
          onConfirm={handleConfirmImportNotebook}
        />
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={confirmBatchDelete}
        title="Delete Notes"
        message={`Are you sure you want to delete ${selectedNotes.length} selected note(s)? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
      />

    </div>
  )
}

export default NotesHub
