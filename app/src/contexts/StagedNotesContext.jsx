import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useNoteTabs } from './NoteTabsContext'
import { parseMarkdownFile } from '../utils/markdownIO'
import { toast } from '../utils/toast'
import { StagedNotesContext, STAGED_PREFIX } from './stagedNotes'

// A .md opened from the file manager (src-tauri/src/opened.rs) is STAGED: it opens
// in a tab like any note and edits save straight back to the file where it lives,
// but it is not in the Bag. "Add to Bag" copies it in through the normal markdown
// import; closing its tab forgets it, leaving the file untouched on disk.
//
// Staged notes live only here, never in the notes list, so the hub, the sidebar's
// note list, search and wikilinks never see them. The few surfaces that show open
// tabs merge them in with `withStaged`.

const invoke = (cmd, args) => {
  const inv = window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke
  return inv ? inv(cmd, args) : Promise.reject(new Error('not in the desktop shell'))
}

const fileName = (path) => path.split('/').pop() || 'Untitled.md'
// parseMarkdownFile strips only `.md` when it falls back to the file name.
const importName = (path) => fileName(path).replace(/\.markdown$/i, '.md')

export function StagedNotesProvider({ ready, importMarkdownFiles, children }) {
  const navigate = useNavigate()
  const { openTabs, replaceTab } = useNoteTabs()
  const [staged, setStaged] = useState([])
  const stagedRef = useRef(staged)
  useEffect(() => { stagedRef.current = staged }, [staged])
  const nextId = useRef(1)
  // Unique per launch, so a staged id can never match one left over anywhere from
  // an earlier run (an old route, an old tab) and be mistaken for it.
  const runTag = useRef(Date.now().toString(36))

  // Pick up files the shell is holding. Only once a Bag is open: a file passed at
  // launch waits in Rust behind the Bag picker, and is taken here when it closes.
  const takeOpened = useCallback(async () => {
    let paths = []
    try { paths = await invoke('opened_files_take') } catch { return }
    let last = null
    for (const path of paths) {
      const already = stagedRef.current.find((n) => n.path === path)
      if (already) { last = already.id; continue }
      try {
        const body = await invoke('opened_read', { path })
        const note = {
          id: `${STAGED_PREFIX}${runTag.current}-${nextId.current++}`,
          title: parseMarkdownFile(body, importName(path)).title,
          body,
          tags: '',
          color: null,
          is_favorite: false,
          staged: true,
          path,
        }
        stagedRef.current = [...stagedRef.current, note]
        setStaged(stagedRef.current)
        last = note.id
      } catch (e) {
        toast.error(`Couldn't open ${fileName(path)}: ${e}`)
      }
    }
    if (last) navigate(`/notes/${last}`)
  }, [navigate])

  useEffect(() => {
    if (!ready || !window.__TAURI__) return
    takeOpened()
    let unlisten = null
    let gone = false
    window.__TAURI__.event?.listen?.('siddran:open-files', () => takeOpened())
      .then((u) => { if (gone) u(); else unlisten = u })
    return () => { gone = true; unlisten?.() }
  }, [ready, takeOpened])

  // Closing the tab is what discards a staged note. A note only counts as closed
  // once its tab has existed — the tab is added a render after we navigate to it.
  const seenInTabs = useRef(new Set())
  useEffect(() => {
    const open = new Set(openTabs)
    const closed = []
    for (const n of staged) {
      if (open.has(n.id)) seenInTabs.current.add(n.id)
      else if (seenInTabs.current.has(n.id)) closed.push(n.id)
    }
    if (closed.length) {
      closed.forEach((id) => seenInTabs.current.delete(id))
      setStaged((prev) => prev.filter((n) => !closed.includes(n.id)))
    }
  }, [openTabs, staged])

  // Saves go to the original file. The body in state follows along so the editor's
  // external-change merge sees its own text come back, not a stale copy.
  const editBody = useCallback(async (id, body) => {
    const note = stagedRef.current.find((n) => n.id === String(id))
    if (!note) return false
    try {
      await invoke('opened_write', { path: note.path, contents: body })
    } catch (e) {
      toast.error(`Couldn't save ${fileName(note.path)}: ${e}`)
      return false
    }
    setStaged((prev) => prev.map((n) => (n.id === note.id ? { ...n, body } : n)))
    return true
  }, [])

  // Copy into the Bag through the same import as the hub's "Import .md" (minus its
  // "Imported" tag: this file was brought in on purpose), then swap
  // the staged tab for the new note in place. `body` is the editor's live text, so
  // an edit still inside the save debounce is not left behind.
  const addToBag = useCallback(async (id, body) => {
    const note = stagedRef.current.find((n) => n.id === String(id))
    if (!note) return
    const text = body ?? note.body
    const file = new File([text], importName(note.path), { type: 'text/markdown' })
    const { noteIds } = await importMarkdownFiles([file], null, { tagImported: false })
    const newId = noteIds?.[0]
    if (newId == null) return
    // The file on disk keeps what was typed even if this save was still pending.
    if (text !== note.body) editBody(note.id, text)
    seenInTabs.current.delete(note.id)
    setStaged((prev) => prev.filter((n) => n.id !== note.id))
    replaceTab(note.id, newId)
  }, [importMarkdownFiles, editBody, replaceTab])

  const withStaged = useCallback(
    (notes) => (staged.length ? [...(notes || []), ...staged] : notes),
    [staged],
  )

  const value = useMemo(
    () => ({ staged, withStaged, editBody, addToBag }),
    [staged, withStaged, editBody, addToBag],
  )
  return <StagedNotesContext.Provider value={value}>{children}</StagedNotesContext.Provider>
}
