/**
 * "Go around boxes" for straight and curved links: when the direct path would
 * run through a box, take the shortest way round instead.
 *
 * The classic visibility-graph route: every box is grown by a margin, its four
 * corners become waypoints, and two waypoints can be joined when the segment
 * between them clears every grown box. The shortest chain from start to end
 * (A*, so only the waypoints that matter get looked at) is the path. A curved
 * link takes the same path with its corners rounded off.
 *
 * Boxes are {x, y, w, h}, treated as unrotated. Points are {x, y}; paths are
 * flat [x, y, x, y, …], as everywhere else in connectors/.
 */

const MARGIN = 14              // clearance kept from a box
const STUB = MARGIN + 6        // how far a link runs straight out of its side first
const ROUND = 48               // corner radius for curved links
const CORNER_STEPS = 8

const OUT = { n: { x: 0, y: -1 }, s: { x: 0, y: 1 }, e: { x: 1, y: 0 }, w: { x: -1, y: 0 } }

const grow = (b, m) => ({ x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m })

// Does segment p→q pass through the INSIDE of box b? (Running along its edge,
// or touching a corner, does not count — that is how a path goes round.)
function crosses(p, q, b) {
    const e = 0.5
    const x0 = b.x + e, y0 = b.y + e, x1 = b.x + b.w - e, y1 = b.y + b.h - e
    if (x1 <= x0 || y1 <= y0) return false
    // Liang–Barsky clip of the segment against the shrunken box.
    const dx = q.x - p.x, dy = q.y - p.y
    let t0 = 0, t1 = 1
    for (const [pp, qq] of [[-dx, p.x - x0], [dx, x1 - p.x], [-dy, p.y - y0], [dy, y1 - p.y]]) {
        if (pp === 0) { if (qq < 0) return false; continue }
        const t = qq / pp
        if (pp < 0) { if (t > t1) return false; if (t > t0) t0 = t }
        else { if (t < t0) return false; if (t < t1) t1 = t }
    }
    return t1 - t0 > 1e-6
}

/** Does the flat path `pts` run through the inside of any of `boxes`? */
export function pathHits(pts, boxes) {
    for (let i = 0; i + 3 < pts.length; i += 2) {
        const p = { x: pts[i], y: pts[i + 1] }, q = { x: pts[i + 2], y: pts[i + 3] }
        for (const b of boxes) if (crosses(p, q, b)) return true
    }
    return false
}

const inside = (p, b) => p.x > b.x + 0.5 && p.x < b.x + b.w - 0.5 && p.y > b.y + 0.5 && p.y < b.y + b.h - 0.5

/** The shortest chain of points from `a` to `b` clear of `boxes` (already grown), or null. */
export function shortestAround(a, b, boxes) {
    const pts = [a, b]
    for (const r of boxes) {
        for (const c of [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x, y: r.y + r.h }, { x: r.x + r.w, y: r.y + r.h }]) {
            if (!boxes.some((o) => inside(c, o))) pts.push(c)
        }
    }
    const clear = (i, j) => !boxes.some((r) => crosses(pts[i], pts[j], r))
    const dist = (i, j) => Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)
    const n = pts.length
    const g = new Array(n).fill(Infinity), prev = new Array(n).fill(-1), done = new Array(n).fill(false)
    g[0] = 0
    for (;;) {
        // The open point with the least g + straight-line distance to go.
        let u = -1, best = Infinity
        for (let i = 0; i < n; i++) {
            if (done[i] || g[i] === Infinity) continue
            const f = g[i] + dist(i, 1)
            if (f < best) { best = f; u = i }
        }
        if (u < 0) return null
        if (u === 1) break
        done[u] = true
        for (let v = 0; v < n; v++) {
            if (done[v] || v === u) continue
            const d = g[u] + dist(u, v)
            if (d < g[v] && clear(u, v)) { g[v] = d; prev[v] = u }
        }
    }
    const out = []
    for (let i = 1; i !== -1; i = prev[i]) out.push(pts[i])
    return out.reverse()
}

/** A polyline with its corners rounded off (for curved links), as flat points. */
export function roundCorners(points, radius = ROUND) {
    if (points.length < 3) return points.flatMap((p) => [p.x, p.y])
    const out = [points[0].x, points[0].y]
    for (let i = 1; i < points.length - 1; i++) {
        const p = points[i - 1], c = points[i], q = points[i + 1]
        const l1 = Math.hypot(c.x - p.x, c.y - p.y), l2 = Math.hypot(q.x - c.x, q.y - c.y)
        const r = Math.min(radius, l1 / 2, l2 / 2)
        if (r < 1) { out.push(c.x, c.y); continue }
        const s = { x: c.x + ((p.x - c.x) / l1) * r, y: c.y + ((p.y - c.y) / l1) * r }
        const e = { x: c.x + ((q.x - c.x) / l2) * r, y: c.y + ((q.y - c.y) / l2) * r }
        for (let k = 0; k <= CORNER_STEPS; k++) {
            const t = k / CORNER_STEPS, u = 1 - t
            out.push(
                Math.round((u * u * s.x + 2 * u * t * c.x + t * t * e.x) * 100) / 100,
                Math.round((u * u * s.y + 2 * u * t * c.y + t * t * e.y) * 100) / 100,
            )
        }
    }
    const last = points[points.length - 1]
    out.push(last.x, last.y)
    return out
}

/**
 * `direct` is the link's usual path (straight or curved) from a to b. If it
 * runs through any of `boxes` (which include the link's own two boxes, so it
 * can't cut back through them either), return the shortest way round instead
 * — rounded when `curved`. Otherwise null: the direct path is fine as it is.
 */
export function aroundBoxes(direct, a, b, fromSide, toSide, boxes, curved) {
    // A box holding either end (a frame round the diagram) can't be gone round.
    boxes = boxes.filter((r) => !inside(a, r) && !inside(b, r))
    if (!boxes.length || !pathHits(direct, boxes)) return null
    // Leave and arrive square to the sides, clear of the link's own boxes.
    const a1 = OUT[fromSide] ? { x: a.x + OUT[fromSide].x * STUB, y: a.y + OUT[fromSide].y * STUB } : a
    const b1 = OUT[toSide] ? { x: b.x + OUT[toSide].x * STUB, y: b.y + OUT[toSide].y * STUB } : b
    const grown = boxes.map((r) => grow(r, MARGIN))
    const mid = shortestAround(a1, b1, grown)
    if (!mid) return null
    const chain = [a, ...mid, b].filter((p, i, arr) => i === 0 || p.x !== arr[i - 1].x || p.y !== arr[i - 1].y)
    return curved ? roundCorners(chain) : chain.flatMap((p) => [p.x, p.y])
}
