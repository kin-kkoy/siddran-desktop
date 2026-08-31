// A deadline is a day, and *optionally* a time of day.
//
// `due_date` is a single ISO timestamp with nowhere to put "no time", so the
// distinction lives in a companion flag, `due_all_day` — the same shape calendar
// events already use. A date-only deadline is stored at LOCAL MIDNIGHT, which is
// the convention the rest of the app already speaks: `taskDueStamp` writes
// 00:00:00 for a timeless task and useCalendar reads midnight as all-day. Every
// comparison that matters (overdue, the today/overdue/range filters) normalises
// to the start of the day anyway, so the hour never decides anything — the flag
// does. Storing 23:59 for "end of Tuesday" reads better in the abstract and
// would have made the calendar draw every dateless task as a late-night
// appointment.
//
// Guessing date-only from a 23:59 timestamp was the cheaper option and is
// rejected on purpose: someone who genuinely picks 23:59 would have their choice
// silently erased on the next reload.
//
// The picker's value is a plain string, and its shape carries the distinction:
//   ''                    no deadline
//   'YYYY-MM-DD'          that day, no time
//   'YYYY-MM-DDTHH:MM'    that day at that local time

const pad = (n) => String(n).padStart(2, '0')

export const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
export const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/

// { due_date, due_all_day } for storage, from whatever the picker is holding.
export function fromPickerValue(value) {
  const v = String(value || '')

  const dt = DATE_TIME.exec(v)
  if (dt) {
    const [, y, mo, d, h, mi] = dt.map(Number)
    return { due_date: new Date(y, mo - 1, d, h, mi, 0, 0).toISOString(), due_all_day: false }
  }

  const only = DATE_ONLY.exec(v)
  if (only) {
    const [, y, mo, d] = only.map(Number)
    return { due_date: new Date(y, mo - 1, d, 0, 0, 0, 0).toISOString(), due_all_day: true }
  }

  return { due_date: null, due_all_day: false }
}

// ...and back again, for prefilling the picker.
//
// A row written before `due_all_day` existed has no flag, and for those local
// midnight is the older "no time" signal — the same fallback useCalendar uses.
// Once the flag IS present it wins outright, so a deliberately chosen 00:00
// survives a round-trip.
export function toPickerValue(iso, allDay) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const legacyMidnight = allDay == null && d.getHours() === 0 && d.getMinutes() === 0
  if (allDay === true || legacyMidnight) return day
  return `${day}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
