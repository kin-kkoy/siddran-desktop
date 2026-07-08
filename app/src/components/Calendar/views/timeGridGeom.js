// Geometry helpers for the proportional time-grid (Week/Day). Kept out of TimeGrid.jsx so that
// file only exports a component (fast-refresh requirement).
//
// The grid is a CONTINUOUS timeline (Google-Calendar style): the vertical axis is real time at
// HOUR_PX pixels/hour, an event's top = its start time and height = its duration, and overlapping
// events are packed into side-by-side columns ("lanes").

export const HOUR_PX = 64            // pixels per hour
export const MIN_BLOCK_PX = 18       // floor height so tiny/zero-duration blocks stay readable
export const DAY_PX = HOUR_PX * 24

const pad = (n) => String(n).padStart(2, '0')

// --- Hidden-hours remap -------------------------------------------------------------------------
// The grid can hide whole hours; visible hours then render contiguously. A module-level mapping
// (set by the active TimeGrid each render — only one renders at a time) lets minutesToY/yToMinutes/
// pointToDayTime stay hidden-aware everywhere (incl. the drawer) with no prop threading. When
// nothing is hidden the mapping is the identity, so default behaviour is byte-for-byte unchanged.
let _rowOfHour = null   // null = identity (all 24 visible). else: Array(24) hour -> visible row index (-1 if hidden)
let _hourOfRow = null   // visible row index -> hour
let _rowCount = 24

// `hidden` = Set/array of hours (0-23) to hide. Empty/full → identity.
export function setVisibleHours(hidden) {
    const set = hidden instanceof Set ? hidden : new Set(hidden || [])
    if (set.size === 0 || set.size >= 24) { _rowOfHour = null; _hourOfRow = null; _rowCount = 24; return }
    const rowOf = new Array(24).fill(-1)
    const hourOf = []
    for (let h = 0; h < 24; h++) if (!set.has(h)) { rowOf[h] = hourOf.length; hourOf.push(h) }
    _rowOfHour = rowOf; _hourOfRow = hourOf; _rowCount = hourOf.length
}
export const rowCount = () => _rowCount
export const gridHeight = () => _rowCount * HOUR_PX
// Y of a visible hour's top band (used to place hour lines/labels). h must be a visible hour.
export const hourToY = (h) => (_rowOfHour ? (_rowOfHour[h] ?? 0) : h) * HOUR_PX

export const snap15 = (min) => Math.round(min / 15) * 15
export const minutesToY = (min) => {
    if (!_rowOfHour) return (min / 60) * HOUR_PX
    const m = Math.max(0, Math.min(24 * 60, min))
    const h = Math.min(23, Math.floor(m / 60))
    let row = _rowOfHour[h]
    if (row === -1) {
        // Hidden hour → clamp to the start of the next visible run (so a block edge stops cleanly).
        let nh = h
        while (nh < 24 && _rowOfHour[nh] === -1) nh++
        return (nh < 24 ? _rowOfHour[nh] : _rowCount) * HOUR_PX
    }
    return row * HOUR_PX + ((m - h * 60) / 60) * HOUR_PX
}
export const yToMinutes = (y) => {
    if (!_rowOfHour) return (y / HOUR_PX) * 60
    const row = Math.max(0, Math.min(_rowCount - 1, Math.floor(y / HOUR_PX)))
    const h = _hourOfRow[row]
    return h * 60 + ((y - row * HOUR_PX) / HOUR_PX) * 60
}
export const timeToMinutes = (t) => { if (!t) return 0; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0) }
export const minutesToTime = (min) => {
    const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(min)))
    return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
}

// Resolve a viewport point to { day, minutes } using the day column under the pointer (data-col).
// minutes is measured from the column's top, scaled by HOUR_PX, clamped to [0, 1440].
export function pointToDayTime(x, y) {
    const col = document.elementFromPoint(x, y)?.closest('[data-col]')
    if (!col) return null
    const day = col.getAttribute('data-col')
    const rect = col.getBoundingClientRect()
    const minutes = Math.max(0, Math.min(24 * 60, yToMinutes(y - rect.top)))
    return { day, minutes }
}

// Greedy column packing for overlapping events. Input objects need { startMin, endMin };
// returns copies with { colIndex, colCount } so each renders at left = colIndex/colCount,
// width = 1/colCount. A "cluster" is a maximal run of mutually-overlapping events.
export function packLanes(evs) {
    const sorted = [...evs].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)
    const out = []
    let cluster = []
    let clusterEnd = -1

    const flush = () => {
        const colEnds = [] // last endMin placed in each column
        for (const ev of cluster) {
            let col = colEnds.findIndex(end => ev.startMin >= end)
            if (col === -1) { col = colEnds.length; colEnds.push(ev.endMin) }
            else colEnds[col] = ev.endMin
            ev.__col = col
        }
        const colCount = colEnds.length
        for (const ev of cluster) out.push({ ...ev, colIndex: ev.__col, colCount })
        cluster = []
        clusterEnd = -1
    }

    for (const ev of sorted) {
        if (cluster.length && ev.startMin >= clusterEnd) flush() // no overlap with the cluster → new one
        cluster.push(ev)
        clusterEnd = Math.max(clusterEnd, ev.endMin)
    }
    if (cluster.length) flush()
    return out
}
