import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LuCalendarDays, LuX, LuChevronLeft, LuChevronRight, LuClock, LuPlus } from 'react-icons/lu'
import styles from './DateTimePicker.module.css'

// A self-contained date + time picker. Blank by default; a calendar button opens
// a popup (click again / outside / Esc closes it). Fully custom (no native
// datetime-local), so it looks and behaves the same on WebKitGTK / dark mode.
//
// value / onChange use a local string in one of three shapes:
//   ''                    no deadline
//   'YYYY-MM-DD'          that day, no time — picking a day does NOT invent one
//   'YYYY-MM-DDTHH:MM'    that day at that time
// utils/deadline.js converts between this and { due_date, due_all_day }.

const pad = (n) => String(n).padStart(2, '0')
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

const parse = (value) => {
  const v = String(value || '')
  const withTime = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v)
  if (withTime) return { y: +withTime[1], mo: +withTime[2] - 1, d: +withTime[3], h: +withTime[4], mi: +withTime[5], hasTime: true }
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (dateOnly) return { y: +dateOnly[1], mo: +dateOnly[2] - 1, d: +dateOnly[3], h: 0, mi: 0, hasTime: false }
  return null
}
const buildDay = (y, mo, d) => `${y}-${pad(mo + 1)}-${pad(d)}`
const build = (y, mo, d, h, mi) => `${buildDay(y, mo, d)}T${pad(h)}:${pad(mi)}`
const formatDisplay = (value) => {
  const p = parse(value)
  if (!p) return null
  const day = `${MONTHS[p.mo].slice(0, 3)} ${p.d}, ${p.y}`
  if (!p.hasTime) return day
  const ampm = p.h >= 12 ? 'PM' : 'AM'
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12
  return `${day} · ${h12}:${pad(p.mi)} ${ampm}`
}

export default function DateTimePicker({ value, onChange, placeholder = 'No deadline' }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const wrapRef = useRef(null)
  const popupRef = useRef(null)

  const parsed = parse(value)
  const now = new Date()
  const [view, setView] = useState(() => parsed
    ? { y: parsed.y, mo: parsed.mo }
    : { y: now.getFullYear(), mo: now.getMonth() })

  // Point the calendar at the selected month each time it opens.
  useEffect(() => {
    if (!open) return
    const p = parse(value)
    const d = new Date()
    setView(p ? { y: p.y, mo: p.mo } : { y: d.getFullYear(), mo: d.getMonth() })
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Position the portaled popup under the trigger, flipping above it when it
  // won't fit below. The height is MEASURED, not assumed: the popup grows by a
  // row when a time is added, and a hardcoded guess left the footer — the Done
  // and Clear buttons — hanging off the bottom of the window.
  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return
    const r = wrapRef.current.getBoundingClientRect()
    const W = 288
    const vh = window.innerHeight
    const h = popupRef.current?.offsetHeight || 380
    const maxHeight = vh - 16

    let top = r.bottom + 6
    if (top + h > vh - 8) {
      const above = r.top - h - 6
      top = above >= 8 ? above : Math.max(8, vh - Math.min(h, maxHeight) - 8)
    }
    const left = Math.max(8, Math.min(r.left, window.innerWidth - W - 8))

    // setPos re-renders, which re-runs this effect; bail when nothing moved or
    // the two would ping-pong forever.
    setPos((prev) => (prev && prev.top === top && prev.left === left && prev.maxHeight === maxHeight
      ? prev
      : { top, left, width: W, maxHeight }))
  }, [open, value])

  useEffect(() => { if (!open) setPos(null) }, [open])

  // Close on outside click / Escape (accounting for the portaled popup).
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (wrapRef.current?.contains(e.target)) return
      if (popupRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const hasTime = !!parsed?.hasTime
  const time = hasTime ? { h: parsed.h, mi: parsed.mi } : { h: 9, mi: 0 }

  // Picking a day keeps whatever time state you were already in. It never adds
  // one — a deadline with no time is a perfectly ordinary deadline.
  const pickDay = (d) => onChange(hasTime ? build(view.y, view.mo, d, time.h, time.mi) : buildDay(view.y, view.mo, d))
  const base = () => parsed ?? { y: now.getFullYear(), mo: now.getMonth(), d: now.getDate() }
  const setTime = (h, mi) => { const b = base(); onChange(build(b.y, b.mo, b.d, h, mi)) }
  const addTime = () => { const b = base(); onChange(build(b.y, b.mo, b.d, 9, 0)) }
  const dropTime = () => { const b = base(); onChange(buildDay(b.y, b.mo, b.d)) }
  const clear = () => onChange('')
  const setToday = () => onChange(hasTime
    ? build(now.getFullYear(), now.getMonth(), now.getDate(), time.h, time.mi)
    : buildDay(now.getFullYear(), now.getMonth(), now.getDate()))

  const prevMonth = () => setView(v => (v.mo === 0 ? { y: v.y - 1, mo: 11 } : { y: v.y, mo: v.mo - 1 }))
  const nextMonth = () => setView(v => (v.mo === 11 ? { y: v.y + 1, mo: 0 } : { y: v.y, mo: v.mo + 1 }))

  const firstDow = new Date(view.y, view.mo, 1).getDay()
  const daysInMonth = new Date(view.y, view.mo + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const isSel = (d) => parsed && parsed.y === view.y && parsed.mo === view.mo && parsed.d === d
  const isToday = (d) => now.getFullYear() === view.y && now.getMonth() === view.mo && now.getDate() === d

  const display = formatDisplay(value)

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={`${styles.trigger} ${display ? styles.hasValue : ''} ${open ? styles.triggerOpen : ''}`}
        onClick={() => setOpen(o => !o)}
        title="Deadline (optional)"
      >
        <LuCalendarDays size={15} className={styles.calIcon} />
        <span className={styles.triggerText}>{display || placeholder}</span>
      </button>

      {value && (
        <button type="button" className={styles.clear} onClick={clear} title="Clear deadline" aria-label="Clear deadline">
          <LuX size={15} />
        </button>
      )}

      {open && createPortal(
        <div
          ref={popupRef}
          className={styles.popup}
          style={pos
            ? { top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }
            : { top: 0, left: 0, width: 288, visibility: 'hidden' }}
        >
          <div className={styles.head}>
            <button type="button" className={styles.nav} onClick={prevMonth} aria-label="Previous month"><LuChevronLeft size={16} /></button>
            <span className={styles.monthLabel}>{MONTHS[view.mo]} {view.y}</span>
            <button type="button" className={styles.nav} onClick={nextMonth} aria-label="Next month"><LuChevronRight size={16} /></button>
          </div>

          <div className={styles.weekdays}>
            {WEEKDAYS.map(w => <span key={w}>{w}</span>)}
          </div>

          <div className={styles.grid}>
            {cells.map((d, i) => d === null
              ? <span key={i} />
              : (
                <button
                  key={i}
                  type="button"
                  className={`${styles.day} ${isSel(d) ? styles.selected : ''} ${isToday(d) ? styles.today : ''}`}
                  onClick={() => pickDay(d)}
                >
                  {d}
                </button>
              ))}
          </div>

          <div className={styles.footer}>
            {hasTime ? (
              <label className={styles.timeRow}>
                <span className={styles.timeLabel}>Time</span>
                <input
                  type="time"
                  className={styles.time}
                  value={`${pad(time.h)}:${pad(time.mi)}`}
                  onChange={(e) => {
                    const [h, mi] = e.target.value.split(':').map(Number)
                    if (!Number.isNaN(h) && !Number.isNaN(mi)) setTime(h, mi)
                  }}
                />
                <button type="button" className={styles.timeDrop} onClick={dropTime} title="Remove the time" aria-label="Remove the time">
                  <LuX size={14} />
                </button>
              </label>
            ) : (
              <button type="button" className={styles.addTime} onClick={addTime}>
                <LuPlus size={13} /> <LuClock size={13} /> Add a time
              </button>
            )}
            <div className={styles.actions}>
              <button type="button" className={styles.footBtn} onClick={setToday}>Today</button>
              <button type="button" className={`${styles.footBtn} ${styles.footClear}`} onClick={clear}>Clear</button>
              <button type="button" className={`${styles.footBtn} ${styles.footDone}`} onClick={() => setOpen(false)}>Done</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
