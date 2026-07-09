import { useCallback, useEffect, useRef, useState } from 'react'
import { useApi } from '../contexts/ApiContext'

// Per-note comment threads (Google-Docs style), persisted to the sidecar
// `<note>.comments.json` via the notes/:id/comments endpoint. React owns the
// thread METADATA (text, replies, resolved, quote); the CM6 editor owns live
// anchor positions and feeds remapped offsets back through `applyRemap`.
//
// Thread shape:
//   { id, quote, prefix, suffix, from, to, resolved, orphaned, createdAt,
//     comments: [{ id, text, createdAt }] }   // comments[0] = initial, rest = replies

const uid = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `c-${Date.now()}-${Math.random().toString(36).slice(2)}`
const now = () => new Date().toISOString()

export function useComments(noteId) {
  const { authFetch, API } = useApi()
  const [threads, setThreads] = useState([])
  const [loading, setLoading] = useState(true)
  const saveTimer = useRef(null)
  const noteIdRef = useRef(noteId)
  useEffect(() => { noteIdRef.current = noteId }, [noteId])

  // Load on note change.
  useEffect(() => {
    let cancelled = false
    if (noteId == null) { setThreads([]); setLoading(false); return }
    setLoading(true)
    ;(async () => {
      try {
        const res = await authFetch(`${API}/notes/${noteId}/comments`)
        const data = res.ok ? await res.json() : { threads: [] }
        if (!cancelled) setThreads(Array.isArray(data.threads) ? data.threads : [])
      } catch { if (!cancelled) setThreads([]) }
      finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [noteId, authFetch, API])

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current) }, [])

  // Debounced write-through to the sidecar (also fires on every anchor remap, so
  // stored offsets track edits; short debounce coalesces typing bursts).
  const persist = useCallback((next) => {
    const id = noteIdRef.current
    if (id == null) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      authFetch(`${API}/notes/${id}/comments`, {
        method: 'PUT', body: JSON.stringify({ threads: next }),
      }).catch(() => { /* keep local copy; next change retries */ })
    }, 600)
  }, [authFetch, API])

  const commit = useCallback((updater) => {
    setThreads(prev => {
      const next = updater(prev)
      if (next === prev) return prev
      persist(next)
      return next
    })
  }, [persist])

  // anchor: { id, quote, prefix, suffix, from, to }
  const addThread = useCallback((anchor, text) => {
    const t = {
      id: anchor.id,
      quote: anchor.quote || '', prefix: anchor.prefix || '', suffix: anchor.suffix || '',
      from: anchor.from, to: anchor.to,
      resolved: false, orphaned: false, createdAt: now(),
      comments: [{ id: uid(), text: (text || '').trim(), createdAt: now() }],
    }
    commit(prev => [...prev, t])
  }, [commit])

  const addReply = useCallback((threadId, text) => {
    if (!text || !text.trim()) return
    commit(prev => prev.map(t => t.id === threadId
      ? { ...t, comments: [...t.comments, { id: uid(), text: text.trim(), createdAt: now() }] }
      : t))
  }, [commit])

  const editComment = useCallback((threadId, commentId, text) => {
    commit(prev => prev.map(t => t.id === threadId
      ? { ...t, comments: t.comments.map(c => c.id === commentId ? { ...c, text: text.trim() } : c) }
      : t))
  }, [commit])

  // Removing the last comment removes the whole thread (and its anchor).
  const deleteComment = useCallback((threadId, commentId) => {
    commit(prev => prev.flatMap(t => {
      if (t.id !== threadId) return [t]
      const comments = t.comments.filter(c => c.id !== commentId)
      return comments.length ? [{ ...t, comments }] : []
    }))
  }, [commit])

  const resolveThread = useCallback((threadId, resolved) => {
    commit(prev => prev.map(t => t.id === threadId ? { ...t, resolved: !!resolved } : t))
  }, [commit])

  const deleteThread = useCallback((threadId) => {
    commit(prev => prev.filter(t => t.id !== threadId))
  }, [commit])

  // Editor → React: new offsets/quote/orphan flags after doc edits. No-op (same
  // reference) when nothing changed, so it never churns state needlessly.
  const applyRemap = useCallback((remap) => {
    if (!remap || !remap.length) return
    const byId = new Map(remap.map(r => [r.id, r]))
    commit(prev => {
      let changed = false
      const next = prev.map(t => {
        const r = byId.get(t.id)
        if (!r) return t
        if (t.from === r.from && t.to === r.to && t.quote === r.quote && t.orphaned === !!r.orphaned) return t
        changed = true
        return { ...t, from: r.from, to: r.to, quote: r.quote ?? t.quote, prefix: r.prefix ?? t.prefix, suffix: r.suffix ?? t.suffix, orphaned: !!r.orphaned }
      })
      return changed ? next : prev
    })
  }, [commit])

  return {
    threads, loading,
    addThread, addReply, editComment, deleteComment, resolveThread, deleteThread, applyRemap,
  }
}
