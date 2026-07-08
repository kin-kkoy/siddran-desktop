/**
 * Connector geometry — pure functions shared by the render layer, the live drag
 * preview, and hit-testing. A connector links two shapes (or a shape and a free
 * point); its path is resolved from the *current* item boxes every render, so it
 * reroutes automatically when a referenced shape moves.
 *
 * All coordinates are WORLD space. `byId` is a Map<id, item>.
 */
import { getItemBounds, getOrientedAnchors, rotatePoint } from '../selection/itemBounds'

export const SIDES = ['n', 'e', 's', 'w']

/**
 * The side of `item` that faces `towardPoint` — the dominant axis of the
 * (rotation-corrected) direction from the box centre to the point, normalized by
 * the half-extents. Unlike "nearest anchor to cursor" this never ties to the top
 * on a centred drop, so connectors attach on the facing edge and look right.
 */
export function facingSide(item, towardPoint) {
    const b = getItemBounds(item)
    const cx = b.x + b.w / 2
    const cy = b.y + b.h / 2
    const r = rotatePoint(towardPoint.x, towardPoint.y, cx, cy, -(b.rotation || 0))
    const ax = Math.abs(r.x - cx) / (b.w / 2 || 1)
    const ay = Math.abs(r.y - cy) / (b.h / 2 || 1)
    if (ax >= ay) return (r.x - cx) >= 0 ? 'e' : 'w'
    return (r.y - cy) >= 0 ? 's' : 'n'
}

/**
 * Resolve one endpoint to a world point. `{itemId, side}` → that side's anchor on
 * the live item box; `{point}` → the free point. Returns null if a referenced
 * item no longer exists (caller drops the connector for this frame).
 */
export function endpointWorld(end, byId) {
    if (!end) return null
    if (end.itemId != null) {
        const item = byId.get(end.itemId)
        if (!item) return null
        const anchors = getOrientedAnchors(getItemBounds(item))
        return anchors[end.side] || anchors.center
    }
    if (end.point) return { x: end.point.x, y: end.point.y }
    return null
}

/** Nearest of the 4 side anchors (n/e/s/w) of an item to a world point. */
export function nearestSide(item, worldPt) {
    const anchors = getOrientedAnchors(getItemBounds(item))
    let best = 'n'
    let bestD = Infinity
    for (const s of SIDES) {
        const a = anchors[s]
        const dx = a.x - worldPt.x
        const dy = a.y - worldPt.y
        const d = dx * dx + dy * dy
        if (d < bestD) { bestD = d; best = s }
    }
    return best
}

/**
 * Route a path from a→b as flat world points [x,y,x,y,...].
 * straight = the two points; elbow = a single orthogonal dog-leg through the
 * midpoint of the dominant axis (H-V-H when mostly horizontal, V-H-V otherwise).
 */
export function routeConnector(a, b, routing = 'elbow') {
    if (routing === 'straight') return [a.x, a.y, b.x, b.y]
    const dx = b.x - a.x
    const dy = b.y - a.y
    if (Math.abs(dx) >= Math.abs(dy)) {
        const mx = (a.x + b.x) / 2
        return [a.x, a.y, mx, a.y, mx, b.y, b.x, b.y]
    }
    const my = (a.y + b.y) / 2
    return [a.x, a.y, a.x, my, b.x, my, b.x, b.y]
}

/** Resolve a committed connector to flat world points, or null if unresolved. */
export function connectorPoints(conn, byId) {
    const p = conn.payload || {}
    const a = endpointWorld(p.from, byId)
    const b = endpointWorld(p.to, byId)
    if (!a || !b) return null
    return routeConnector(a, b, p.routing || 'elbow')
}

/** Squared distance from point (px,py) to segment (ax,ay)-(bx,by). */
function distSqToSegment(px, py, ax, ay, bx, by) {
    const vx = bx - ax, vy = by - ay
    const wx = px - ax, wy = py - ay
    const len2 = vx * vx + vy * vy
    let t = len2 ? (wx * vx + wy * vy) / len2 : 0
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const cx = ax + t * vx, cy = ay + t * vy
    const dx = px - cx, dy = py - cy
    return dx * dx + dy * dy
}

/** True if (wx,wy) is within `tol` world-units of the connector polyline. */
export function connectorHitTest(points, wx, wy, tol) {
    if (!points || points.length < 4) return false
    const tol2 = tol * tol
    for (let i = 0; i < points.length - 2; i += 2) {
        if (distSqToSegment(wx, wy, points[i], points[i + 1], points[i + 2], points[i + 3]) <= tol2) {
            return true
        }
    }
    return false
}

/** Midpoint of a connector polyline (along its length) — for the context bar. */
export function connectorMidpoint(points) {
    if (!points || points.length < 4) return null
    // total length, then walk to the half-length point
    let total = 0
    const segs = []
    for (let i = 0; i < points.length - 2; i += 2) {
        const dx = points[i + 2] - points[i]
        const dy = points[i + 3] - points[i + 1]
        const len = Math.hypot(dx, dy)
        segs.push(len)
        total += len
    }
    let target = total / 2
    for (let i = 0, s = 0; i < points.length - 2; i += 2, s++) {
        if (target <= segs[s] || s === segs.length - 1) {
            const t = segs[s] ? target / segs[s] : 0
            return { x: points[i] + (points[i + 2] - points[i]) * t, y: points[i + 1] + (points[i + 3] - points[i + 1]) * t }
        }
        target -= segs[s]
    }
    return { x: points[0], y: points[1] }
}
