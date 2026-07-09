import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "../utils/toast";
import logger from "../utils/logger";
import {
    parseMarkdownFile,
    serializeNoteToMarkdown,
    slugifyForFilename,
    downloadMarkdown,
    readFileAsText,
    MAX_IMPORT_BYTES,
    IMPORTED_TAG,
} from "../utils/markdownIO";

// Custom hook for the notes/notebooks
export const useNotes = (authFetch, API, isAuthed) => {

    const [notes, setNotes] = useState([])
    const [notebooks, setNotebooks] = useState([])
    const [notesPagination, setNotesPagination] = useState(null)
    const [notebooksPagination, setNotebooksPagination] = useState(null)
    const [loadingMore, setLoadingMore] = useState(false)
    const [loading, setLoading] = useState(true)
    // Map of notebookId -> notes[], hydrated by parallel prefetch so opening a
    // notebook is instant. Swap the prefetch effect for `?include=notes` once
    // the batch endpoint exists on the backend.
    const [notebookNotesById, setNotebookNotesById] = useState({})
    const prefetchedNotebookIdsRef = useRef(new Set())


    // ----------- Fetch data ================================================================
    useEffect(() => {
        if(!isAuthed) {
            setLoading(false)
            return
        }

        const fetchData = async () => {
            setLoading(true)
            try {
                const notesResponse = await authFetch(`${API}/notes`)
                if(notesResponse.ok) {
                    const data = await notesResponse.json()
                    setNotes(data.notes)
                    setNotesPagination(data.pagination)
                }

                const ntbkResponse = await authFetch(`${API}/notebooks`)
                if(ntbkResponse.ok) {
                    const data = await ntbkResponse.json()
                    setNotebooks(data.notebooks)
                    setNotebooksPagination(data.pagination)
                }

            } catch (error) {
                logger.error(`Error fetching for data:`, error)
            } finally {
                setLoading(false)
            }
        }

        fetchData()

    }, [isAuthed, authFetch, API])

    // ----------- Prefetch notebook notes in ONE batched request ===========================
    // (was one GET /notebooks/:id/notes per notebook — an N+1 on every load.)
    useEffect(() => {
        if (!isAuthed || notebooks.length === 0) return

        const idsToFetch = notebooks
            .map(nb => nb.id)
            .filter(id => !prefetchedNotebookIdsRef.current.has(id))
        if (idsToFetch.length === 0) return

        idsToFetch.forEach(id => prefetchedNotebookIdsRef.current.add(id))

        let cancelled = false
        const prefetch = async () => {
            try {
                const res = await authFetch(`${API}/notebooks/notes-batch?ids=${idsToFetch.join(',')}`)
                if (!res.ok) throw new Error('Failed to prefetch notebook notes')
                const { notesByNotebook } = await res.json()
                if (cancelled) return
                setNotebookNotesById(prev => ({ ...prev, ...notesByNotebook }))
            } catch (error) {
                if (cancelled) return
                logger.error('Notebook prefetch failed:', error)
                // This set didn't load — un-mark so a later notebooks change can retry it.
                idsToFetch.forEach(id => prefetchedNotebookIdsRef.current.delete(id))
            }
        }
        prefetch()
        return () => { cancelled = true }
    }, [isAuthed, authFetch, API, notebooks])

    // Helper used by mutations to keep notebookNotesById in sync.
    const updateNoteInNotebookCache = useCallback((noteId, updater) => {
        setNotebookNotesById(prev => {
            let changed = false
            const next = {}
            for (const [nbId, list] of Object.entries(prev)) {
                const idx = list.findIndex(n => n.id === noteId)
                if (idx === -1) {
                    next[nbId] = list
                    continue
                }
                const updated = updater(list[idx])
                if (updated === null) {
                    next[nbId] = list.filter(n => n.id !== noteId)
                } else {
                    const copy = list.slice()
                    copy[idx] = updated
                    next[nbId] = copy
                }
                changed = true
            }
            return changed ? next : prev
        })
    }, [])

    // ----------- Load More Functions (Pagination) ==========================================
    const loadMoreNotes = useCallback(async () => {
        if (!notesPagination?.hasNextPage || loadingMore) return

        setLoadingMore(true)
        try {
            const response = await authFetch(
                `${API}/notes?cursor=${notesPagination.nextCursor}&limit=${notesPagination.limit}`
            )
            if(response.ok) {
                const data = await response.json()
                setNotes(prev => [...prev, ...data.notes]) // Append new notes to existing
                setNotesPagination(data.pagination) // Update pagination for next request
            }
        } catch (error) {
            logger.error('Error loading more notes:', error)
        } finally {
            setLoadingMore(false)
        }
    }, [authFetch, API, notesPagination, loadingMore])

    const loadMoreNotebooks = useCallback(async () => {
        if (!notebooksPagination?.hasNextPage || loadingMore) return

        setLoadingMore(true)
        try {
            const response = await authFetch(
                `${API}/notebooks?cursor=${notebooksPagination.nextCursor}&limit=${notebooksPagination.limit}`
            )
            if(response.ok) {
                const data = await response.json()
                setNotebooks(prev => [...prev, ...data.notebooks]) // Append new notebooks to existing
                setNotebooksPagination(data.pagination)
            }
        } catch (error) {
            logger.error('Error loading more notebooks:', error)
        } finally {
            setLoadingMore(false)
        }
    }, [authFetch, API, notebooksPagination, loadingMore])


    // ----------- Notes Operations like: Creating, deleting, etc. ===========================
    const addNote = useCallback(async (title = 'Untitled', onCreated, onSynced) => {
        const tempId = `temp-${(crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random()}`}`
        const now = new Date().toISOString()
        const optimisticNote = {
            id: tempId,
            title,
            body: '',
            is_favorite: false,
            color: null,
            tags: '',
            created_at: now,
            updated_at: now,
            _optimistic: true,
        }

        // Commit optimistic state immediately so the UI responds with no delay
        setNotes(currentNotes => [...currentNotes, optimisticNote])

        // Let caller act on the optimistic note (e.g. navigate to /notes/temp-...)
        if (onCreated) onCreated(optimisticNote)

        try {
            const res = await authFetch(`${API}/notes`, {
                method: "POST",
                body: JSON.stringify({ title, body: '' })
            })
            if(!res.ok) throw new Error(`Failed to add note`)

            const newNote = await res.json()
            // Swap temp note for the real one
            setNotes(currentNotes => currentNotes.map(n => n.id === tempId ? newNote : n))
            if (onSynced) onSynced(newNote, tempId)
            return newNote

        } catch (error) {
            logger.error(error)
            // Rollback: remove the optimistic note
            setNotes(currentNotes => currentNotes.filter(n => n.id !== tempId))
            toast.error('Failed to create note')
            return null
        }
    }, [authFetch, API])

    const deleteNote = useCallback(async (id) => {
        let removedNote = null
        const cacheSnapshot = {}

        setNotes(allNotes => {
            removedNote = allNotes.find(n => n.id === id) ?? null
            return allNotes.filter(note => note.id !== id)
        })

        setNotebookNotesById(prev => {
            const next = {}
            for (const [nbId, list] of Object.entries(prev)) {
                const filtered = list.filter(n => n.id !== id)
                if (filtered.length !== list.length) {
                    cacheSnapshot[nbId] = list
                }
                next[nbId] = filtered
            }
            return next
        })

        // Skip the network for an unsynced optimistic note
        if (typeof id === 'string' && id.startsWith('temp-')) return

        try {
            const res = await authFetch(`${API}/notes/${id}`, { method: "DELETE" })
            if(!res.ok) throw new Error(`Failed to delete note`)

        } catch (error) {
            logger.error(error)
            if (removedNote) {
                setNotes(allNotes => [...allNotes, removedNote])
            }
            if (Object.keys(cacheSnapshot).length > 0) {
                setNotebookNotesById(prev => ({ ...prev, ...cacheSnapshot }))
            }
            toast.error('Failed to delete note. Restored.')
        }
    }, [authFetch, API])

    const editTitle = useCallback(async (id, newTitle) => {
        // For this, we'll go the optimistic way: The notes will always be updated so just set the frontend side to already have the updated title. In the background we'll do the api call to actually update

        setNotes(allNotes => allNotes.map( note => note.id === id ? {...note, title: newTitle} : note))
        updateNoteInNotebookCache(id, (note) => ({ ...note, title: newTitle }))

        try {
            await authFetch(`${API}/notes/${id}`, {
                method: "PUT",
                body: JSON.stringify({ title: newTitle })
            })
        } catch (error) {
            logger.error(error)
        }
    }, [authFetch, API, updateNoteInNotebookCache])

    const editBody = useCallback(async (id, newBody) => {
        // Not optimistic here kay i think it's better because the body is quite big
        // Retries with exponential backoff to handle Render cold starts

        const MAX_RETRIES = 3;
        const BACKOFF = [1000, 2000, 4000]; // ms

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                const res = await authFetch(`${API}/notes/${id}`, {
                    method: "PUT",
                    body: JSON.stringify({ body: newBody })
                })
                if(!res.ok) throw new Error("Failed to update body/description/contents");
                const data = await res.json()
                // Shallow-merge: preserve notebook_id when the server omits it
                // (PUT /notes/:id doesn't echo it), otherwise the sidebar's
                // notebook grouping drifts on every autosave. ?? lets a
                // server-provided notebook_id still win.
                setNotes(allNotes => allNotes.map(note =>
                    note.id === id
                        ? { ...note, ...data, notebook_id: data.notebook_id ?? note.notebook_id }
                        : note
                ))
                updateNoteInNotebookCache(id, (prev) => ({
                    ...prev,
                    ...data,
                    notebook_id: data.notebook_id ?? prev.notebook_id,
                }))
                return true

            } catch (error) {
                logger.error(error)
                if (attempt < MAX_RETRIES - 1) {
                    await new Promise(r => setTimeout(r, BACKOFF[attempt]));
                }
            }
        }

        logger.error('Failed to save note body after retries')
        return false
    }, [authFetch, API, updateNoteInNotebookCache])

    const toggleFavorite = useCallback(async (id) => {
        // Get current state before update
        setNotes(prevNotes => {
            const note = prevNotes.find(n => n.id === id)
            const newFavoriteState = !note.is_favorite

            // Optimistic update
            const updatedNotes = prevNotes.map(n =>
                n.id === id ? {...n, is_favorite: newFavoriteState} : n
            )

            updateNoteInNotebookCache(id, (n) => ({ ...n, is_favorite: newFavoriteState }))

            // Make API call
            authFetch(`${API}/notes/${id}`, {
                method: "PUT",
                body: JSON.stringify({ is_favorite: newFavoriteState })
            }).catch(error => {
                logger.error(error)
                // Revert on error
                setNotes(prevNotes => prevNotes.map(n =>
                    n.id === id ? {...n, is_favorite: !newFavoriteState} : n
                ))
                updateNoteInNotebookCache(id, (n) => ({ ...n, is_favorite: !newFavoriteState }))
            })

            return updatedNotes
        })
    }, [authFetch, API, updateNoteInNotebookCache])

    const updateColor = useCallback(async (id, color) => {
        // Optimistic update
        setNotes(allNotes => allNotes.map( note =>
            note.id === id ? {...note, color} : note
        ))
        updateNoteInNotebookCache(id, (note) => ({ ...note, color }))

        try {
            await authFetch(`${API}/notes/${id}`, {
                method: "PUT",
                body: JSON.stringify({ color })
            })
        } catch (error) {
            logger.error(error)
        }
    }, [authFetch, API, updateNoteInNotebookCache])

    const updateTags = useCallback(async (id, tags) => {
        // Optimistic update
        setNotes(allNotes => allNotes.map( note =>
            note.id === id ? {...note, tags} : note
        ))
        updateNoteInNotebookCache(id, (note) => ({ ...note, tags }))

        try {
            await authFetch(`${API}/notes/${id}`, {
                method: "PUT",
                body: JSON.stringify({ tags })
            })
        } catch (error) {
            logger.error(error)
        }
    }, [authFetch, API, updateNoteInNotebookCache])


    // ----------- Notebook Operations like: Creating, deleting, etc. ===========================
    const createNotebook = useCallback(async (name, noteIds, tags) => {
        try {
            // create notebook
            const res = await authFetch(`${API}/notebooks`, {
                method: "POST",
                body: JSON.stringify({ name, noteIds, tags })
            })
            if(!res.ok) throw new Error("Failed to create notebook");

            // get the newly created notebook and the updated list of notes
            const { notebook, updatedNotes } = await res.json()

            // update notes to be the newly updated list
            setNotes(currentNotes => currentNotes.map( note => {
                const updatedVersion = updatedNotes.find(currNote => currNote.id === note.id)
                return updatedVersion || note
            }))

            // add notebook
            setNotebooks(currNotebooks => [notebook, ...currNotebooks])

            // Seed cache for the new notebook so its modal opens instantly.
            const seedNotes = updatedNotes.filter(n => n.notebook_id === notebook.id)
            setNotebookNotesById(prev => ({ ...prev, [notebook.id]: seedNotes }))
            prefetchedNotebookIdsRef.current.add(notebook.id)

            toast.success("Notebook created successfully")

        } catch (error) {
            logger.error(error)
        }
    }, [authFetch, API])

    const deleteNotebook = useCallback(async (id) => {
        try {
            const res = await authFetch(`${API}/notebooks/${id}`, { method: "DELETE" })
            if(!res.ok) throw new Error("Failed to delete notebook");

            setNotebooks(currentNotebooks => currentNotebooks.filter(note => note.id !== id))
            setNotebookNotesById(prev => {
                if (!(id in prev)) return prev
                const next = { ...prev }
                delete next[id]
                return next
            })
            prefetchedNotebookIdsRef.current.delete(id)

            // The notebook's notes were ON DELETE SET NULL'd server-side, so they're now lone notes.
            // Clear notebook_id locally so they show in the lists — no need to refetch all of /notes.
            // (The old refetch also stored the wrong shape: /notes returns {notes, pagination}, not an array.)
            setNotes(prev => prev.map(n => n.notebook_id === id ? { ...n, notebook_id: null } : n))

        } catch (error) {
            logger.error(error)
        }
    }, [authFetch, API])

    const toggleFavoriteNotebook = useCallback(async (id) => {
        setNotebooks(prevNotebooks => {
            const notebook = prevNotebooks.find(n => n.id === id)
            const newFavoriteState = !notebook.is_favorite

            const updatedNotebooks = prevNotebooks.map(n =>
                n.id === id ? {...n, is_favorite: newFavoriteState} : n
            )

            authFetch(`${API}/notebooks/${id}`, {
                method: "PUT",
                body: JSON.stringify({ is_favorite: newFavoriteState })
            }).catch(error => {
                logger.error(error)
                setNotebooks(prevNotebooks => prevNotebooks.map(n =>
                    n.id === id ? {...n, is_favorite: !newFavoriteState} : n
                ))
            })

            return updatedNotebooks
        })
    }, [authFetch, API])

    const updateNotebookColor = useCallback(async (id, color) => {
        setNotebooks(allNotebooks => allNotebooks.map( notebook =>
            notebook.id === id ? {...notebook, color} : notebook
        ))

        try {
            await authFetch(`${API}/notebooks/${id}`, {
                method: "PUT",
                body: JSON.stringify({ color })
            })
        } catch (error) {
            logger.error(error)
        }
    }, [authFetch, API])

    const updateNotebookTags = useCallback(async (id, tags) => {
        setNotebooks(allNotebooks => allNotebooks.map( notebook =>
            notebook.id === id ? {...notebook, tags} : notebook
        ))

        try {
            await authFetch(`${API}/notebooks/${id}`, {
                method: "PUT",
                body: JSON.stringify({ tags })
            })
        } catch (error) {
            logger.error(error)
        }
    }, [authFetch, API])

    const renameNotebook = useCallback(async (id, name) => {
        setNotebooks(allNotebooks => allNotebooks.map( notebook =>
            notebook.id === id ? {...notebook, name} : notebook
        ))

        try {
            await authFetch(`${API}/notebooks/${id}`, {
                method: "PUT",
                body: JSON.stringify({ name })
            })
        } catch (error) {
            logger.error(error)
        }
    }, [authFetch, API])

    const removeNoteFromNotebook = useCallback(async (notebookId, noteId) => {
        try {
            const res = await authFetch(`${API}/notebooks/${notebookId}/notes/${noteId}`, {
                method: "DELETE"
            })
            if (!res.ok) throw new Error("Failed to remove note from notebook")

            // Update the note locally to remove its notebook_id
            setNotes(allNotes => allNotes.map(note =>
                note.id === noteId ? {...note, notebook_id: null} : note
            ))

            // Update the notebook's note_count
            setNotebooks(allNotebooks => allNotebooks.map(notebook =>
                notebook.id === notebookId ? {...notebook, note_count: Math.max(0, (notebook.note_count || 0) - 1)} : notebook
            ))

            // Drop from cached notebook notes
            setNotebookNotesById(prev => {
                const list = prev[notebookId]
                if (!list) return prev
                return { ...prev, [notebookId]: list.filter(n => n.id !== noteId) }
            })

        } catch (error) {
            logger.error(error)
        }
    }, [authFetch, API])


    const addNotesToNotebook = useCallback(async (notebookId, noteIds) => {
        try {
            const res = await authFetch(`${API}/notebooks/${notebookId}/notes`, {
                method: "POST",
                body: JSON.stringify({ noteIds })
            })
            if (!res.ok) throw new Error("Failed to add notes to notebook")

            const { updatedNotes } = await res.json()

            setNotes(allNotes => allNotes.map(note => {
                const updated = updatedNotes.find(n => n.id === note.id)
                return updated || note
            }))

            setNotebooks(allNotebooks => allNotebooks.map(notebook =>
                notebook.id === notebookId
                    ? { ...notebook, note_count: (notebook.note_count || 0) + updatedNotes.length }
                    : notebook
            ))

            // Append to cached notebook notes
            setNotebookNotesById(prev => {
                const existing = prev[notebookId] || []
                const existingIds = new Set(existing.map(n => n.id))
                const merged = [...existing, ...updatedNotes.filter(n => !existingIds.has(n.id))]
                return { ...prev, [notebookId]: merged }
            })

            return updatedNotes
        } catch (error) {
            logger.error(error)
            return []
        }
    }, [authFetch, API])


    const importMarkdownFiles = useCallback(async (files, notebookName) => {
        const fileList = Array.from(files || [])
        if (fileList.length === 0) return { noteIds: [], notebookId: null, warnings: [] }

        const valid = []
        let rejected = 0
        for (const f of fileList) {
            const isMd = /\.md$/i.test(f.name) || f.type === 'text/markdown'
            if (!isMd || f.size > MAX_IMPORT_BYTES) {
                rejected++
                continue
            }
            valid.push(f)
        }
        if (rejected > 0) {
            toast.warning(`Skipped ${rejected} file${rejected === 1 ? '' : 's'} (must be .md and ≤ 1MB)`)
        }
        if (valid.length === 0) return { noteIds: [], notebookId: null, warnings: [] }

        const allWarnings = new Set()
        const newNoteIds = []
        let failed = 0

        for (const file of valid) {
            try {
                const text = await readFileAsText(file)
                const parsed = parseMarkdownFile(text, file.name)
                parsed.warnings.forEach(w => allWarnings.add(w))

                const created = await addNote(parsed.title || 'Untitled')
                if (!created) { failed++; continue }

                if (parsed.body) await editBody(created.id, parsed.body)
                if (parsed.tags) await updateTags(created.id, parsed.tags)
                if (parsed.color) await updateColor(created.id, parsed.color)
                if (parsed.isFavorite && !created.is_favorite) await toggleFavorite(created.id)

                newNoteIds.push(created.id)
            } catch (err) {
                logger.error('Import failed for file:', file.name, err)
                failed++
            }
        }

        let notebookId = null
        if (newNoteIds.length > 1 && notebookName) {
            await createNotebook(notebookName, newNoteIds, IMPORTED_TAG)
        }

        if (newNoteIds.length > 0) {
            toast.success(`Imported ${newNoteIds.length} note${newNoteIds.length === 1 ? '' : 's'}`)
        }
        if (failed > 0) {
            toast.error(`${failed} file${failed === 1 ? '' : 's'} failed to import`)
        }
        if (allWarnings.size > 0) {
            toast.warning(Array.from(allWarnings).join(' • '))
        }

        return { noteIds: newNoteIds, notebookId, warnings: Array.from(allWarnings) }
    }, [addNote, editBody, updateTags, updateColor, toggleFavorite, createNotebook])

    const exportNote = useCallback((noteId) => {
        const note = notes.find(n => n.id === noteId)
        if (!note) {
            toast.error('Note not found')
            return
        }
        const contents = serializeNoteToMarkdown(note)
        const filename = `${slugifyForFilename(note.title)}.md`
        downloadMarkdown(filename, contents)
        toast.success(`Exported "${note.title || 'Untitled'}"`)
    }, [notes])

    // Manual drag-sort. `orderedIds` is the group's new full order; we stamp each
    // with its index as `order` (optimistically + persisted) so compareByOrder
    // reproduces the arrangement everywhere (NotesHub + sidebar).
    const reorderNotes = useCallback((orderedIds) => {
        const pos = new Map(orderedIds.map((id, i) => [String(id), i]))
        setNotes(prev => prev.map(n => pos.has(String(n.id)) ? { ...n, order: pos.get(String(n.id)) } : n))
        orderedIds.forEach((id, i) => {
            updateNoteInNotebookCache(id, (n) => ({ ...n, order: i }))
            authFetch(`${API}/notes/${id}`, { method: 'PUT', body: JSON.stringify({ order: i }) }).catch(err => logger.error(err))
        })
    }, [authFetch, API, updateNoteInNotebookCache])

    const reorderNotebooks = useCallback((orderedIds) => {
        const pos = new Map(orderedIds.map((id, i) => [String(id), i]))
        setNotebooks(prev => prev.map(nb => pos.has(String(nb.id)) ? { ...nb, order: pos.get(String(nb.id)) } : nb))
        orderedIds.forEach((id, i) => {
            authFetch(`${API}/notebooks/${id}`, { method: 'PUT', body: JSON.stringify({ order: i }) }).catch(err => logger.error(err))
        })
    }, [authFetch, API])


    return {
        notes,
        notebooks,
        loading,
        notebookNotesById,
        notesPagination,
        notebooksPagination,
        loadMoreNotes,
        loadMoreNotebooks,
        loadingMore,
        addNote,
        deleteNote,
        editTitle,
        editBody,
        toggleFavorite,
        updateColor,
        updateTags,
        createNotebook,
        deleteNotebook,
        toggleFavoriteNotebook,
        updateNotebookColor,
        updateNotebookTags,
        renameNotebook,
        removeNoteFromNotebook,
        addNotesToNotebook,
        importMarkdownFiles,
        exportNote,
        reorderNotes,
        reorderNotebooks
    }
}