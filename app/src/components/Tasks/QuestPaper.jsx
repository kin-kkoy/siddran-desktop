import { memo, useRef, useState } from 'react'
import { FaCheck } from 'react-icons/fa'
import { HiOutlineTrash } from 'react-icons/hi'
import { LuCalendarDays, LuRepeat, LuLayers } from 'react-icons/lu'
import styles from './QuestPaper.module.css'

// A task pinned to the Mission Board.
//
// A fork of TaskCard rather than a variant of it: this one is a fixed-width sheet
// with a torn edge and a pin, positioned absolutely and dragged by the pointer,
// which has almost nothing in common with a card that has to flow in a masonry
// grid. Forking keeps kanban and the legacy grid untouched.
//
// Dragging follows Sandbox's useCardPointer: pointer capture, one commit per
// animation frame, and `<button>` as the escape hatch so the tick and the bin
// don't start a drag. HTML5 drag-and-drop is not an option here — WebKitGTK
// swallows `drop` while Tauri's file-drop is enabled.
// The same vocabulary the rest of Tasks uses. The board is a different look, not
// a different language — a task is not "B-Rank" anywhere else in the app.
const PRIORITY_RANK = {
  high: { label: 'High', cls: 'rankHigh' },
  normal: { label: 'Normal', cls: 'rankNormal' },
  low: { label: 'Low', cls: 'rankLow' },
}

const KIND_ICON = { daily: LuRepeat, bundle: LuLayers }

// `item` and the handlers are stable identities from MissionBoard, and the
// handlers take the item rather than closing over it — otherwise a fresh arrow
// function per render would defeat memo() and re-render every paper on the board
// on every frame of a drag.
function QuestPaper({ item, place, locked, boardRef, onMove, onCommit, onRaise, onOpen, onToggle, onDelete }) {
  const { boardKey, kind, title, subtitle, priority = 'normal', due, dueAllDay, done, overdue, progress } = item
  const elRef = useRef(null)
  const dragRef = useRef(null)
  const [dragging, setDragging] = useState(false)

  const rank = PRIORITY_RANK[priority] || PRIORITY_RANK.normal
  const KindIcon = KIND_ICON[kind]

  const onPointerDown = (e) => {
    if (e.button !== 0) return
    if (e.target.closest('button')) return
    // Stops the native text-selection / image-drag that would otherwise run
    // alongside ours and make the paper stutter.
    e.preventDefault()
    onRaise?.(boardKey)
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      originX: place.x, originY: place.y,
      lastX: place.x, lastY: place.y,
      pointerId: e.pointerId, moved: false, raf: 0,
    }
    elRef.current?.setPointerCapture?.(e.pointerId)
  }

  const onPointerMove = (e) => {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    const rect = boardRef?.current?.getBoundingClientRect()
    if (!rect || !rect.width || !rect.height) return
    // Percent of the board, so the arrangement survives a resized window.
    d.lastX = d.originX + ((e.clientX - d.startX) / rect.width) * 100
    d.lastY = d.originY + ((e.clientY - d.startY) / rect.height) * 100
    if (!d.moved && (Math.abs(e.clientX - d.startX) > 3 || Math.abs(e.clientY - d.startY) > 3)) {
      d.moved = true
      setDragging(true)
    }
    if (d.moved && !d.raf) {
      d.raf = requestAnimationFrame(() => {
        d.raf = 0
        if (dragRef.current === d) onMove?.(boardKey, d.lastX, d.lastY)
      })
    }
  }

  const onPointerUp = (e) => {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    if (d.raf) { cancelAnimationFrame(d.raf); d.raf = 0 }
    dragRef.current = null
    elRef.current?.releasePointerCapture?.(e.pointerId)
    setDragging(false)
    if (d.moved) {
      onMove?.(boardKey, d.lastX, d.lastY)
      // Persistence happens HERE, once, not on every frame: writing the whole
      // arrangement to localStorage 60 times a second is exactly the kind of
      // thing that makes a board feel heavy.
      onCommit?.()
    } else {
      // A drag is not a click. Without this, letting go opens the task every time.
      onOpen?.(item)
    }
  }

  return (
    <div
      ref={elRef}
      className={`${styles.paper} ${done ? styles.done : ''} ${dragging ? styles.dragging : ''} ${overdue ? styles.isOverdue : ''}`}
      style={{
        left: `${place.x}%`,
        top: `${place.y}%`,
        // The tilt straightens while you hold it, the way a sheet does when you
        // pick it off a board.
        transform: `translate(-50%, -50%) rotate(${dragging ? 0 : place.tilt}deg)`,
        zIndex: dragging ? 9999 : place.z,
      }}
      draggable={false}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      title={locked ? title : `${title} — drag to move`}
    >
      <span className={styles.pin} aria-hidden="true" />

      <div className={styles.sheet}>
        <div className={styles.top}>
          <span className={`${styles.rank} ${styles[rank.cls]}`}>{rank.label}</span>
          {KindIcon && <KindIcon size={12} className={styles.kindIcon} />}
          {due && (
            <span className={`${styles.due} ${overdue ? styles.overdue : ''}`}>
              <LuCalendarDays size={11} />
              {new Date(due).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              {!dueAllDay && ` · ${new Date(due).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}
            </span>
          )}
        </div>

        <h3 className={styles.title}>{title}</h3>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}

        {progress && (
          <div className={styles.progress}>
            <div className={styles.progressBar}>
              <span style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
            </div>
            <span className={styles.progressText}>{progress.done} / {progress.total}</span>
          </div>
        )}

        <div className={styles.actions}>
          {onToggle && (
            <button
              type="button"
              className={`${styles.tick} ${done ? styles.ticked : ''}`}
              onClick={(e) => { e.stopPropagation(); onToggle(item) }}
              title={done ? 'Mark as not done' : 'Mark as done'}
            >
              {done && <FaCheck size={9} />}
            </button>
          )}
          <button type="button" className={styles.openBtn} onClick={(e) => { e.stopPropagation(); onOpen?.(item) }}>
            Take
          </button>
          {onDelete && (
            <button
              type="button"
              className={styles.binBtn}
              onClick={(e) => { e.stopPropagation(); onDelete(item) }}
              title="Delete"
            >
              <HiOutlineTrash size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default memo(QuestPaper)
