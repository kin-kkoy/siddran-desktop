import { useEffect, useRef, useState } from 'react'
import { LuSearch, LuX, LuArrowUp, LuArrowDown } from 'react-icons/lu'
import styles from './NoteSearch.module.css'

// Per-note find bar. Searches only THIS note (in split view, the focused pane owns
// it) via the imperative `searchRef` exposed by CodeMirrorEditor — which highlights
// all matches on the current surface (edit or read) and scrolls to a clicked one.
export default function NoteSearch({ searchRef, viewMode, focusToken, onClose }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [activeId, setActiveId] = useState(-1)
  const inputRef = useRef(null)
  const timerRef = useRef(null)

  // Focus the input on open and whenever Ctrl+F is pressed again (token bump).
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusToken])

  const run = (q) => {
    if (!q) { searchRef.current?.clear(); setResults([]); setActiveId(-1); return }
    setResults(searchRef.current?.run(q, viewMode) || [])
    setActiveId(-1)
  }

  // Debounced re-search as you type.
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => run(query), 150)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  // Read/edit toggled → the highlights now live on the other surface; re-run.
  useEffect(() => { run(query) // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode])

  // Clear highlights when the bar closes/unmounts.
  useEffect(() => () => { searchRef.current?.clear() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const goto = (id) => {
    if (id < 0 || id >= results.length) return
    setActiveId(id)
    searchRef.current?.goto(id, viewMode)
  }
  const step = (dir) => {
    if (!results.length) return
    const next = activeId < 0
      ? (dir > 0 ? 0 : results.length - 1)
      : (activeId + dir + results.length) % results.length
    goto(next)
  }
  const onKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1) }
    else if (e.key === 'Escape') { e.preventDefault(); onClose() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); step(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1) }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.bar}>
        <LuSearch className={styles.searchIcon} size={15} />
        <input
          ref={inputRef}
          className={styles.input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search this note…"
          spellCheck={false}
        />
        {query && <span className={styles.count}>{results.length >= 300 ? '300+' : results.length}</span>}
        <button className={styles.iconBtn} onClick={() => step(-1)} title="Previous (Shift+Enter)" disabled={!results.length}><LuArrowUp size={15} /></button>
        <button className={styles.iconBtn} onClick={() => step(1)} title="Next (Enter)" disabled={!results.length}><LuArrowDown size={15} /></button>
        <button className={styles.iconBtn} onClick={onClose} title="Close (Esc)" aria-label="Close search"><LuX size={15} /></button>
      </div>

      {query && (
        <div className={styles.results}>
          {results.length === 0 ? (
            <div className={styles.empty}>No matches</div>
          ) : (
            results.map((r) => (
              <button
                key={r.id}
                className={`${styles.result} ${r.id === activeId ? styles.resultActive : ''}`}
                onClick={() => goto(r.id)}
                title={r.line != null ? `Line ${r.line}` : undefined}
              >
                {r.line != null && <span className={styles.lineBadge}>{r.line}</span>}
                <span className={styles.snippet}>
                  <span className={styles.dim}>{r.before}</span>
                  <mark className={styles.hit}>{r.hit}</mark>
                  <span className={styles.dim}>{r.after}</span>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
