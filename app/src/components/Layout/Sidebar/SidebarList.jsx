import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import styles from './SidebarList.module.css'
import { compareByOrder, compareByFavoriteThenOrder } from '../../../utils/noteSorting'
import { HiChevronDown } from 'react-icons/hi'
import { FaRegFolderOpen } from 'react-icons/fa'
import RowContextMenu from './RowContextMenu'
import { canReveal, revealNote, revealNotebook } from '../../../desktop/reveal'
import { useNoteSplit } from '../../../contexts/NoteSplitContext'
import { readCollapsedNotebooks, writeCollapsedNotebooks } from '../../../hooks/sidebarState'
import { coverTone, lipTone } from '../../Notebooks/notebookTones'
import { useDragReorder } from '../../../hooks/useDragReorder'
import { toast } from '../../../utils/toast'

// The zone key for "not in any notebook". Its own constant rather than the hub's
// UNFILED export, so the sidebar does not pull the notebook strip in behind it —
// the two never share a hit test (they carry different marker attributes).
const UNFILED_ZONE = '__sidebar_unfiled__'

// How long a collapsed notebook must be hovered mid-drag before it opens. Long
// enough that passing over one on the way somewhere else doesn't open it.
const HOVER_EXPAND_MS = 550


// hideTitle: drop the inner "List of Notes" heading when this list is rendered
// inside the NotesHub accordion, whose own header already labels it (avoids a
// redundant double label). The "No notes yet" empty state still shows.
function SidebarList({ isCollapsed, notes, notebooks = [], currentNoteID, hideTitle = false, addNotesToNotebook, removeNoteFromNotebook, reorderNotes }) {

    const split = useNoteSplit()
    // Notebook collapse state persists per Bag across remount + app restart.
    const [collapsedIds, setCollapsedIds] = useState(readCollapsedNotebooks)

    // Standard navigation handler.
    const handleSelect = (noteId) => (e) => {
        // We no longer intercept clicks for the right pane.
        // Sidebar always navigates the main app route.
    }

    // Right-click a row to reach the file behind it. Rows ARE drag sources now
    // (see the drag block below), but a context menu and a left-button drag never
    // race: useDragReorder only arms on `e.button === 0`.
    const [ctxMenu, setCtxMenu] = useState(null)   // { x, y, items } | null

    const openContextMenu = (items) => (e) => {
        if (!canReveal()) return
        e.preventDefault()      // rows are <Link>s; and we want ours, not the webview's
        e.stopPropagation()
        setCtxMenu({ x: e.clientX, y: e.clientY, items })
    }

    const revealItem = (label, run) => [{
        label,
        icon: <FaRegFolderOpen style={{ opacity: 0.7 }} />,
        onSelect: run,
    }]

    // Highlight both open notes: the route note (left) and the split note (right).
    const splitNoteId = split.splitTarget?.type === 'note' ? split.splitTarget.id : null
    const isActive = (noteId) => currentNoteID == noteId || splitNoteId == noteId

    const toggleNotebook = useCallback((rawId) => {
        const id = String(rawId) // stored as strings so legacy-int and uuid ids agree
        setCollapsedIds(prev => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            writeCollapsedNotebooks(next)
            return next
        })
    }, [])

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

    // ── Drag a note to file it, or to reorder it where it already lives ──────────
    // One gesture, told apart by WHERE the note is released rather than by how it
    // was picked up: released inside the group it already belongs to it is
    // reordered; released on a different notebook, or on the loose notes at the
    // bottom, it is re-filed. `ignoreZone` is what makes that possible — each
    // notebook wraps its own notes in its own drop zone, so without it every hit
    // test would find the zone the note already lives in and reordering inside a
    // notebook could never happen.
    const canDrag = Boolean(addNotesToNotebook && removeNoteFromNotebook && reorderNotes)

    const notebookIdSet = useMemo(() => new Set(notebooks.map(nb => String(nb.id))), [notebooks])

    // Which zone a note lives in right now: its notebook, or the loose notes.
    // Same "is it really filed" test the hub uses — a notebook_id pointing at a
    // notebook that no longer exists is not filed.
    const zoneOfNote = useCallback((noteId) => {
        const note = notes.find(n => String(n.id) === String(noteId))
        const nb = note?.notebook_id
        return nb != null && nb !== 'null' && notebookIdSet.has(String(nb)) ? String(nb) : UNFILED_ZONE
    }, [notes, notebookIdSet])

    // The drawn order, flattened: each notebook's notes as they appear, then the
    // loose ones. The hook reshuffles this flat list geometrically while dragging;
    // only the dragged note's own slice of it is ever committed (see below).
    const flatIds = useMemo(() => ([
        ...notebookGroups.flatMap(g => g.notes.map(n => n.id)),
        ...standaloneNotes.map(n => n.id),
    ]), [notebookGroups, standaloneNotes])

    const dragFromRef = useRef(null)   // the note this drag started on
    const listRef = useRef(null)       // the scroller, for edge-scrolling

    // `reorderNotes` renumbers whatever ids it is handed 0..n, and the hub numbers
    // each notebook — and the unfiled set — as its own 0..n. That is exactly why
    // the hub refuses to reorder its "Everything" view. The sidebar IS an
    // Everything view, so the commit is scoped to one group: hand it only that
    // group's ids and both views keep the same arrangement, which is the whole
    // reason reordering here is worth having.
    const commitReorder = useCallback((orderedIds) => {
        if (dragFromRef.current == null) return
        const zone = zoneOfNote(dragFromRef.current)
        const current = zone === UNFILED_ZONE
            ? standaloneNotes
            : (notebookGroups.find(g => String(g.notebook.id) === zone)?.notes ?? [])
        const members = new Set(current.map(n => String(n.id)))
        const scoped = orderedIds.filter(id => members.has(String(id)))
        // Unchanged is the common case — a drag that went nowhere, or one that
        // ended over open space. Skip it: a commit is one PUT per note in the group.
        if (scoped.length === current.length
            && scoped.every((id, i) => String(id) === String(current[i].id))) return
        reorderNotes(scoped)
    }, [zoneOfNote, standaloneNotes, notebookGroups, reorderNotes])

    // Filing. Mirrors NotesHub's fileNote on purpose: the API adds without
    // removing and a note has one notebook_id, so a move has to hand the old
    // notebook its count back explicitly or it keeps counting a note it lost.
    const fileNote = useCallback(async (noteId, key) => {
        const note = notes.find(n => String(n.id) === String(noteId))
        if (!note) return
        const from = zoneOfNote(noteId)
        if (from === key) return
        if (key === UNFILED_ZONE) {
            await removeNoteFromNotebook(note.notebook_id, note.id)
            toast.success('Taken out of its notebook')
            return
        }
        if (from !== UNFILED_ZONE) await removeNoteFromNotebook(note.notebook_id, note.id)
        await addNotesToNotebook(key, [note.id])
        const target = notebooks.find(nb => String(nb.id) === key)
        toast.success(`Filed in ${target?.name || 'notebook'}`)
    }, [notes, notebooks, zoneOfNote, addNotesToNotebook, removeNoteFromNotebook])

    const noteDrag = useDragReorder(flatIds, commitReorder, canDrag, 'sidebar-notes', {
        glue: true,
        dropSelector: '[data-sidebar-zone]',
        onDropZone: fileNote,
        ignoreZone: (key, draggedId) => key === zoneOfNote(draggedId),
        scrollContainer: listRef,
    })

    const hoverZone = noteDrag.hoverZone

    // Hover a collapsed notebook mid-drag and it opens, so you can see where the
    // note is going instead of filing into a closed box. It stays open after the
    // drop: you opened it to put something in it, and shutting it again would hide
    // the result. Expanding reflows the list, which a pointer-drag tolerates —
    // the hook re-hit-tests with elementFromPoint on every move.
    useEffect(() => {
        if (!hoverZone || hoverZone === UNFILED_ZONE) return
        if (!collapsedIds.has(String(hoverZone))) return
        const t = setTimeout(() => toggleNotebook(hoverZone), HOVER_EXPAND_MS)
        return () => clearTimeout(t)
    }, [hoverZone, collapsedIds, toggleNotebook])

    // Spread onto a row: the hook's own props, plus a note of where the drag began
    // (the hook does not report that, and the scoped commit needs it).
    const rowDragProps = (noteId) => {
        if (!canDrag) return {}
        const props = noteDrag.dragProps(noteId)
        return {
            ...props,
            onPointerDown: (e) => { dragFromRef.current = noteId; props.onPointerDown(e) },
        }
    }

    // Only a filed note can be unfiled, so the loose-notes area only advertises
    // itself as a target while one is in the air.
    const draggingFiled = noteDrag.activeId != null && zoneOfNote(noteDrag.activeId) !== UNFILED_ZONE
    const zoneClass = (key) => (hoverZone === key ? ' ' + styles.dropOn : '')

    if (isCollapsed) return null; // don't show list if collapsed

    return (
        <div className={styles.notesListContainer}>
            {!hideTitle && <p className={styles.listTitle}>List of Notes</p>}
            <div className={styles.notesList} ref={listRef}>
                {notes.length === 0 ? (
                    <p className={styles.emptyMessage}>No notes yet</p>
                ) : (
                    <>
                        {notebookGroups.map(group => {
                            const isCollapsed = collapsedIds.has(String(group.notebook.id))

                            return (
                            <div
                                key={group.notebook.id}
                                className={styles.notebookGroup + zoneClass(String(group.notebook.id))}
                                /* A drop target. `data-sidebar-zone` is the marker the
                                   hook's selector matches; `data-drop-zone` is the key it
                                   reads off it. Two attributes so the sidebar's zones and
                                   the hub's strip can never answer each other's hit test. */
                                data-sidebar-zone=""
                                data-drop-zone={String(group.notebook.id)}
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
                                    onContextMenu={openContextMenu(revealItem('Show notebook in file manager', () => revealNotebook(group.notebook)))}
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
                                                {...rowDragProps(note.id)}
                                                to={`/notes/${note.id}`}
                                                onClick={handleSelect(note.id)}
                                                onContextMenu={openContextMenu(revealItem('Show in file manager', () => revealNote(note)))}
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

                        {/* The loose notes are a zone of their own, so a note can be
                            dragged back out of a notebook. Rendered even when empty —
                            otherwise the one case that most needs the target (every note
                            filed) would have nothing to aim at. */}
                        <div
                            className={styles.looseNotes + zoneClass(UNFILED_ZONE)}
                            data-sidebar-zone=""
                            data-drop-zone={UNFILED_ZONE}
                        >
                            {standaloneNotes.map(note => (
                                <Link key={note.id}
                                    {...rowDragProps(note.id)}
                                    to={`/notes/${note.id}`}
                                    onClick={handleSelect(note.id)}
                                    onContextMenu={openContextMenu(revealItem('Show in file manager', () => revealNote(note)))}
                                    className={`${styles.noteItem} ${isActive(note.id) ? styles.active : ''}`}
                                >
                                    <span className={styles.noteTitle}>{note.title || 'Untitled'}</span>
                                </Link>
                            ))}
                            {draggingFiled && (
                                <div className={styles.unfileHint}>Drop here to take out</div>
                            )}
                        </div>
                    </>
                )}
            </div>

            {ctxMenu && (
                <RowContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items} onClose={() => setCtxMenu(null)} />
            )}
        </div>
    )
}

export default SidebarList