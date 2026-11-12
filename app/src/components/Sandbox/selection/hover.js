import { pointInOrientedBox } from './hitTest'
import { getItemBounds } from './itemBounds'

// Connection dots sit DOT_OUT screen px outside a hovered shape with a DOT_HIT
// hit radius (SelectionOverlay). The hover has to survive the whole trip from
// the shape onto a dot, or the dot unmounts as the pointer reaches it — the bug
// this module exists to prevent.
export const DOT_REACH_PX = 14 + 12 + 6

/**
 * Which shape should show its connection dots after a pointer move.
 *   hitId      the connectable shape directly under the pointer, or null
 *   current    the currently hovered item (or null)
 *   world      pointer in world coords
 *   zoom       viewport zoom
 *   onOverlay  the pointer is over a dot / handle / the context bar
 */
export function nextHoverId({ hitId, current, world, zoom = 1, onOverlay = false }) {
    if (onOverlay) return current?.id ?? null
    if (hitId != null) return hitId
    if (current && pointInOrientedBox(world.x, world.y, getItemBounds(current), DOT_REACH_PX / (zoom || 1))) return current.id
    return null
}
