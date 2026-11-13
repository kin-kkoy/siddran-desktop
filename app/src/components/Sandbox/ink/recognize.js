/**
 * Smart drawing (spec §10.4): a rule-based recogniser that turns a rough
 * stroke into a clean shape.
 *
 *  - Open strokes: a straight line, or an arrow (a straight shaft, then a short
 *    head that doubles back near the tip).
 *  - Closed strokes: fitted against ideal outlines inscribed in the stroke's
 *    bounding box — rectangle, ellipse, triangle (point up or down) and diamond.
 *    The score is a symmetric mean distance ("chamfer") between the stroke and
 *    each outline, relative to the box diagonal; the best one under the gate wins.
 *
 * Anything else returns null and the ink stays as drawn.
 */

const N = 64
const CLOSED_GAP = 0.22          // start–end gap, relative to the box diagonal
const LINE_DEV = 0.06            // max off-chord deviation for a straight line
const SHAPE_GATE = 0.045         // max chamfer error for a closed shape
const SNAP_DEG = 8               // straighten lines within this of 0/45/90°
const SQUARE_SNAP = [0.88, 1.14] // w/h band that snaps to a square / circle

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])

function pathLength(pts) {
    let L = 0
    for (let i = 1; i < pts.length; i++) L += dist(pts[i], pts[i - 1])
    return L
}

/** Resample a polyline to `n` points spaced evenly along its length. */
export function resample(pts, n = N) {
    const L = pathLength(pts)
    if (L === 0) return Array.from({ length: n }, () => [pts[0][0], pts[0][1]])
    const step = L / (n - 1)
    const out = [[pts[0][0], pts[0][1]]]
    let acc = 0
    let prev = [pts[0][0], pts[0][1]]
    for (let i = 1; i < pts.length && out.length < n; i++) {
        let cur = [pts[i][0], pts[i][1]]
        let d = dist(prev, cur)
        while (acc + d >= step && out.length < n) {
            const t = (step - acc) / d
            const q = [prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t]
            out.push(q)
            prev = q
            d = dist(prev, cur)
            acc = 0
        }
        acc += d
        prev = cur
    }
    while (out.length < n) out.push([pts[pts.length - 1][0], pts[pts.length - 1][1]])
    return out
}

function bbox(pts) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of pts) {
        if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]
        if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

function segDist(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const L2 = dx * dx + dy * dy
    let t = L2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0
    t = Math.max(0, Math.min(1, t))
    return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t))
}

function polyDist(p, poly, closed) {
    let m = Infinity
    const n = poly.length
    for (let i = 0; i < (closed ? n : n - 1); i++) {
        const d = segDist(p, poly[i], poly[(i + 1) % n])
        if (d < m) m = d
    }
    return m
}

// Max perpendicular distance from the chord a→b, over the chord's length.
function chordDeviation(pts, a, b) {
    const L = dist(a, b)
    if (L === 0) return Infinity
    let m = 0
    for (const p of pts) m = Math.max(m, segDist(p, a, b))
    return m / L
}

// Ideal outlines inscribed in box b, as closed polygons.
function ellipsePoly(b, n = 72) {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2
    return Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2
        return [cx + Math.cos(a) * b.w / 2, cy + Math.sin(a) * b.h / 2]
    })
}
const CANDIDATES = {
    rect: (b) => [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]],
    ellipse: (b) => ellipsePoly(b),
    triangle: (b) => [[b.x + b.w / 2, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]],
    triangleDown: (b) => [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w / 2, b.y + b.h]],
    rhombus: (b) => [[b.x + b.w / 2, b.y], [b.x + b.w, b.y + b.h / 2], [b.x + b.w / 2, b.y + b.h], [b.x, b.y + b.h / 2]],
}

// Spread a polygon's outline into evenly spaced samples (for the reverse pass).
function sampleOutline(poly, n = 64) {
    return resample([...poly, poly[0]], n)
}

/** Symmetric mean distance between the stroke and an ideal outline. */
export function chamfer(stroke, poly) {
    let a = 0
    for (const p of stroke) a += polyDist(p, poly, true)
    const ideal = sampleOutline(poly)
    let b = 0
    for (const q of ideal) b += polyDist(q, stroke, true)
    return (a / stroke.length + b / ideal.length) / 2
}

function snapAngle(a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const len = Math.hypot(dx, dy)
    const ang = Math.atan2(dy, dx)
    const step = Math.PI / 4
    const snapped = Math.round(ang / step) * step
    if (Math.abs(ang - snapped) > (SNAP_DEG * Math.PI) / 180) return b
    return [a[0] + Math.cos(snapped) * len, a[1] + Math.sin(snapped) * len]
}

/**
 * Recognise a stroke from its raw samples ([[x, y, pressure?], …], world
 * coordinates). `minSize` is the smallest box diagonal, in world units, worth
 * recognising (pass a zoom-aware value). Returns null, or
 *   { kind: 'line'|'arrow', from: [x,y], to: [x,y], confidence }
 *   { kind: 'rect'|'ellipse'|'triangle'|'rhombus', x, y, w, h, rotation, confidence }
 */
export function recognizeStroke(points, { minSize = 16 } = {}) {
    if (!points || points.length < 3) return null
    const raw = points.map(p => [p[0], p[1]])
    const box = bbox(raw)
    const D = Math.hypot(box.w, box.h)
    if (D < minSize) return null
    const pts = resample(raw)
    const L = pathLength(pts)
    const start = pts[0], end = pts[pts.length - 1]
    const closed = dist(start, end) < CLOSED_GAP * D && L > 2 * D * 0.9

    if (!closed) {
        // Arrow: the tip is the sample farthest from the start; before it a
        // straight shaft, after it a short head that turns back near the tip.
        let k = 0, far = 0
        pts.forEach((p, i) => { const d = dist(p, start); if (d > far) { far = d; k = i } })
        if (k > 8 && k < pts.length - 3) {
            const shaft = pts.slice(0, k + 1)
            const head = pts.slice(k)
            const shaftLen = dist(start, pts[k])
            const headLen = pathLength(head)
            const headNearTip = head.every(p => dist(p, pts[k]) < 0.45 * shaftLen)
            const dev = chordDeviation(shaft, start, pts[k])
            if (dev < 0.08 && headLen > 0.1 * shaftLen && headLen < 0.9 * shaftLen && headNearTip) {
                return { kind: 'arrow', from: start, to: snapAngle(start, pts[k]), confidence: 1 - dev / 0.08 }
            }
        }
        const dev = chordDeviation(pts, start, end)
        if (dev < LINE_DEV) return { kind: 'line', from: start, to: snapAngle(start, end), confidence: 1 - dev / LINE_DEV }
        return null
    }

    let best = null
    for (const [name, make] of Object.entries(CANDIDATES)) {
        const err = chamfer(pts, make(box)) / D
        if (!best || err < best.err) best = { name, err }
    }
    if (!best || best.err > SHAPE_GATE) return null

    let { x, y, w, h } = box
    if ((best.name === 'rect' || best.name === 'ellipse') && w / h > SQUARE_SNAP[0] && w / h < SQUARE_SNAP[1]) {
        const s = Math.max(w, h)
        x -= (s - w) / 2; y -= (s - h) / 2; w = s; h = s
    }
    const down = best.name === 'triangleDown'
    return {
        kind: down ? 'triangle' : best.name, x, y, w, h, rotation: down ? 180 : 0,
        confidence: 1 - best.err / SHAPE_GATE,
    }
}

/**
 * Build the shape item (partial, no id / z) that replaces a recognised stroke.
 * `style` is { stroke, strokeWidth, fill }. `sourceInk` is kept on the shape so
 * it can be turned back into the drawing.
 */
export function shapeFromRecognition(rec, style, sourceInk) {
    const r = (v) => Math.round(v * 100) / 100
    if (rec.kind === 'line' || rec.kind === 'arrow') {
        const [x0, y0] = rec.from, [x1, y1] = rec.to
        const minX = Math.min(x0, x1), minY = Math.min(y0, y1)
        const w = Math.max(1, Math.abs(x1 - x0)), h = Math.max(1, Math.abs(y1 - y0))
        return {
            type: 'shape', x: r(minX), y: r(minY), w: r(w), h: r(h), rotation: 0,
            payload: {
                kind: rec.kind, stroke: style.stroke, strokeWidth: style.strokeWidth,
                points: [r(x0 - minX), r(y0 - minY), r(x1 - minX), r(y1 - minY)],
                baseW: r(w), baseH: r(h), sourceInk,
            },
        }
    }
    return {
        type: 'shape', x: r(rec.x), y: r(rec.y), w: r(Math.max(1, rec.w)), h: r(Math.max(1, rec.h)), rotation: rec.rotation || 0,
        payload: { kind: rec.kind, fill: style.fill ?? 'transparent', stroke: style.stroke, strokeWidth: style.strokeWidth, radius: 0, sourceInk },
    }
}
