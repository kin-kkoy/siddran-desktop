import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LuCalendarDays, LuX, LuChevronLeft, LuChevronRight } from 'react-icons/lu'
import styles from './DateTimePicker.module.css'

// A self-contained date + time picker. Blank by default; a calendar button opens
// a popup (click again / outside / Esc closes it). Fully custom (no native
// datetime-local), so it looks and behaves the same on WebKitGTK / dark mode.
//
// value / onChange use the same 'YYYY-MM-DDTHH:MM' local string a datetime-local
// produces, so callers that do `new Date(value).toISOString()` keep working.

const pad = (n) => String(n).padStart(2, '0')
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

const parse = (value) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || '')
  return m ? { y: +m[1], mo: +m[2] - 1, d: +m[3], h: +m[4], mi: +m[5] } : null
}
const build = (y, mo, d, h, mi) => `${y}-${pad(mo + 1)}-${pad(d)}T${pad(h)}:${pad(mi)}`
const formatDisplay = (value) => {
  const p = parse(value)
  if (!p) return null
  const ampm = p.h >= 12 ? 'PM' : 'AM'
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12
  return `${MONTHS[p.mo].slice(0, 3)} ${p.d}, ${p.y} · ${h12}:${pad(p.mi)} ${ampm}`
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

  // Position the portaled popup under the trigger (flip up if it won't fit).
  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return
    const r = wrapRef.current.getBoundingClientRect()
    const W = 288, H = 356
    let top = r.bottom + 6
    if (top + H > window.innerHeight - 8) top = Math.max(8, r.top - H - 6)
    let left = Math.min(r.left, window.innerWidth - W - 8)
    setPos({ top, left: Math.max(8, left), width: W })
  }, [open])

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

  const time = parsed ? { h: parsed.h, mi: parsed.mi } : { h: 9, mi: 0 }

  const pickDay = (d) => onChange(build(view.y, view.mo, d, time.h, time.mi))
  const setTime = (h, mi) => {
    const base = parsed ?? { y: now.getFullYear(), mo: now.getMonth(), d: now.getDate() }
    onChange(build(base.y, base.mo, base.d, h, mi))
  }
  const clear = () => onChange('')
  const setToday = () => onChange(build(now.getFullYear(), now.getMonth(), now.getDate(), time.h, time.mi))

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

      {open && pos && createPortal(
        <div
          ref={popupRef}
          className={styles.popup}
          style={{ top: pos.top, left: pos.left, width: pos.width }}
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
            </label>
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
