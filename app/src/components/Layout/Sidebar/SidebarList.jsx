import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import styles from './SidebarList.module.css'
import { compareByFavorite } from '../../../utils/noteSorting'
import { HiChevronDown } from 'react-icons/hi'
import { useNoteSplit } from '../../../contexts/NoteSplitContext'


function SidebarList({ isCollapsed, notes, notebooks = [], currentNoteID }) {

    const split = useNoteSplit()
    const [collapsedIds, setCollapsedIds] = useState(() => new Set())

    // In split view, a click targets the focused pane. When the right pane is
    // focused we replace its note in place (no route change) instead of
    // navigating — but never duplicate the left note (shared draft / save key).
    const handleSelect = (noteId) => (e) => {
        if (split.enabled && split.focusedSide === 'right') {
            e.preventDefault()
            if (noteId == currentNoteID) return // can't show the same note on both sides (loose: route id is a string)
            split.setSplitNoteId(noteId)
        }
    }

    // Highlight both open notes: the route note (left) and the split note (right).
    const isActive = (noteId) => currentNoteID == noteId || split.splitNoteId == noteId

    const toggleNotebook = (id) => {
        setCollapsedIds(prev => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    const { notebookGroups, standaloneNotes } = useMemo(() => {
        const notebookById = new Map(notebooks.map(notebook => [notebook.id, notebook]))
        const grouped = new Map()
        const standalone = []

        notes.forEach(note => {
            const notebook = notebookById.get(note.notebook_id)
            if (notebook) {
                if (!grouped.has(notebook.id)) {
                    grouped.set(notebook.id, { notebook, notes: [] })
                }
                grouped.get(notebook.id).notes.push(note)
                return
            }
            standalone.push(note)
        })

        const notebookGroups = Array.from(grouped.values())
            .sort((a, b) => compareByFavorite(a.notebook, b.notebook))
            .map(group => ({
                ...group,
                notes: group.notes.slice().sort(compareByFavorite)
            }))

        return {
            notebookGroups,
            standaloneNotes: standalone.slice().sort(compareByFavorite)
        }
    }, [notes, notebooks])

    if (isCollapsed) return null; // don't show list if collapsed

    return (
        <div className={styles.notesListContainer}>
            <p className={styles.listTitle}>List of Notes</p>
            <div className={styles.notesList}>
                {notes.length === 0 ? (
                    <p className={styles.emptyMessage}>No notes yet</p>
                ) : (
                    <>
                        {notebookGroups.map(group => {
                            const isCollapsed = collapsedIds.has(group.notebook.id)

                            return (
                            <div
                                key={group.notebook.id}
                                className={styles.notebookGroup}
                                style={{ '--notebook-color': group.notebook.color || '#4a9eff' }}
                            >
                                <div
                                    className={styles.notebookHeader}
                                    onClick={() => toggleNotebook(group.notebook.id)}
                                >
                                    <span className={styles.notebookLabel}>
                                        {group.notebook.name || 'Untitled Notebook'}
                                    </span>
                                    <HiChevronDown
                                        className={`${styles.chevron} ${isCollapsed ? styles.chevronCollapsed : ''}`}
                                    />
                                </div>
                                {!isCollapsed && (
                                    <div className={styles.notebookNotes}>
                                        {group.notes.map(note => (
                                            <Link
                                                key={note.id}
                                                to={`/notes/${note.id}`}
                                                onClick={handleSelect(note.id)}
                                                className={`${styles.noteItem} ${styles.groupedNote} ${isActive(note.id) ? styles.active : ''}`}
                                            >
                                                <span className={styles.noteTitle}>{note.title || 'Untitled'}</span>
                                            </Link>
                                        ))}
                                    </div>
                                )}
                            </div>
                            )
                        })}

                        {standaloneNotes.map(note => (
                            <Link key={note.id}
                                to={`/notes/${note.id}`}
                                onClick={handleSelect(note.id)}
                                className={`${styles.noteItem} ${isActive(note.id) ? styles.active : ''}`}
                            >
                                <span className={styles.noteTitle}>{note.title || 'Untitled'}</span>
                            </Link>
                        ))}
                    </>
                )}
            </div>
        </div>
    )
}

export default SidebarList