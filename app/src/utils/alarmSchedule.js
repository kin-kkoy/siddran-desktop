// When each thing with a deadline should go off — pure, no DOM, no Tauri, no React.
//
// This is deliberately the only place the firing rules live, and deliberately
// dependency-free: if WebKitGTK ever turns out to suspend a hidden page's timers
// entirely, this module is the piece that gets ported to Rust and nothing else
// has to move with it.
//
// Two tiers:
//   'reminder' — the per-task "remind me at", a gentle nudge (toast + one chime)
//   'alarm'    — the deadline itself, the thing that keeps ringing
import { isoDate, toISOFromParts, parseRecurrence, recurrenceMatches } from '../components/Calendar/calendarDates'

// A daily's `time` is 'HH:MM' local. Build the fire moment from date parts —
// never by parsing a 'YYYY-MM-DDTHH:MM' string, which is read as UTC by some
// engines and would shift every alarm by the local offset.
export function dailyFireTime(daily, day) {
  if (!daily?.time) return null
  const iso = toISOFromParts(isoDate(day), daily.time)
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : ms
}

// The chosen hour on the local day a date-only deadline falls on.
export function allDayFireTime(dueISO, allDayTime = '09:00') {
  if (!dueISO) return null
  const day = new Date(dueISO)
  if (Number.isNaN(day.getTime())) return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(allDayTime))
  const hh = m ? Number(m[1]) : 9
  const mm = m ? Number(m[2]) : 0
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hh, mm, 0, 0).getTime()
}

const stamp = (v) => {
  if (!v) return null
  const ms = Date.parse(v)
  return Number.isNaN(ms) ? null : ms
}

// Every trigger that has a fire time at all, whether or not it is due yet. The
// caller compares `at` against the clock; keeping that comparison out of here is
// what makes the sweep stateless and this module trivially testable.
//
//   → [{ key, at, tier, kind, id, title }]
export function dueTriggers({ tasks = [], dailies = [], completions = [], now = Date.now(), allDayTime = '09:00' } = {}) {
  const out = []

  for (const t of tasks) {
    if (!t || t.is_completed) continue
    // A date-only deadline is stored at 23:59 so it sorts and renders on the
    // right day, but ringing at one minute to midnight helps nobody. It goes off
    // at the hour set in Settings instead — a policy about the alarm, not a time
    // silently written onto the task.
    const due = t.due_all_day ? allDayFireTime(t.due_date, allDayTime) : stamp(t.due_date)
    if (due != null) {
      out.push({ key: `t:${t.id}:due:${t.due_date}`, at: due, tier: 'alarm', kind: 'task', id: t.id, title: t.title })
    }
    const remind = stamp(t.remind_at)
    if (remind != null) {
      out.push({ key: `t:${t.id}:rem:${t.remind_at}`, at: remind, tier: 'reminder', kind: 'task', id: t.id, title: t.title })
    }
  }

  const today = new Date(now)
  const todayISO = isoDate(today)
  // '<daily_task_id>|<ISO day>' — the same key shape useCalendar builds.
  const doneToday = new Set()
  for (const c of completions) {
    const day = typeof c?.date === 'string' ? c.date.slice(0, 10) : isoDate(new Date(c?.date))
    if (day === todayISO) doneToday.add(String(c.daily_task_id))
  }

  for (const d of dailies) {
    if (!d?.time) continue // no time of day is no deadline to speak of
    const rule = parseRecurrence(d.recurrence)
    if (rule) {
      if (!recurrenceMatches(rule, today)) continue
      // Completion is checked HERE, at sweep time rather than schedule time, so
      // ticking something off five minutes early actually disarms it.
      if (doneToday.has(String(d.id))) continue
    } else {
      if (d.is_completed) continue
      const expires = stamp(d.expires_at)
      if (expires != null && expires < now) continue
    }
    const at = dailyFireTime(d, today)
    if (at == null) continue
    out.push({ key: `d:${d.id}:${todayISO}:${d.time}`, at, tier: 'alarm', kind: 'daily', id: d.id, title: d.title })
  }

  return out
}

// Split what is due into what should actually ring and what merely missed its
// moment while the app was shut. Anything older than the grace window is marked
// fired without a sound, so a two-week-old deadline doesn't scream on launch —
// and doesn't scream again on the next launch either.
export function partitionDue(triggers, { now = Date.now(), graceMs = 12 * 60 * 60 * 1000, fired = () => false } = {}) {
  const ring = []
  const stale = []
  for (const trig of triggers) {
    if (trig.at > now) continue
    if (fired(trig.key)) continue
    if (trig.at <= now - graceMs) stale.push(trig)
    else ring.push(trig)
  }
  ring.sort((a, b) => a.at - b.at)
  return { ring, stale }
}
