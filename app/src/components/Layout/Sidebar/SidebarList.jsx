import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import styles from './SidebarList.module.css'
import { compareByOrder, compareByFavoriteThenOrder } from '../../../utils/noteSorting'
import { HiChevronDown } from 'react-icons/hi'
import { useNoteSplit } from '../../../contexts/NoteSplitContext'
import { readCollapsedNotebooks, writeCollapsedNotebooks } from '../../../hooks/sidebarState'
import { coverTone, lipTone } from '../../Notebooks/notebookTones'


// hideTitle: drop the inner "List of Notes" heading when this list is rendered
// inside the NotesHub accordion, whose own header already labels it (avoids a
// redundant double label). The "No notes yet" empty state still shows.
function SidebarList({ isCollapsed, notes, notebooks = [], currentNoteID, hideTitle = false }) {

    const split = useNoteSplit()
    // Notebook collapse state persists per Bag across remount + app restart.
    const [collapsedIds, setCollapsedIds] = useState(readCollapsedNotebooks)

    // Standard navigation handler.
    const handleSelect = (noteId) => (e) => {
        // We no longer intercept clicks for the right pane.
        // Sidebar always navigates the main app route.
    }

    // Highlight both open notes: the route note (left) and the split note (right).
    const splitNoteId = split.splitTarget?.type === 'note' ? split.splitTarget.id : null
    const isActive = (noteId) => currentNoteID == noteId || splitNoteId == noteId

    const toggleNotebook = (rawId) => {
        const id = String(rawId) // stored as strings so legacy-int and uuid ids agree
        setCollapsedIds(prev => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            writeCollapsedNotebooks(next)
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
            .sort((a, b) => compareByOrder(a.notebook, b.notebook))
            .map(group => ({
                ...group,
                notes: group.notes.slice().sort(compareByFavoriteThenOrder)
            }))

        return {
            notebookGroups,
            standaloneNotes: standalone.slice().sort(compareByFavoriteThenOrder)
        }
    }, [notes, notebooks])

    if (isCollapsed) return null; // don't show list if collapsed

    return (
        <div className={styles.notesListContainer}>
            {!hideTitle && <p className={styles.listTitle}>List of Notes</p>}
            <div className={styles.notesList}>
                {notes.length === 0 ? (
                    <p className={styles.emptyMessage}>No notes yet</p>
                ) : (
                    <>
                        {notebookGroups.map(group => {
                            const isCollapsed = collapsedIds.has(String(group.notebook.id))

                            return (
                            <div
                                key={group.notebook.id}
                                className={styles.notebookGroup}
                                /* The same two strengths the notebook strip uses, so a
                                   notebook is the same colour wherever you meet it. */
                                style={{
                                    '--nb-cover': coverTone(group.notebook.color),
                                    '--nb-lip': lipTone(group.notebook.color),
                                }}
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