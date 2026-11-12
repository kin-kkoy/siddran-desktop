import { pointInOrientedBox } from './hitTest'
import { getItemBounds, getOrientedAnchors, boxCenter } from './itemBounds'
import { SIDES } from '../connectors/geometry'

// Connection dots are drawn DOT_OUT screen px outside each edge midpoint
// (SelectionOverlay). Everything here is in SCREEN px and divided by zoom, so
// the feel is the same at any zoom level.
export const DOT_OUT = 14
// The "hitbox" around a shape: inside it, the shape's dots show. Bigger than
// the shape so you can approach a dot from outside without it vanishing.
export const MAGNET_PX = 44
// Within this distance of a dot, the pointer is magnetised to it: the dot
// lights up and a press starts an arrow from it, without hitting it exactly.
export const CATCH_PX = 26
export const DOT_REACH_PX = MAGNET_PX

/** World position of each connection dot of `item` at `zoom`. */
export function dotPositions(item, zoom = 1) {
    const b = getItemBounds(item)
    const a = getOrientedAnchors(b)
    const c = boxCenter(b)
    const out = {}
    for (const side of SIDES) {
        const dx = a[side].x - c.x, dy = a[side].y - c.y
        const len = Math.hypot(dx, dy) || 1
        out[side] = { x: a[side].x + (dx / len) * (DOT_OUT / zoom), y: a[side].y + (dy / len) * (DOT_OUT / zoom) }
    }
    return out
}

/**
 * Which shape shows its dots, and which dot (if any) the pointer is pulled to.
 *   hitId        connectable shape directly under the pointer, or null
 *   current      the currently hovered item, or null
 *   candidates   connectable shapes, topmost first (for the magnet zone)
 *   world, zoom  pointer position and zoom
 *   onOverlay    pointer is over a dot / handle / the floating bar
 * Returns { id, side } — side is null when no dot is magnetised.
 */
export function resolveHover({ hitId = null, current = null, candidates = [], world, zoom = 1, onOverlay = false }) {
    if (onOverlay) return { id: current?.id ?? null, side: null, keepSide: true }
    const z = zoom || 1
    let item = hitId != null ? (candidates.find(c => c.id === hitId) || (current?.id === hitId ? current : null)) : null
    if (!item) {
        // Inside the magnet zone of the current shape, or of any shape (topmost first).
        const pad = MAGNET_PX / z
        if (current && pointInOrientedBox(world.x, world.y, getItemBounds(current), pad)) item = current
        else item = candidates.find(c => pointInOrientedBox(world.x, world.y, getItemBounds(c), pad)) || null
    }
    if (!item) return { id: null, side: null }
    // Magnetise to a dot only from OUTSIDE the shape's body — inside it, a press
    // means "move the shape", not "start an arrow".
    let side = null
    if (!pointInOrientedBox(world.x, world.y, getItemBounds(item), 0)) {
        const dots = dotPositions(item, z)
        let best = Infinity
        for (const s of SIDES) {
            const d = Math.hypot(dots[s].x - world.x, dots[s].y - world.y)
            if (d < best) { best = d; side = s }
        }
        if (best > CATCH_PX / z) side = null
    }
    return { id: item.id, side }
}

/** Id-only form, kept for callers/tests that only need the hovered shape. */
export function nextHoverId({ hitId, current, world, zoom = 1, onOverlay = false }) {
    if (!onOverlay && hitId != null) return hitId
    return resolveHover({ current, candidates: current ? [current] : [], world, zoom, onOverlay }).id
}
