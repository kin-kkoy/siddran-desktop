/**
 * Handles for a selected line-type SHAPE (line, arrow, elbow arrow, divider,
 * tapered arrow): one at each end, plus a middle one that bends a line or
 * arrow into a curve. Replaces the box's resize/rotate handles for these, so
 * a line is edited by its ends, never by a bounding box.
 *
 * A line shape stores `payload.points` (flat, local to its box) and
 * `baseW/baseH` (the box size those points were written for); the renderer
 * scales them by w/baseW and rotates about the centre. An edit is made in
 * world space and written back with the box re-fitted to the points and the
 * rotation folded in (rotation 0).
 */
const HAS_MIDDLE = new Set(['line', 'arrow'])
export const hasBendHandle = (kind) => HAS_MIDDLE.has(kind)

const rot = (x, y, deg) => {
    if (!deg) return { x, y }
    const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
    return { x: x * c - y * s, y: x * s + y * c }
}

/** The shape's points in world coordinates: [{x,y}, …]. */
export function lineWorldPoints(item) {
    const p = item.payload || {}
    const w = item.w ?? 1, h = item.h ?? 1
    const baseW = p.baseW || w || 1, baseH = p.baseH || h || 1
    const flat = p.points && p.points.length >= 4 ? p.points : [0, 0, baseW, baseH]
    const sx = w / baseW, sy = h / baseH
    const cx = item.x + w / 2, cy = item.y + h / 2
    const out = []
    for (let i = 0; i + 1 < flat.length; i += 2) {
        const r = rot((flat[i] - baseW / 2) * sx, (flat[i + 1] - baseH / 2) * sy, item.rotation || 0)
        out.push({ x: cx + r.x, y: cy + r.y })
    }
    return out
}

/** Item patch that makes the shape pass through these world points. */
export function patchFromWorldPoints(item, pts, extra = {}) {
    const r = (v) => Math.round(v * 100) / 100
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const q of pts) {
        minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x)
        minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y)
    }
    const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY)
    return {
        x: r(minX), y: r(minY), w: r(w), h: r(h), rotation: 0,
        payload: {
            ...item.payload, ...extra,
            points: pts.flatMap(q => [r(q.x - minX), r(q.y - minY)]),
            baseW: r(w), baseH: r(h),
        },
    }
}

/** Where the handles go: { start, end, mid? } in world coordinates. */
export function lineHandles(item) {
    const pts = lineWorldPoints(item)
    const start = pts[0], end = pts[pts.length - 1]
    if (!hasBendHandle(item.payload?.kind)) return { start, end }
    const mid = pts.length >= 3 ? pts[1] : { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
    return { start, end, mid, curved: pts.length >= 3 }
}

/**
 * Patch for dragging one handle ('start' | 'end' | 'mid') to world point `to`.
 * Elbow arrows keep their right angle; dividers stay horizontal; dragging the
 * middle of a line/arrow curves it through that point.
 */
export function dragLineHandle(item, which, to) {
    const kind = item.payload?.kind
    const pts = lineWorldPoints(item)
    let s = pts[0], e = pts[pts.length - 1]
    if (which === 'start') s = { x: to.x, y: kind === 'divider' ? e.y : to.y }
    if (which === 'end') e = { x: to.x, y: kind === 'divider' ? s.y : to.y }

    if (kind === 'elbowArrow') return patchFromWorldPoints(item, [s, { x: e.x, y: s.y }, e])
    if (hasBendHandle(kind)) {
        if (which === 'mid') return patchFromWorldPoints(item, [s, to, e], { curved: true })
        // Ends move; a curve keeps its middle point where it was.
        return patchFromWorldPoints(item, pts.length >= 3 ? [s, pts[1], e] : [s, e])
    }
    return patchFromWorldPoints(item, [s, e])
}

/** Patch that straightens a curved line/arrow. */
export function straightenLine(item) {
    const pts = lineWorldPoints(item)
    const { curved: _c, ...rest } = item.payload || {}
    return patchFromWorldPoints({ ...item, payload: rest }, [pts[0], pts[pts.length - 1]])
}
