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
    const targetsX = []
    const targetsY = []
    for (const it of otherItems) {
        const b = itemAABB(it)
        targetsX.push(...xLines(b))
        targetsY.push(...yLines(b))
    }

    const best = (movingLines, targets) => {
        let bestDelta = 0
        let bestDist = threshold + 1
        let bestPos = null
        for (const m of movingLines) {
            // nearest other-item line
            for (const t of targets) {
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

    const sx = best(xLines(movingAABB), targetsX)
    const sy = best(yLines(movingAABB), targetsY)

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
