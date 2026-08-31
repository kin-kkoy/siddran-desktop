import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LuLock, LuLockOpen, LuShuffle, LuFilter } from 'react-icons/lu'
import QuestPaper from './QuestPaper'
import styles from './MissionBoard.module.css'
import {
  readPlacements, writePlacements, readLocked, writeLocked,
  scatter, withNewKeys, moveTo, raise, prunePlacements,
  TASK_KEY, DAILY_KEY, BUNDLE_KEY,
} from '../../hooks/missionBoard'

// The board's session arrangement. A module singleton, not state, because
// "re-scatter once per launch" means exactly that: navigating to Notes and back
// remounts this component, and the wall must not reshuffle underneath you.
let sessionPlacements = null
let sessionBag = null

// Cycles All → Low → Normal → High → All.
const PRIORITY_CYCLE = ['all', 'low', 'normal', 'high']
const PRIORITY_LABEL = { all: 'All', low: 'Low', normal: 'Normal', high: 'High' }
const filterKey = (bagPath) => `siddran_board_priority:${bagPath || 'default'}`

function MissionBoard({
  tasks, dailies, bundles, dressing = 'plain', bagPath,
  onOpenTask, onOpenDaily, onOpenBundle,
  onToggleTask, onToggleDaily, onDeleteTask,
  ready,
}) {
  const boardRef = useRef(null)
  const [priority, setPriority] = useState(() => {
    try {
      const saved = localStorage.getItem(filterKey(bagPath))
      return PRIORITY_CYCLE.includes(saved) ? saved : 'all'
    } catch { return 'all' }
  })
  const [locked, setLocked] = useState(() => readLocked(bagPath))
  const [placements, setPlacements] = useState({})
  const lockedRef = useRef(locked)
  useEffect(() => { lockedRef.current = locked }, [locked])

  // Everything that gets a paper, in a stable order.
  const items = useMemo(() => {
    const out = []
    const startOfToday = new Date().setHours(0, 0, 0, 0)
    for (const t of tasks) {
      out.push({
        boardKey: TASK_KEY(t.id), kind: 'task', id: t.id, source: t,
        title: t.title, subtitle: t.description || null, priority: t.priority,
        due: t.due_date, dueAllDay: !!t.due_all_day, done: !!t.is_completed,
        // Day-granular, matching TaskCard: a deadline today is not yet late.
        overdue: !t.is_completed && !!t.due_date
          && new Date(t.due_date).setHours(0, 0, 0, 0) < startOfToday,
      })
    }
    for (const d of dailies) {
      out.push({
        boardKey: DAILY_KEY(d.id), kind: 'daily', id: d.id, source: d,
        title: d.title, subtitle: d.time ? `Every day at ${d.time}` : 'Routine',
        priority: d.priority, done: !!d.is_completed,
      })
    }
    for (const b of bundles) {
      const total = b.tasks?.length || 0
      const done = b.tasks?.filter((t) => t.is_completed).length || 0
      out.push({
        boardKey: BUNDLE_KEY(b.id), kind: 'bundle', id: b.id, source: b,
        title: b.title, subtitle: null, priority: b.priority,
        done: !!b.is_completed, progress: total ? { done, total } : null,
      })
    }
    return out
  }, [tasks, dailies, bundles])

  // Placement is computed from EVERY item, and the filter only decides what gets
  // drawn. Feeding the filtered list into the layout would prune the hidden
  // papers, and cycling back to All would then deal them fresh spots — so the
  // board would reshuffle itself every time you touched the filter.
  const keys = useMemo(() => items.map((i) => i.boardKey), [items])
  const keysSig = keys.join('|')

  const shown = useMemo(
    () => (priority === 'all' ? items : items.filter((i) => (i.priority || 'normal') === priority)),
    [items, priority],
  )

  const cyclePriority = () => {
    const next = PRIORITY_CYCLE[(PRIORITY_CYCLE.indexOf(priority) + 1) % PRIORITY_CYCLE.length]
    setPriority(next)
    try { localStorage.setItem(filterKey(bagPath), next) } catch { /* a filter is a convenience */ }
  }

  // Lay the board out. `ready` is the load gate: it is false until a real
  // response has arrived, and pruning a locked arrangement against a list that
  // is [] only because nothing has loaded yet would quietly wipe it.
  useEffect(() => {
    if (!ready) return
    setPlacements(() => {
      if (lockedRef.current) {
        const saved = prunePlacements(readPlacements(bagPath), keys)
        const filled = withNewKeys(saved, keys)
        writePlacements(filled, bagPath)
        return filled
      }
      // Unlocked: one scatter per launch, then hold it for the session.
      if (!sessionPlacements || sessionBag !== bagPath) {
        sessionPlacements = scatter(keys)
        sessionBag = bagPath
      } else {
        sessionPlacements = withNewKeys(prunePlacements(sessionPlacements, keys), keys)
      }
      return sessionPlacements
    })
  }, [ready, keysSig, bagPath, locked]) // eslint-disable-line react-hooks/exhaustive-deps

  // The arrangement is mirrored into a ref so the drag handlers can read the
  // latest one without being rebuilt every render — a changing callback identity
  // would defeat memo() on every paper and re-render the whole board each frame.
  const placesRef = useRef(placements)
  useEffect(() => { placesRef.current = placements }, [placements])

  const apply = useCallback((next) => {
    placesRef.current = next
    setPlacements(next)
    if (!lockedRef.current) { sessionPlacements = next; sessionBag = bagPath }
  }, [bagPath])

  // Moving is state only. Persisting happens once, on release — see handleCommit.
  const handleMove = useCallback((key, x, y) => {
    apply(moveTo(placesRef.current, key, x, y))
  }, [apply])

  const handleCommit = useCallback(() => {
    if (lockedRef.current) writePlacements(placesRef.current, bagPath)
  }, [bagPath])

  const handleRaise = useCallback((key) => {
    const next = raise(placesRef.current, key)
    if (next === placesRef.current) return
    apply(next)
    if (lockedRef.current) writePlacements(next, bagPath)
  }, [apply, bagPath])

  const commit = useCallback((next) => {
    apply(next)
    if (lockedRef.current) writePlacements(next, bagPath)
  }, [apply, bagPath])

  const toggleLock = () => {
    const next = !locked
    setLocked(next)
    writeLocked(next, bagPath)
    // Locking pins down exactly what is on screen right now — that is the
    // promise of the button, so it writes the current arrangement, not a fresh one.
    if (next) writePlacements(placements, bagPath)
  }

  const reshuffle = () => commit(scatter(keys))

  const open = useCallback((item) => {
    if (item.kind === 'task') onOpenTask?.(item.source)
    else if (item.kind === 'daily') onOpenDaily?.(item.source)
    else onOpenBundle?.(item.source)
  }, [onOpenTask, onOpenDaily, onOpenBundle])

  const toggle = useCallback((item) => {
    if (item.kind === 'task') onToggleTask?.(item.id, !item.done)
    else if (item.kind === 'daily') onToggleDaily?.(item.id, !item.done)
  }, [onToggleTask, onToggleDaily])

  const remove = useCallback((item) => {
    if (item.kind === 'task') onDeleteTask?.(item.id)
  }, [onDeleteTask])

  return (
    <div className={`${styles.board} ${dressing === 'guild' ? styles.guild : ''}`} ref={boardRef}>
      {dressing === 'guild' && (
        <>
          <span className={`${styles.bracket} ${styles.btl}`} aria-hidden="true" />
          <span className={`${styles.bracket} ${styles.btr}`} aria-hidden="true" />
          <span className={`${styles.bracket} ${styles.bbl}`} aria-hidden="true" />
          <span className={`${styles.bracket} ${styles.bbr}`} aria-hidden="true" />
          <span className={`${styles.lantern} ${styles.lanternL}`} aria-hidden="true"><i /></span>
          <span className={`${styles.lantern} ${styles.lanternR}`} aria-hidden="true"><i /></span>
          <div className={styles.dust} aria-hidden="true">
            {Array.from({ length: 14 }, (_, i) => (
              <span
                key={i}
                style={{
                  left: `${5 + (i * 19) % 90}%`,
                  top: `${10 + (i * 24) % 80}%`,
                  width: `${2 + (i % 3) * 2}px`,
                  height: `${2 + (i % 3) * 2}px`,
                  animationDelay: `${(i * 1.4) % 6}s`,
                  animationDuration: `${11 + (i % 4) * 3}s`,
                }}
              />
            ))}
          </div>
        </>
      )}

      <div className={styles.controls}>
        <button
          type="button"
          className={`${styles.boardBtn} ${priority !== 'all' ? styles.boardBtnOn : ''}`}
          onClick={cyclePriority}
          title={priority === 'all'
            ? 'Showing everything — click to show only Low'
            : `Showing ${PRIORITY_LABEL[priority]} priority only — click to cycle`}
        >
          <LuFilter size={15} /> {PRIORITY_LABEL[priority]}
        </button>
        <button type="button" className={styles.boardBtn} onClick={reshuffle} title="Scatter the papers again">
          <LuShuffle size={15} /> Scatter
        </button>
        <button
          type="button"
          className={`${styles.boardBtn} ${locked ? styles.boardBtnOn : ''}`}
          onClick={toggleLock}
          title={locked
            ? 'Locked — this arrangement comes back next launch'
            : 'Unlocked — the board is re-scattered each launch'}
        >
          {locked ? <LuLock size={15} /> : <LuLockOpen size={15} />} {locked ? 'Locked' : 'Lock'}
        </button>
      </div>

      {shown.length === 0 && ready && (
        <p className={styles.empty}>
          {items.length === 0
            ? 'The board is bare. Nothing due, nothing pending.'
            : `Nothing at ${PRIORITY_LABEL[priority]} priority. ${items.length} pinned up under the other ranks.`}
        </p>
      )}

      {shown.map((item) => {
        const place = placements[item.boardKey]
        if (!place) return null
        return (
          <QuestPaper
            key={item.boardKey}
            item={item}
            place={place}
            locked={locked}
            boardRef={boardRef}
            onMove={handleMove}
            onCommit={handleCommit}
            onRaise={handleRaise}
            onOpen={open}
            onToggle={item.kind === 'bundle' ? undefined : toggle}
            onDelete={item.kind === 'task' ? remove : undefined}
          />
        )
      })}
    </div>
  )
}

export default MissionBoard
