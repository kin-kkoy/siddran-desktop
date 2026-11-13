/**
 * Precision eraser: cut away only the part of a stroke under the eraser circle,
 * splitting the stroke into the pieces either side (spec §10.5).
 *
 * A stroke keeps its raw samples (`payload.points`) in the world coordinates
 * it was drawn at — the "draw frame". Moving, resizing or rotating it later only
 * changes item.x/y/w/h/rotation, so the draw frame is recovered by re-running
 * strokeOutline on those samples (it is deterministic, and is exactly what made
 * the stored outline). The eraser centre is mapped into that frame, the samples
 * are cut there, each piece gets a fresh outline, and each piece is placed so
 * it renders exactly where that part of the stroke was.
 */
import { strokeOutline } from '../Canvas/strokeOutline'
import { itemAABB } from '../selection/hitTest'

function bounds(flat) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (let i = 0; i < flat.length; i += 2) {
        if (flat[i] < minX) minX = flat[i]
        if (flat[i] > maxX) maxX = flat[i]
        if (flat[i + 1] < minY) minY = flat[i + 1]
        if (flat[i + 1] > maxY) maxY = flat[i + 1]
    }
    if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
    return { minX, minY, maxX, maxY }
}

const rot = (x, y, deg) => {
    if (!deg) return { x, y }
    const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
    return { x: x * c - y * s, y: x * s + y * c }
}

/** True when the stroke has raw samples we can cut ([[x,y,p], …]). */
export function canSplit(item) {
    const pts = item?.payload?.points
    return item?.type === 'stroke' && Array.isArray(pts) && pts.length > 0 && Array.isArray(pts[0])
}

/** The mapping between the stroke's draw frame and where it renders now. */
export function strokeFrame(item) {
    const p = item.payload
    const b = bounds(strokeOutline(p.points, { ...p.options, last: true }))
    const baseW = p.baseW ?? (b.maxX - b.minX)
    const baseH = p.baseH ?? (b.maxY - b.minY)
    const w = item.w ?? baseW, h = item.h ?? baseH
    return {
        ox: b.minX, oy: b.minY, baseW, baseH,
        sx: baseW ? w / baseW : 1, sy: baseH ? h / baseH : 1,
        cx: item.x + w / 2, cy: item.y + h / 2, rotation: item.rotation || 0,
    }
}

/** World point → draw-frame point. */
export function toDrawFrame(f, wx, wy) {
    const r = rot(wx - f.cx, wy - f.cy, -f.rotation)
    return { x: r.x / f.sx + f.baseW / 2 + f.ox, y: r.y / f.sy + f.baseH / 2 + f.oy }
}

// Parameters t in (0,1) where segment a→b crosses the circle (c, R).
function crossings(a, b, c, R) {
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const fx = a[0] - c.x, fy = a[1] - c.y
    const A = dx * dx + dy * dy
    if (A === 0) return []
    const B = 2 * (fx * dx + fy * dy)
    const C = fx * fx + fy * fy - R * R
    const disc = B * B - 4 * A * C
    if (disc <= 0) return []
    const sq = Math.sqrt(disc)
    return [(-B - sq) / (2 * A), (-B + sq) / (2 * A)].filter(t => t > 0 && t < 1)
}

const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (a[2] ?? 0.5) + ((b[2] ?? 0.5) - (a[2] ?? 0.5)) * t]

/**
 * Cut a polyline of samples by a circle. Returns null when the circle misses
 * it, else the runs left outside the circle. A run's `cutStart` / `cutEnd` say
 * whether that end was made by the cut (rather than being the stroke's own end).
 */
export function cutPolyline(pts, c, R) {
    const inside = (p) => (p[0] - c.x) ** 2 + (p[1] - c.y) ** 2 < R * R
    const runs = []
    let cur = null
    let touched = false
    const open = (pt, cutStart) => { cur = [pt]; cur.cutStart = cutStart }
    const close = (cutEnd) => { if (cur) { cur.cutEnd = cutEnd; runs.push(cur); cur = null } }

    let ins = inside(pts[0])
    if (ins) touched = true
    else open(pts[0], false)
    for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i]
        for (const t of crossings(a, b, c, R)) {
            touched = true
            const q = lerp(a, b, t)
            if (ins) { open(q, true); ins = false } else { cur.push(q); close(true); ins = true }
        }
        const bi = inside(b)
        if (bi !== ins) {   // grazing / rounding: trust the endpoint test
            touched = true
            ins = bi
            if (!bi) { open(b, true); continue }
            close(true)
        }
        if (bi) touched = true
        else cur.push(b)
    }
    close(false)
    return touched ? runs : null
}

const pathLength = (run) => {
    let L = 0
    for (let i = 1; i < run.length; i++) L += Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1])
    return L
}

/**
 * Erase the circle (world centre `c`, world radius `radius`) from a stroke.
 * Returns null when the stroke is untouched, else the stroke's replacement
 * pieces as new partial items (no id) — an empty array means it is gone.
 */
export function eraseFromStroke(item, c, radius) {
    if (!canSplit(item) || item.payload?.locked) return null
    // Cheap reject on the rendered box first.
    const box = itemAABB(item)
    if (c.x < box.x - radius || c.x > box.x + box.w + radius || c.y < box.y - radius || c.y > box.y + box.h + radius) return null

    const p = item.payload
    const f = strokeFrame(item)
    const half = (p.options?.size ?? 6) / 2
    // Remove samples within the eraser radius plus the ink's half-width, so the
    // piece's rounded end stops right at the eraser's edge.
    const R = radius / ((f.sx + f.sy) / 2) + half
    const runs = cutPolyline(p.points, toDrawFrame(f, c.x, c.y), R)
    if (!runs) return null

    const pieces = []
    for (const run of runs) {
        if (run.length < 2 || pathLength(run) < Math.max(1, half * 0.5)) continue   // crumbs
        const opts = { ...p.options }
        // A cut end is blunt, not tapered — tapering it would thin the ink right
        // where it meets the gap. (The highlighter is flat-ended already.)
        if (run.cutStart && opts.start?.cap !== false) opts.start = { taper: 0, cap: true }
        if (run.cutEnd && opts.end?.cap !== false) opts.end = { taper: 0, cap: true }
        const points = run.map(q => [q[0], q[1], q[2] ?? 0.5])
        const outline = strokeOutline(points, { ...opts, last: true })
        const b = bounds(outline)
        const bw = b.maxX - b.minX, bh = b.maxY - b.minY
        const w = bw * f.sx, h = bh * f.sy
        // Same mapping as the original stroke: centre offset in the draw frame,
        // scaled and rotated into the world.
        const off = rot((b.minX + bw / 2 - f.ox - f.baseW / 2) * f.sx, (b.minY + bh / 2 - f.oy - f.baseH / 2) * f.sy, f.rotation)
        const cx = f.cx + off.x, cy = f.cy + off.y
        pieces.push({
            type: 'stroke', x: cx - w / 2, y: cy - h / 2, w, h, rotation: f.rotation, z_index: item.z_index,
            payload: {
                ...p,
                flatOutline: outline.map((v, i) => v - (i % 2 === 0 ? b.minX : b.minY)),
                points, options: opts, baseW: bw, baseH: bh,
            },
        })
    }
    return pieces
}
