/**
 * Move-time snapping: nudges a dragged selection so its edges/centres line up
 * with the grid or with other items' edges/centres (Figma-style guides).
 *
 * The caller works in WORLD units and supplies a zoom-aware threshold so the
 * "magnet" feels constant on screen regardless of zoom. We snap on each axis
 * independently, picking the nearest within-threshold target, and return the
 * extra { dx, dy } to add to the in-progress move plus the guide lines to draw.
 */
import { itemAABB } from './hitTest'

// Candidate snap lines for one axis of an AABB: near edge, centre, far edge.
const xLines = (b) => [b.x, b.x + b.w / 2, b.x + b.w]
const yLines = (b) => [b.y, b.y + b.h / 2, b.y + b.h]

/**
 * @param movingAABB  axis-aligned box of the selection at its dragged position
 * @param otherItems  every item NOT in the selection (snap targets)
 * @param gridSize    world units between grid snap lines (0 disables grid snap)
 * @param threshold   max world distance to snap
 * @returns { dx, dy, guides:[{type:'v'|'h', pos}] }
 */
export function computeSnap(movingAABB, otherItems, gridSize, threshold) {
    return computeSnapTo(movingAABB, snapTargets(otherItems), gridSize, threshold)
}

/**
 * Snap targets, built ONCE per gesture: every edge and centre line of
 * `items`, sorted, so each frame finds the nearest with a binary search
 * instead of re-measuring every item on the board.
 */
export function snapTargets(items) {
    const { xs, ys } = snapLines(items)
    return { xs: Float64Array.from(xs).sort(), ys: Float64Array.from(ys).sort() }
}

/** The value in sorted `arr` nearest to `v` (or null when empty). */
function nearest(arr, v) {
    let lo = 0, hi = arr.length - 1
    if (hi < 0) return null
    while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (arr[mid] < v) lo = mid + 1; else hi = mid
    }
    const a = arr[lo], b = lo > 0 ? arr[lo - 1] : a
    return Math.abs(a - v) <= Math.abs(b - v) ? a : b
}

/** computeSnap against prebuilt targets (snapTargets). */
export function computeSnapTo(movingAABB, targets, gridSize, threshold) {
    const best = (movingLines, sorted) => {
        let bestDelta = 0
        let bestDist = threshold + 1
        let bestPos = null
        for (const m of movingLines) {
            // nearest other-item line
            const t = nearest(sorted, m)
            if (t != null) {
                const dist = Math.abs(t - m)
                if (dist < bestDist) { bestDist = dist; bestDelta = t - m; bestPos = t }
            }
            // nearest grid line
            if (gridSize > 0) {
                const g = Math.round(m / gridSize) * gridSize
                const dist = Math.abs(g - m)
                if (dist < bestDist) { bestDist = dist; bestDelta = g - m; bestPos = g }
            }
        }
        return bestDist <= threshold ? { delta: bestDelta, pos: bestPos } : null
    }

    const sx = best(xLines(movingAABB), targets.xs)
    const sy = best(yLines(movingAABB), targets.ys)

    const guides = []
    if (sx) guides.push({ type: 'v', pos: sx.pos })
    if (sy) guides.push({ type: 'h', pos: sy.pos })

    return { dx: sx ? sx.delta : 0, dy: sy ? sy.delta : 0, guides }
}

/** Union axis-aligned box of a set of items (world coords). */
export function unionAABB(items) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const it of items) {
        const b = itemAABB(it)
        if (b.x < minX) minX = b.x
        if (b.y < minY) minY = b.y
        if (b.x + b.w > maxX) maxX = b.x + b.w
        if (b.y + b.h > maxY) maxY = b.y + b.h
    }
    if (!isFinite(minX)) return null
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/** Every snap line of `items` (edges and centres) — the targets for a resize. */
export function snapLines(items) {
    const xs = [], ys = []
    for (const it of items) {
        const b = itemAABB(it)
        xs.push(...xLines(b))
        ys.push(...yLines(b))
    }
    return { xs, ys }
}

/**
 * Resize-time snapping for ONE moving edge: the nearest line (another item's
 * edge or centre, or the grid) within `threshold` of `v`. Returns the line, or
 * null when nothing is close enough.
 */
export function snapEdge(v, lines, gridSize, threshold) {
    let best = null, bestDist = threshold
    // Sorted targets (snapTargets): binary search; a plain array: scan it.
    const near = lines instanceof Float64Array ? nearest(lines, v) : null
    for (const t of near != null ? [near] : lines) {
        const dist = Math.abs(t - v)
        if (dist <= bestDist) { bestDist = dist; best = t }
    }
    if (gridSize > 0) {
        const g = Math.round(v / gridSize) * gridSize
        if (Math.abs(g - v) < bestDist || (best == null && Math.abs(g - v) <= threshold)) best = g
    }
    return best
}

/** Items worth snapping to: those meeting `rect` (the visible board, plus a margin). */
export function inView(items, rect) {
    if (!rect) return items
    return items.filter(it => {
        const b = itemAABB(it)
        return b.x <= rect.x + rect.w && b.x + b.w >= rect.x && b.y <= rect.y + rect.h && b.y + b.h >= rect.y
    })
}
