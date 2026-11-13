/**
 * The Timeline (spec §13.5): records on a date axis. Pure: days, ranges,
 * ticks, spans and dependency routes. A view of the same records — moving a
 * bar rewrites its date fields, never a separate position (R13.40).
 *
 * View settings, every key optional:
 *
 *   payload.timeline = {
 *     startBy:  fieldId,     // a date field; default one named Start, else the first date field
 *     endBy:    fieldId | 'none',   // default one named End / Finish / Due (not the start), else none
 *     zoom:     'day' | 'week' | 'month' | 'quarter' | 'year',   // default week
 *     groupBy:  fieldId,     // swimlanes by a select field
 *     colorBy:  fieldId,     // bars coloured by a select field
 *     rows:     'compact' | 'default' | 'tall',
 *     filters, match, sorts, // as the Table's
 *     links:    [{ from, to }],   // "to" is blocked by "from": an arrow from one's end to the other's start
 *     collapsed: [optionKey], // folded swimlanes
 *     styles,                 // the style bar's looks (boards.js applyCardStyle)
 *   }
 *
 * A record with a start (or only an end) is a bar from start to end, both
 * days included; with no end it is a milestone. No dates: it waits in the
 * Unscheduled tray (R13.43). Days are 'YYYY-MM-DD'; layout counts whole days
 * as integers (UTC, so no daylight-saving drift).
 */
import { todayDay } from './query'

const DAY_MS = 864e5
const pad = (n) => String(n).padStart(2, '0')

export const dayNum = (s) => {
    if (typeof s !== 'string') return null
    const [y, m, d] = s.split('-').map(Number)
    if (!y || !m || !d) return null
    return Math.round(Date.UTC(y, m - 1, d) / DAY_MS)
}
export const dayStr = (n) => {
    const d = new Date(n * DAY_MS)
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}
export const todayNum = () => dayNum(todayDay())
const ymd = (n) => { const d = new Date(n * DAY_MS); return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCDay()] }

/**
 * Zoom levels: em per day (so the axis grows with the widget's text size),
 * the padding around the records, the two tiers of the axis, the shortest
 * range shown, and the length a newly scheduled record gets.
 */
export const ZOOMS = [
    { id: 'day', label: 'Day', ppd: 2.4, pad: 7, tiers: ['month', 'day'], min: 42, dur: 3 },
    { id: 'week', label: 'Week', ppd: 0.9, pad: 14, tiers: ['month', 'week'], min: 112, dur: 7 },
    { id: 'month', label: 'Month', ppd: 0.26, pad: 45, tiers: ['year', 'month'], min: 400, dur: 14 },
    { id: 'quarter', label: 'Quarter', ppd: 0.1, pad: 92, tiers: ['year', 'quarter'], min: 1100, dur: 30 },
    { id: 'year', label: 'Year', ppd: 0.035, pad: 366, tiers: [null, 'year'], min: 3000, dur: 60 },
]
export const zoomOf = (id) => ZOOMS.find(z => z.id === id) || ZOOMS[1]

// ---- which fields ----

const named = (re) => (f) => re.test(f.name || '') || re.test(f.id || '')

export function timelineSetup(fields, cfg = {}) {
    const dates = fields.filter(f => f.type === 'date')
    const start = dates.find(f => f.id === cfg.startBy) || dates.find(named(/^start/i)) || dates[0] || null
    let end = null
    if (cfg.endBy !== 'none') {
        end = dates.find(f => f.id === cfg.endBy && f !== start)
            || (cfg.endBy ? null : dates.find(f => f !== start && named(/^(end|finish)/i)(f)) || dates.find(f => f !== start && named(/^due/i)(f)))
            || null
    }
    const sel = fields.filter(f => f.type === 'select')
    const group = (cfg.groupBy && sel.find(f => f.id === cfg.groupBy)) || null
    const colorBy = (cfg.colorBy && sel.find(f => f.id === cfg.colorBy)) || null
    return { start, end, group, colorBy }
}

/**
 * Where a record sits: { s, e, milestone } in day numbers, or null when it
 * has no dates. An end before the start shows the right way round.
 */
export function spanOf(rec, { start, end }) {
    const v = rec?.values || {}
    let s = start ? dayNum(v[start.id]) : null
    let e = end ? dayNum(v[end.id]) : null
    if (s == null && e == null) return null
    if (s == null) return { s: e, e: e, milestone: true }
    if (e == null) return { s, e: s, milestone: true }
    if (e < s) [s, e] = [e, s]
    return { s, e, milestone: false }
}

// ---- the axis ----

/** The first day of the unit holding day `n`. Weeks start on Monday. */
export function unitStart(unit, n) {
    const [y, m, , wd] = ymd(n)
    switch (unit) {
        case 'day': return n
        case 'week': return n - ((wd + 6) % 7)
        case 'month': return Math.round(Date.UTC(y, m, 1) / DAY_MS)
        case 'quarter': return Math.round(Date.UTC(y, m - (m % 3), 1) / DAY_MS)
        default: return Math.round(Date.UTC(y, 0, 1) / DAY_MS)
    }
}
export function nextUnit(unit, n) {
    const [y, m] = ymd(n)
    switch (unit) {
        case 'day': return n + 1
        case 'week': return n + 7
        case 'month': return Math.round(Date.UTC(y, m + 1, 1) / DAY_MS)
        case 'quarter': return Math.round(Date.UTC(y, m + 3, 1) / DAY_MS)
        default: return Math.round(Date.UTC(y + 1, 0, 1) / DAY_MS)
    }
}

/**
 * The days the axis covers: every bar and today, padded, at least the zoom's
 * shortest range, starting on a boundary of its upper tier (so labels line up).
 */
export function axisRange(spans, zoomId, today = todayNum()) {
    const z = zoomOf(zoomId)
    let lo = today, hi = today
    for (const sp of spans) { if (sp.s < lo) lo = sp.s; if (sp.e > hi) hi = sp.e }
    lo -= z.pad; hi += z.pad
    if (hi - lo + 1 < z.min) { const extra = z.min - (hi - lo + 1); lo -= Math.floor(extra / 2); hi += Math.ceil(extra / 2) }
    lo = unitStart(z.tiers[0] || z.tiers[1], lo)
    return { d0: lo, d1: hi, days: hi - lo + 1 }
}

const MONTHS = (style) => Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2026, i, 1)).toLocaleDateString(undefined, { month: style, timeZone: 'UTC' }))
let monthNames = null
const month = (i, style) => { monthNames = monthNames || { short: MONTHS('short'), long: MONTHS('long') }; return monthNames[style][i] }

/** One tier's ticks from d0 to d1: [{ n, len, label }], clipped to the range. */
export function ticks(unit, d0, d1) {
    if (!unit) return []
    const out = []
    for (let n = unitStart(unit, d0); n <= d1; n = nextUnit(unit, n)) {
        const a = Math.max(n, d0), b = Math.min(nextUnit(unit, n), d1 + 1)
        const [y, m, d] = ymd(n)
        const label = unit === 'day' ? String(d)
            : unit === 'week' ? `${month(m, 'short')} ${d}`
                : unit === 'month' ? month(m, 'short')
                    : unit === 'quarter' ? `Q${Math.floor(m / 3) + 1}`
                        : String(y)
        out.push({ n: a, len: b - a, label, start: n })
    }
    return out
}
/** The upper tier's label: "March 2026" over days and weeks, the year over months and quarters. */
export function upperLabel(unit, n) {
    const [y, m] = ymd(n)
    return unit === 'month' ? `${month(m, 'long')} ${y}` : String(y)
}
/** Saturdays in range (the weekend is shaded at day and week zoom). */
export function weekends(d0, d1) {
    const out = []
    for (let n = unitStart('week', d0) + 5; n <= d1; n += 7) out.push(n)
    return out
}
export const weekday = (n) => ymd(n)[3]

// ---- edits ----

/** The patch that moves a record `dd` days (both dates; a missing one stays missing). */
export function movePatch(rec, setup, dd) {
    const v = rec.values || {}, out = {}
    for (const f of [setup.start, setup.end]) {
        if (!f) continue
        const n = dayNum(v[f.id])
        if (n != null) out[f.id] = dayStr(n + dd)
    }
    return out
}

/** The patch for dragging one edge to day `n`; start never passes the end (R13.41). */
export function resizePatch(rec, setup, edge, n) {
    const sp = spanOf(rec, setup)
    if (!sp || sp.milestone || !setup.end) return {}
    if (edge === 'start') return { [setup.start.id]: dayStr(Math.min(n, sp.e)) }
    return { [setup.end.id]: dayStr(Math.max(n, sp.s)) }
}

/** A record dropped on the axis at day `n`: it starts there, and lasts the zoom's usual length when there's an end field. */
export function schedulePatch(setup, n, zoomId) {
    const out = {}
    if (setup.start) out[setup.start.id] = dayStr(n)
    if (setup.end) out[setup.end.id] = dayStr(n + zoomOf(zoomId).dur - 1)
    if (!setup.start && setup.end) out[setup.end.id] = dayStr(n)
    return out
}

/** Back to the tray: its dates cleared. */
export function unschedulePatch(setup) {
    const out = {}
    if (setup.start) out[setup.start.id] = undefined
    if (setup.end) out[setup.end.id] = undefined
    return out
}

/** The zoom that fits days `lo..hi` into `widthEm` (the most detailed that fits), or the widest. */
export function fitZoom(lo, hi, widthEm) {
    const days = hi - lo + 1
    for (const z of ZOOMS) if (days * z.ppd <= widthEm * 0.9) return z.id
    return ZOOMS[ZOOMS.length - 1].id
}

// ---- dependencies ----

/** Links that still name two records, without repeats or self-links. */
export function cleanLinks(links = [], ids) {
    const seen = new Set()
    return links.filter(l => {
        const k = `${l.from}>${l.to}`
        if (l.from === l.to || seen.has(k) || !ids.has(l.from) || !ids.has(l.to)) return false
        seen.add(k)
        return true
    })
}

/**
 * An orthogonal route from the end of one bar (ax, ay) to the start of
 * another (bx, by), as SVG path data. Straight in when there's room; around
 * through the gap between rows when the next one starts before this ends.
 */
export function routeLink(ax, ay, bx, by, gap = 0.6, half = 1.2) {
    const f = (x) => Math.round(x * 1000) / 1000
    if (bx >= ax + gap * 2) return `M${f(ax)} ${f(ay)}H${f(ax + gap)}V${f(by)}H${f(bx)}`
    const mid = by > ay ? ay + half : ay - half
    return `M${f(ax)} ${f(ay)}H${f(ax + gap)}V${f(mid)}H${f(bx - gap)}V${f(by)}H${f(bx)}`
}

/**
 * An arrowhead at (x, y) pointing along `angle` (radians), as SVG path data in
 * the same units as the route (em): a small closed triangle.
 */
export function arrowHead(x, y, angle = 0, len = 0.5, half = 0.28) {
    const f = (v) => Math.round(v * 1000) / 1000
    const c = Math.cos(angle), s = Math.sin(angle)
    const bx = x - c * len, by = y - s * len
    return `M${f(x)} ${f(y)}L${f(bx - s * half)} ${f(by + c * half)}L${f(bx + s * half)} ${f(by - c * half)}Z`
}
