import { useEffect, useMemo, useRef } from 'react'
import styles from './NotebookStrip.module.css'
import { coverTone, lipTone } from './notebookTones'

export const UNFILED = '__unfiled__'
export const EVERYTHING = '__everything__'

// Creating a notebook lives in the hub header, not here — the strip is for
// choosing and for filing, and a + among the notebooks read as one of them.
//
// Notebooks are a FILTER, not objects in the grid. That is the change that
// shortens the hub: a filed note leaves the main view, so the card grid holds
// what you have not put away rather than everything you own.
//
// Three presentations of the same list, because they fail at different sizes:
//   tabs       compact; the open tab joins the rule beneath it, which says
//              "you are inside this one" without any extra copy. Starts
//              scrolling past roughly eight notebooks.
//   rail       down the side; the only one that still shows twenty at once.
//   notebooks  drawn as bound notebooks; the most legible target to drag onto,
//              and the most space spent before you reach a note.
//
// Every entry is also a drop target — each carries `data-drop-zone`, which
// useDragReorder hit-tests, so dragging a note onto one files it. Pointer events, not HTML5 drag — WebKitGTK
// swallows `drop` when Tauri's file-drop is enabled.
function NotebookStrip({
  view, notebooks, countByNotebook, unfiledCount, totalCount,
  active, onSelect, hoverExpand, hoverZone,
}) {
  const scrollerRef = useRef(null)

  const entries = useMemo(() => ([
    { key: UNFILED, label: 'Unfiled', count: unfiledCount, colour: null },
    ...notebooks.map(nb => ({
      key: String(nb.id), label: nb.name || 'Untitled', count: countByNotebook.get(nb.id) ?? (nb.note_count || 0), colour: nb.color,
    })),
    { key: EVERYTHING, label: 'Everything', count: totalCount, colour: null },
  ]), [notebooks, countByNotebook, unfiledCount, totalCount])

  // A vertical wheel over a horizontal strip should move it sideways. Without
  // this, twenty tabs are only reachable by dragging a bar we deliberately hide.
  // Not passive: we preventDefault so the page doesn't scroll instead.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el || view === 'rail') return
    const onWheel = (e) => {
      if (el.scrollWidth <= el.clientWidth) return
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [view])

  // A drop target is just an element carrying its key. The hook finds it with
  // elementFromPoint, so nothing has to stay registered as this re-renders under
  // an in-flight drag.
  const shared = (e) => ({
    key: e.key,
    'data-drop-zone': e.key,
    type: 'button',
    role: 'tab',
    'aria-selected': active === e.key,
    onClick: () => onSelect(e.key),
    style: e.colour
      ? { '--cover': coverTone(e.colour), '--lip': lipTone(e.colour) }
      : undefined,
  })

  const over = (key) => (hoverZone === key ? ' ' + styles.dropOn : '')
  const on = (key) => (active === key ? ' ' + styles.on : '')

  if (view === 'rail') {
    return (
      <aside className={styles.rail} role="tablist" aria-label="Notebooks">
        <div className={styles.railCap}>Notebooks</div>
        {entries.map((e, i) => (
          <div key={e.key} className={styles.railSlot}>
            {(i === 1 || e.key === EVERYTHING) && <div className={styles.railSep} />}
            <button {...shared(e)} className={styles.railItem + on(e.key) + over(e.key)}>
              <span className={styles.nm}>{e.label}</span>
              <span className={styles.n}>{e.count}</span>
            </button>
          </div>
        ))}
      </aside>
    )
  }

  if (view === 'tabs') {
    return (
      <div className={styles.shelf} ref={scrollerRef} role="tablist" aria-label="Notebooks">
        {entries.map(e => (
          <button {...shared(e)} className={styles.tab + on(e.key) + over(e.key)}>
            <span>{e.label}</span>
            <span className={styles.n}>{e.count}</span>
          </button>
        ))}
      </div>
    )
  }

  // Notebooks — drawn as the object. Unfiled is a loose stack of sheets, because
  // that is literally what an unfiled note is; Everything is a shelf of them.
  // Neither is a notebook, so neither is drawn as one.
  return (
    <div className={`${styles.foldWrap} ${hoverExpand ? styles.foldExpand : ''}`}>
      <div className={styles.folders} ref={scrollerRef} role="tablist" aria-label="Notebooks">
        {entries.map(e => {
          const shape = e.key === UNFILED ? ' ' + styles.loose
            : e.key === EVERYTHING ? ' ' + styles.stack : ''
          return (
            <button {...shared(e)} className={styles.folder + shape + on(e.key) + over(e.key)}>
              {e.key === UNFILED ? (
                <>
                  <span className={`${styles.lf} ${styles.lf1}`} />
                  <span className={`${styles.lf} ${styles.lf2}`} />
                  <span className={`${styles.lf} ${styles.lf3}`} />
                </>
              ) : e.key === EVERYTHING ? (
                <>
                  <span className={`${styles.bk} ${styles.bk1}`} />
                  <span className={`${styles.bk} ${styles.bk2}`} />
                  <span className={`${styles.bk} ${styles.bk3}`} />
                </>
              ) : (
                <>
                  <span className={styles.pages} />
                  <span className={styles.cover} />
                  <span className={styles.rings} />
                </>
              )}
              <span className={styles.patch}><span className={styles.nm}>{e.label}</span></span>
              <span className={styles.n}>{e.count} {e.count === 1 ? 'note' : 'notes'}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default NotebookStrip
