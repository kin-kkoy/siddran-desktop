import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import Card from '../../components/Notes/Card'
import HorizontalCard from '../../components/Notes/HorizontalCard'
import AddCard from '../../components/Notes/AddCard'
import AddCardList from '../../components/Notes/AddCardList'
import styles from './NotesHub.module.css'
import HorizontalNotebookCard from '../../components/Notebooks/HorizontalNotebookCard'
import NotebookCard from '../../components/Notebooks/NotebookCard'
import NotebookModal from '../../components/Notebooks/NotebookModal'
import CreateNotebookModal from '../../components/Notebooks/CreateNotebookModal'
import ImportNotebookModal from '../../components/Notebooks/ImportNotebookModal'
import ConfirmModal from '../../components/Common/ConfirmModal'
import { HiOutlineTrash, HiOutlineViewGrid, HiOutlineViewList, HiOutlineUpload } from 'react-icons/hi'
import { LuNotebookPen } from 'react-icons/lu'
import { toast } from '../../utils/toast'
import { compareByOrder, compareByFavoriteThenOrder } from '../../utils/noteSorting'
import { useDragReorder } from '../../hooks/useDragReorder'
import Skeleton from '../../components/Common/Skeleton'

// obtains the notes and
function NotesHub({ notes, notebooks, notesLoading, notebookNotesById, notesPagination, notebooksPagination, loadMoreNotes, loadMoreNotebooks, loadingMore, addNote, deleteNote, toggleFavorite, updateColor, createNotebook, deleteNotebook, toggleFavoriteNotebook, updateNotebookColor, updateNotebookTags, renameNotebook, removeNoteFromNotebook, addNotesToNotebook, importMarkdownFiles, reorderNotes, reorderNotebooks, authFetch, API }) {

  // Persist view mode in localStorage
  const [viewMode, setViewMode] = useState(() => {
    return localStorage.getItem('notesViewMode') || 'list'
  })
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

  const handleOpenCreateModal = () => {
    if(selectedNotes.length === 0){
      toast.warning('Please select at least one note to create a notebook')
      return
    }
    setShowCreateModal(true)
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

  const handleOpenNotebook = notebook => setSelectedNotebook(notebook)

  const handleCloseModal = () => setSelectedNotebook(null)

  // One pass over notes → note-count per notebook + a Set of notebook ids, so the render below
  // doesn't do an O(notes) scan per notebook row and the orphan test isn't O(notebooks) per note.
  const notebookIdSet = useMemo(() => new Set(notebooks.map(nb => nb.id)), [notebooks])
  const countByNotebook = useMemo(() => {
    const m = new Map()
    for (const n of notes) if (n.notebook_id != null) m.set(n.notebook_id, (m.get(n.notebook_id) || 0) + 1)
    return m
  }, [notes])

  // Search/sort derivations are memoized — they ran on every render (incl. each search keystroke),
  // and notes/notebooks grow unbounded via infinite scroll, so doing this inline was O(notes·notebooks).
  const filteredNotebooks = useMemo(() => notebooks.filter(notebook => {
    if (!searchQuery.trim()) return true // if search bar is empty then return everything (show everythign basically)

    const query = searchQuery.toLowerCase().trim()
    const name = notebook.name?.toLowerCase() || ''
    const tags = notebook.tags?.toLowerCase() || ''

    if (name.includes(query)) return true // Check if query matches notebook name

    // Check if query matches tags (with or without # prefix; "#work" == "work" && "work" == "#work" IN TAGS only)
    const searchTerm = query.startsWith('#') ? query.slice(1) : query
    if (tags.includes(searchTerm)) return true

    return false
  }).sort(compareByOrder), [notebooks, searchQuery])

  // Filter notes that aren't a part of any notebook, then apply search filter, then sort by favorites first
  const loneNotes = useMemo(() => notes.filter(note =>
      !note.notebook_id
      || note.notebook_id === "null"
      || !notebookIdSet.has(note.notebook_id)
    ).filter(note => {
      if (!searchQuery.trim()) return true // if search bar is empty then return everything (show everythign basically)

      const query = searchQuery.toLowerCase().trim()
      const title = note.title?.toLowerCase() || ''
      const tags = note.tags?.toLowerCase() || ''

      if (title.includes(query)) return true // Check if query matches title then return the note/s

      const searchTerm = query.startsWith('#') ? query.slice(1) : query
      if (tags.includes(searchTerm)) return true

      return false
    })
    .sort(compareByFavoriteThenOrder), [notes, notebookIdSet, searchQuery])

  // Drag-to-reorder (disabled while searching or selecting — you'd only be
  // reordering the filtered subset). The sidebar mirrors the same `order`.
  const canReorder = !searchQuery.trim() && !isSelectionMode
  const notebookIds = useMemo(() => filteredNotebooks.map(n => n.id), [filteredNotebooks])
  const loneNoteIds = useMemo(() => loneNotes.map(n => n.id), [loneNotes])
  const notebookById = useMemo(() => new Map(filteredNotebooks.map(n => [String(n.id), n])), [filteredNotebooks])
  const loneNoteById = useMemo(() => new Map(loneNotes.map(n => [String(n.id), n])), [loneNotes])
  const nbDrag = useDragReorder(notebookIds, reorderNotebooks, canReorder, 'notebooks')
  const noteDrag = useDragReorder(loneNoteIds, reorderNotes, canReorder, 'notes')


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
    <div className={styles.container}>


      <div className={styles.header}>
        <h1>Notes</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
          {filteredNotebooks.length} {filteredNotebooks.length === 1 ? 'notebook · ' : 'notebooks · '}
          {loneNotes.length} {loneNotes.length === 1 ? 'note' : 'notes'}
          {isSelectionMode && ` (${selectedNotes.length} selected)`}
        </p>

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

          {!isSelectionMode && (
            <button
              onClick={handleImportClick}
              className={styles.toggleBtn}
              title="Import markdown files"
            >
              <HiOutlineUpload size={18} />
            </button>
          )}

          {/* Create Notebook button - visible when not in delete mode */}
          {selectionMode !== 'delete' && (
            <button
              onClick={selectionMode === 'create' ? handleOpenCreateModal : enterCreateMode}
              className={styles.createNotebookBtn}
              disabled={selectionMode === 'create' && selectedNotes.length === 0}
            >
              <LuNotebookPen size={16} />
              {selectionMode === 'create' ? `Create (${selectedNotes.length})` : 'Create Notebook'}
            </button>
          )}

          {/* Delete button - visible when not in create mode */}
          {selectionMode !== 'create' && (
            <button
              onClick={selectionMode === 'delete' ? handleBatchDelete : enterDeleteMode}
              className={styles.batchDeleteBtn}
              disabled={selectionMode === 'delete' && selectedNotes.length === 0}
              title={selectionMode === 'delete' ? "Delete selected notes" : "Select notes to delete"}
            >
              <HiOutlineTrash size={18} />
            </button>
          )}

          {/* Cancel button - only in selection mode */}
          {isSelectionMode && (
            <button onClick={exitSelectionMode} className={styles.toggleBtn}>
              Cancel
            </button>
          )}

          <button onClick={changeView} className={styles.toggleBtn} title={viewMode === "list" ? "Card View" : "List View"}>
            {viewMode === "list" ? <HiOutlineViewGrid size={18} /> : <HiOutlineViewList size={18} />}
          </button>
        </div>
      </div>


      {/* ADD NOTE FOR LIST VIEW - above list */}
      {viewMode === "list" && !isSelectionMode && <AddCardList addNote={addNote}/>}

      {/* notes display area && ADD NOTE FOR CARD VIEW */}
      <div className={viewMode === "grid" ? styles.gridView : styles.listView}>

        {/* list view by default, change if it's in grid view */}
        {viewMode === "grid" && !isSelectionMode && <AddCard addNote={addNote}/>}
        
        {/* display NOTEBOOKS FIRST */}
        {!isSelectionMode && (
          nbDrag.order.map(nbId => {
            const notebook = notebookById.get(String(nbId))
            if (!notebook) return null
            const noteCount = countByNotebook.get(notebook.id) || 0
            return (
              <div key={notebook.id} className={styles.dragCell} {...nbDrag.dragProps(notebook.id)}>
                {viewMode === "list" ? (
                  <HorizontalNotebookCard
                    notebook={notebook}
                    noteCount={noteCount}
                    deleteNotebook={deleteNotebook}
                    onOpen={handleOpenNotebook}
                    toggleFavoriteNotebook={toggleFavoriteNotebook}
                    updateNotebookColor={updateNotebookColor}
                  />
                ) : (
                  <NotebookCard
                    notebook={notebook}
                    noteCount={noteCount}
                    deleteNotebook={deleteNotebook}
                    onOpen={handleOpenNotebook}
                    toggleFavoriteNotebook={toggleFavoriteNotebook}
                    updateNotebookColor={updateNotebookColor}
                  />
                )}
              </div>
            )
          })
        )}

        {/* afterwards display the LONE NOTES (notes that aren't part of a notebook) */}
        {noteDrag.order.map(nId => {
          const note = loneNoteById.get(String(nId))
          if (!note) return null
          return (
            <div key={note.id} className={styles.dragCell} {...noteDrag.dragProps(note.id)}>
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
                />
              )}
            </div>
          )
        })}
      </div>

      {/* Infinite scroll sentinels */}
      {hasMoreNotebooks && (
        <div ref={notebooksSentinelRef} className={styles.sentinel}>
          {loadingMore ? <span className={styles.loadingDots}>...</span> : <span className={styles.moreDots}>...</span>}
        </div>
      )}
      {hasMoreNotes && (
        <div ref={notesSentinelRef} className={styles.sentinel}>
          {loadingMore ? <span className={styles.loadingDots}>...</span> : <span className={styles.moreDots}>...</span>}
        </div>
      )}


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
