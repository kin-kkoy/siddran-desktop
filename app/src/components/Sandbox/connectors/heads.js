/**
 * Connector end markers (spec §9.8.2) as plain geometry, so the Konva layer and
 * the note SVG draw identical heads from one definition.
 *
 *   none · arrow (filled, the default) · open (chevron) · triangle (hollow)
 *   circle (filled dot) · diamond (hollow) · bar (perpendicular tick)
 *
 * `head` is the end marker — the key siddran-cli already writes. `headStart` is
 * new and optional (absent = none).
 */
export const HEAD_TYPES = ['none', 'arrow', 'open', 'triangle', 'circle', 'diamond', 'bar']
export const HEAD_LABELS = {
    none: 'None', arrow: 'Arrow', open: 'Open arrow', triangle: 'Triangle',
    circle: 'Dot', diamond: 'Diamond', bar: 'Bar',
}

export const headSize = (strokeWidth = 2) => 8 + strokeWidth * 2

/** How far the line itself should stop short of the tip, so it never pokes through. */
export function headInset(type, strokeWidth = 2) {
    const L = headSize(strokeWidth)
    if (type === 'arrow' || type === 'triangle') return L * 0.9
    if (type === 'diamond') return L * 1.6
    if (type === 'circle') return L * 0.35
    return 0
}

/**
 * Geometry of one head at `tip`, pointing away from `prev` (the previous path
 * point). Returns null for 'none' / unknown, else
 *   { shape: 'poly', pts: [x,y,...], closed, filled }
 *   { shape: 'circle', cx, cy, r, filled }
 */
export function headGeometry(type, tip, prev, strokeWidth = 2) {
    if (!type || type === 'none' || !HEAD_TYPES.includes(type)) return null
    const dx = tip.x - prev.x, dy = tip.y - prev.y
    const len = Math.hypot(dx, dy) || 1
    const ux = dx / len, uy = dy / len        // along the line, toward the tip
    const nx = -uy, ny = ux                   // normal
    const L = headSize(strokeWidth)
    const W = L * 0.55
    const at = (along, across) => [tip.x - ux * along + nx * across, tip.y - uy * along + ny * across]
    switch (type) {
        case 'arrow': return { shape: 'poly', pts: [tip.x, tip.y, ...at(L, W), ...at(L, -W)], closed: true, filled: true }
        case 'triangle': return { shape: 'poly', pts: [tip.x, tip.y, ...at(L, W), ...at(L, -W)], closed: true, filled: false }
        case 'open': return { shape: 'poly', pts: [...at(L, W), tip.x, tip.y, ...at(L, -W)], closed: false, filled: false }
        case 'diamond': return { shape: 'poly', pts: [tip.x, tip.y, ...at(L * 0.8, W * 0.8), ...at(L * 1.6, 0), ...at(L * 0.8, -W * 0.8)], closed: true, filled: false }
        case 'circle': { const r = L * 0.35; const [cx, cy] = at(r, 0); return { shape: 'circle', cx, cy, r, filled: true } }
        case 'bar': return { shape: 'poly', pts: [...at(0, W * 1.1), ...at(0, -W * 1.1)], closed: false, filled: false }
        default: return null
    }
}

/** The path's two ends as {tip, prev} pairs (prev = the neighbouring point). */
export function pathEnds(points) {
    const n = points.length
    if (n < 4) return null
    return {
        start: { tip: { x: points[0], y: points[1] }, prev: { x: points[2], y: points[3] } },
        end: { tip: { x: points[n - 2], y: points[n - 1] }, prev: { x: points[n - 4], y: points[n - 3] } },
    }
}

/** Shorten a flat polyline by `a` at its start and `b` at its end (heads sit in the gap). */
export function trimPath(points, a, b) {
    const pts = points.slice()
    const n = pts.length
    if (n < 4) return pts
    const pull = (i, j, d) => {   // move point i toward point j by d (clamped to the segment)
        const dx = pts[j] - pts[i], dy = pts[j + 1] - pts[i + 1]
        const len = Math.hypot(dx, dy)
        if (!len || !d) return
        const t = Math.min(d, len - 0.5) / len
        if (t <= 0) return
        pts[i] += dx * t; pts[i + 1] += dy * t
    }
    pull(0, 2, a)
    pull(n - 2, n - 4, b)
    return pts
}
