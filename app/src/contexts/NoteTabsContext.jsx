import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { getBagPath } from '../desktop/localStore'

// Obsidian-style note tabs. The ROUTE stays the source of truth for the active
// tab: this provider just watches `/notes/:id` and keeps an ordered list of the
// notes you've opened, so it needs no changes at the open-note call sites (every
// note-open already navigates to /notes/:id). Persisted per-Bag.
const NoteTabsContext = createContext(null)

const matchNoteId = (pathname) => {
  const m = /^\/notes\/([^/]+)/.exec(pathname || '')
  return m ? m[1] : null
}
const storageKey = () => `siddran_tabs:${getBagPath() || 'default'}`

export function NoteTabsProvider({ children }) {
  const location = useLocation()
  const navigate = useNavigate()
  const activeId = matchNoteId(location.pathname) // string | null

  const [openTabs, setOpenTabs] = useState(() => {
    try {
      const a = JSON.parse(localStorage.getItem(storageKey()) || '[]')
      return Array.isArray(a) ? a.map(String) : []
    } catch { return [] }
  })

  useEffect(() => {
    try { localStorage.setItem(storageKey(), JSON.stringify(openTabs)) } catch { /* */ }
  }, [openTabs])

  // Landing on a note auto-opens (or keeps) its tab.
  useEffect(() => {
    if (activeId == null) return
    setOpenTabs(prev => (prev.includes(activeId) ? prev : [...prev, activeId]))
  }, [activeId])

  const activateTab = useCallback((id) => navigate(`/notes/${id}`), [navigate])

  const closeTab = useCallback((id) => {
    id = String(id)
    const idx = openTabs.indexOf(id)
    if (idx === -1) return
    const next = openTabs.filter(t => t !== id)
    setOpenTabs(next)
    if (id === activeId) {
      const fallback = next[idx] || next[idx - 1] // right neighbor, else left
      navigate(fallback ? `/notes/${fallback}` : '/notes')
    }
  }, [openTabs, activeId, navigate])

  const cycleTab = useCallback((dir) => {
    if (openTabs.length < 2 || activeId == null) return
    const i = openTabs.indexOf(activeId)
    if (i === -1) return
    navigate(`/notes/${openTabs[(i + dir + openTabs.length) % openTabs.length]}`)
  }, [openTabs, activeId, navigate])

  // Ctrl/Cmd+Tab cycles, +Shift reverses; Ctrl/Cmd+W closes the active tab.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Tab') {
        e.preventDefault()
        cycleTab(e.shiftKey ? -1 : 1)
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'w' || e.key === 'W')) {
        if (activeId != null) { e.preventDefault(); closeTab(activeId) }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cycleTab, closeTab, activeId])

  const value = useMemo(
    () => ({ openTabs, activeId, activateTab, closeTab, cycleTab }),
    [openTabs, activeId, activateTab, closeTab, cycleTab],
  )
  return <NoteTabsContext.Provider value={value}>{children}</NoteTabsContext.Provider>
}

export function useNoteTabs() {
  const ctx = useContext(NoteTabsContext)
  if (!ctx) throw new Error('useNoteTabs must be used within <NoteTabsProvider>')
  return ctx
}
