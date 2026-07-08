import { useEffect, useState } from 'react'
import styles from './NotebookModal.module.css'
import { useNavigate } from 'react-router-dom'
import { MdChromeReaderMode } from 'react-icons/md'
import { HiOutlineX, HiPlus } from 'react-icons/hi'

function NotebookModal({ notebook, onClose, updateNotebookTags, renameNotebook, removeNoteFromNotebook, addNotesToNotebook, notebookNotes, allNotes }) {
    const [tags, setTags] = useState(notebook?.tags || '')
    const [name, setName] = useState(notebook?.name || '')
    const [showPicker, setShowPicker] = useState(false)
    const [selectedNoteIds, setSelectedNoteIds] = useState([])
    const [isAdding, setIsAdding] = useState(false)
    const navigate = useNavigate()

    const availableNotes = allNotes.filter(n => !n.notebook_id)
    // Hook prefetches notebook notes on auth; this prop reflects the cached list.
    // It may be undefined for a beat right after the notebook was just created
    // and before its prefetch lands — render an empty list in that case.
    const notes = notebookNotes || []
    const loading = notebookNotes === undefined

    useEffect(() => {
        setTags(notebook?.tags || '')
    }, [notebook])

    const handleNoteClick = (noteId) => {
        navigate(`/notes/${noteId}`)
        onClose()
    }

    const handleReadMode = (e, noteId) => {
        e.stopPropagation()
        navigate(`/notes/${noteId}?view=read`)
        onClose()
    }

    const handleBacking = (e) => {
        if (isAdding) return
        if(e.target === e.currentTarget) onClose()
    }

    const saveTags = () => {
        if (tags === (notebook.tags || '')) return
        updateNotebookTags(notebook.id, tags)
    }

    const saveName = () => {
        const trimmed = name.trim()
        if (trimmed && trimmed !== notebook.name) {
            renameNotebook(notebook.id, trimmed)
        } else {
            setName(notebook.name)
        }
    }

    const handleNameKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.target.blur()
        }
    }

    const handleRemoveNote = (e, noteId) => {
        e.stopPropagation()
        removeNoteFromNotebook(notebook.id, noteId)
    }

    const togglePickerNote = (noteId) => {
        setSelectedNoteIds(prev =>
            prev.includes(noteId) ? prev.filter(id => id !== noteId) : [...prev, noteId]
        )
    }

    const handleAddNotes = async () => {
        if (selectedNoteIds.length === 0 || isAdding) return
        setIsAdding(true)
        try {
            await addNotesToNotebook(notebook.id, selectedNoteIds)
            setSelectedNoteIds([])
            setShowPicker(false)
        } finally {
            setIsAdding(false)
        }
    }

    const cancelPicker = () => {
        if (isAdding) return
        setSelectedNoteIds([])
        setShowPicker(false)
    }

    return (
        <div className={styles.backdrop} onClick={handleBacking}>
            <div className={styles.modal}>

                <div className={styles.header}>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onBlur={saveName}
                        onKeyDown={handleNameKeyDown}
                        className={styles.titleInput}
                    />
                    <button onClick={onClose} className={styles.closeBtn}>×</button>
                </div>

                <div className={styles.tagsSection}>
                    <label htmlFor="notebook-tags" className={styles.tagsLabel}>Tags</label>
                    <input
                        id="notebook-tags"
                        type="text"
                        value={tags}
                        onChange={(e) => setTags(e.target.value)}
                        onBlur={saveTags}
                        placeholder="Add tags (e.g., work, personal, archive...)"
                        className={styles.tagsInput}
                    />
                </div>

                <div className={styles.content}>
                    {loading ? (
                        <p className={styles.loading}>Loading notes....</p>
                    ) : (
                        <>
                            {notes.length === 0 && !showPicker && (
                                <p className={styles.empty}>No notes in this notebook yet</p>
                            )}

                            {notes.length > 0 && (
                                <div className={styles.noteList}>
                                    {notes.map( note => (
                                        <div key={note.id}
                                            className={styles.noteItem}
                                            onClick={() => handleNoteClick(note.id)}
                                        >
                                            <div className={styles.noteItemContent}>
                                                <h4>{note.title}</h4>
                                                {note.tags && <p className={styles.noteTags}>{note.tags}</p>}
                                            </div>
                                            <button
                                                className={styles.readModeBtn}
                                                onClick={(e) => handleReadMode(e, note.id)}
                                                title="Open in read mode"
                                            >
                                                <MdChromeReaderMode size={18} />
                                            </button>
                                            <button
                                                className={styles.removeNoteBtn}
                                                onClick={(e) => handleRemoveNote(e, note.id)}
                                                title="Remove from notebook"
                                            >
                                                <HiOutlineX size={16} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {!showPicker ? (
                                <div className={styles.addNoteCard} onClick={() => setShowPicker(true)}>
                                    <HiPlus size={18} />
                                    <span>Add notes</span>
                                </div>
                            ) : (
                                <>
                                    <div className={styles.pickerHeader}>
                                        <span className={styles.pickerTitle}>
                                            Select notes to add {selectedNoteIds.length > 0 && `(${selectedNoteIds.length})`}
                                        </span>
                                        <div className={styles.pickerActions}>
                                            <button
                                                onClick={cancelPicker}
                                                className={`${styles.pickerBtn} ${styles.cancelBtn}`}
                                                disabled={isAdding}
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                onClick={handleAddNotes}
                                                className={`${styles.pickerBtn} ${styles.confirmBtn}`}
                                                disabled={selectedNoteIds.length === 0 || isAdding}
                                                aria-busy={isAdding}
                                            >
                                                {isAdding ? (
                                                    <>
                                                        <span className={styles.btnSpinner} aria-hidden="true" />
                                                        Adding…
                                                    </>
                                                ) : 'Add'}
                                            </button>
                                        </div>
                                    </div>

                                    {availableNotes.length === 0 ? (
                                        <p className={styles.pickerEmpty}>No available notes to add</p>
                                    ) : (
                                        <div className={styles.pickerList}>
                                            {availableNotes.map(note => (
                                                <div
                                                    key={note.id}
                                                    className={`${styles.pickerItem} ${selectedNoteIds.includes(note.id) ? styles.selected : ''}`}
                                                    onClick={() => togglePickerNote(note.id)}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedNoteIds.includes(note.id)}
                                                        onChange={() => togglePickerNote(note.id)}
                                                        onClick={e => e.stopPropagation()}
                                                    />
                                                    <div className={styles.noteItemContent}>
                                                        <h4>{note.title}</h4>
                                                        {note.tags && <p className={styles.noteTags}>{note.tags}</p>}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </>
                            )}
                        </>
                    )}
                </div>

            </div>
        </div>
    )
}

export default NotebookModal
