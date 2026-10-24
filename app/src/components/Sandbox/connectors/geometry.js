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
 *
 * straight = the two points. elbow = orthogonal segments. With the endpoint
 * SIDES known (a connector between two boxes), the line leaves each box
 * perpendicular to the side it is attached to and arrives the same way — out of
 * the bottom of one box and into the top of the next, the way a flowchart is
 * drawn. Without sides (a free end, the live drag preview) it falls back to a
 * single dog-leg through the midpoint of the dominant axis.
 *
 * `ends` = { fromSide, toSide, fromBox, toBox, obstacles } — boxes are {x,y,w,h}.
 * They only matter when a link has to go round (a loop back to an earlier step,
 * or both ends facing the same way): then the line clears the two boxes it joins
 * AND anything else in the band it travels through. `obstacles` is a function,
 * so the other boxes are only gathered for the few links that need them.
 */
export function routeConnector(a, b, routing = 'elbow', ends = {}) {
    if (routing === 'straight') return [a.x, a.y, b.x, b.y]
    const da = DIRS[ends.fromSide], db = DIRS[ends.toSide]
    if (!da || !db) return dogLeg(a, b)
    return flat(simplify(orthogonal(a, da, b, db, ends.fromBox, ends.toBox, ends.obstacles)))
}

function dogLeg(a, b) {
    const dx = b.x - a.x
    const dy = b.y - a.y
    if (Math.abs(dx) >= Math.abs(dy)) {
        const mx = (a.x + b.x) / 2
        return [a.x, a.y, mx, a.y, mx, b.y, b.x, b.y]
    }
    const my = (a.y + b.y) / 2
    return [a.x, a.y, a.x, my, b.x, my, b.x, b.y]
}

// Outward direction of each side.
const DIRS = { n: { x: 0, y: -1 }, s: { x: 0, y: 1 }, e: { x: 1, y: 0 }, w: { x: -1, y: 0 } }
// How far a line runs straight out of a box before it may turn.
const STUB = 20

const P = (x, y) => ({ x, y })
const swapP = (p) => p && P(p.y, p.x)
const swapB = (b) => b && { x: b.y, y: b.x, w: b.h, h: b.w }

function orthogonal(a, da, b, db, boxA, boxB, obstacles) {
    const vertA = da.x === 0, vertB = db.x === 0
    if (vertA && vertB) return bothVertical(a, da, b, db, boxA, boxB, obstacles)
    // Both horizontal is the same problem on swapped axes.
    if (!vertA && !vertB) {
        const swapped = obstacles && (() => obstacles().map(swapB))
        return bothVertical(swapP(a), swapP(da), swapP(b), swapP(db), swapB(boxA), swapB(boxB), swapped).map(swapP)
    }
    return mixed(a, da, b, db)
}

// Push an outer coordinate past every box whose span (on the other axis)
// overlaps the stretch a detour runs along — so a loop does not cut a box that
// happens to sit between its two ends. `beyond` is which way "past" is: +1 for
// right/down, -1 for left/up. Works in whichever axes bothVertical is using.
function clearOf(coord, beyond, lo, hi, obstacles) {
    if (!obstacles) return coord
    let c = coord
    for (const o of obstacles()) {
        if (o.y + o.h < lo || o.y > hi) continue
        if (beyond > 0 && o.x + o.w + STUB > c && o.x < c + STUB) c = o.x + o.w + STUB
        if (beyond < 0 && o.x - STUB < c && o.x + o.w > c - STUB) c = o.x - STUB
    }
    return c
}

// Leaving a top/bottom side and arriving at a top/bottom side.
function bothVertical(a, da, b, db, boxA, boxB, obstacles) {
    const a1 = P(a.x, a.y + da.y * STUB)
    const b1 = P(b.x, b.y + db.y * STUB)
    const opposite = da.y === -db.y
    const ahead = (b1.y - a1.y) * da.y >= 0
    if (opposite && ahead) {
        // The ordinary case: down out of one box, across, down into the next.
        const my = (a1.y + b1.y) / 2
        return [a, P(a.x, my), P(b.x, my), b]
    }
    if (!opposite) {
        // Both sides face the same way: a U beyond whichever box sticks out further,
        // and beyond anything else standing in the stretch between them.
        let y = da.y > 0 ? Math.max(a1.y, b1.y) : Math.min(a1.y, b1.y)
        if (obstacles) {
            const sw = (bx) => ({ x: bx.y, y: bx.x, w: bx.h, h: bx.w })
            y = clearOf(y, da.y, Math.min(a.x, b.x), Math.max(a.x, b.x), () => obstacles().map(sw))
        }
        return [a, P(a.x, y), P(b.x, y), b]
    }
    // Arriving from behind (a loop back up to an earlier step). Go round the side:
    // through the gap between the boxes if there is one, else outside both.
    let x
    if (boxA && boxB) {
        const [l, r] = boxA.x <= boxB.x ? [boxA, boxB] : [boxB, boxA]
        if (l.x + l.w + 2 * STUB <= r.x) x = (l.x + l.w + r.x) / 2
        else x = Math.max(boxA.x + boxA.w, boxB.x + boxB.w) + STUB * 1.5
    } else {
        x = Math.max(a.x, b.x) + STUB * 3
    }
    // Only an outside detour can be pushed further out; a gap route stays put.
    const outside = !(boxA && boxB) || x > Math.max(boxA.x + boxA.w, boxB.x + boxB.w)
    if (outside) x = clearOf(x, 1, Math.min(a1.y, b1.y), Math.max(a1.y, b1.y), obstacles)
    return [a, a1, P(x, a1.y), P(x, b1.y), b1, b]
}

// One end on a top/bottom side, the other on a left/right side: an L when the
// corner falls outside both boxes, else out-and-around via the stubs.
function mixed(a, da, b, db) {
    if (da.x === 0) {
        const c = P(a.x, b.y)
        if ((c.y - a.y) * da.y > 0 && (c.x - b.x) * db.x > 0) return [a, c, b]
        const a1 = P(a.x, a.y + da.y * STUB), b1 = P(b.x + db.x * STUB, b.y)
        return [a, a1, P(b1.x, a1.y), b1, b]
    }
    const c = P(b.x, a.y)
    if ((c.x - a.x) * da.x > 0 && (c.y - b.y) * db.y > 0) return [a, c, b]
    const a1 = P(a.x + da.x * STUB, a.y), b1 = P(b.x, b.y + db.y * STUB)
    return [a, a1, P(a1.x, b1.y), b1, b]
}

// Drop repeated points and the middle of any three in a straight line, so an
// arrowhead always sits on a real final segment.
function simplify(pts) {
    const out = []
    for (const p of pts) {
        const last = out[out.length - 1]
        if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue
        if (out.length >= 2) {
            const q = out[out.length - 2]
            const collinear = (Math.abs(q.x - last.x) < 0.01 && Math.abs(last.x - p.x) < 0.01) ||
                (Math.abs(q.y - last.y) < 0.01 && Math.abs(last.y - p.y) < 0.01)
            if (collinear) out.pop()
        }
        out.push(p)
    }
    return out
}

const flat = (pts) => pts.flatMap((p) => [p.x, p.y])

/** Resolve a committed connector to flat world points, or null if unresolved. */
export function connectorPoints(conn, byId) {
    const p = conn.payload || {}
    const a = endpointWorld(p.from, byId)
    const b = endpointWorld(p.to, byId)
    if (!a || !b) return null
    return routeConnector(a, b, p.routing || 'elbow', {
        fromSide: sideOf(p.from, byId),
        toSide: sideOf(p.to, byId),
        fromBox: boxOf(p.from, byId),
        toBox: boxOf(p.to, byId),
        obstacles: () => {
            const out = []
            for (const it of byId.values()) {
                if (it.type === 'connector' || it.type === 'stroke' || it.id === p.from?.itemId || it.id === p.to?.itemId) continue
                out.push(getItemBounds(it))
            }
            return out
        },
    })
}

// A side only steers the route on an unrotated box: on a rotated one "north" no
// longer points up, and the plain dog-leg reads better than a wrong stub.
function sideOf(end, byId) {
    if (end?.itemId == null) return null
    const item = byId.get(end.itemId)
    if (!item || (item.rotation || 0) % 360 !== 0) return null
    return end.side
}
function boxOf(end, byId) {
    if (end?.itemId == null) return null
    const item = byId.get(end.itemId)
    return item ? getItemBounds(item) : null
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

export const LABEL_FONT = 13

/**
 * The pill a connector's label sits in ("yes" / "no" on a decision's branches):
 * centred on the line's midpoint, width estimated rather than measured so a
 * label costs no layout pass. Shared by the canvas and the note SVG so the two
 * draw it identically.
 */
export function labelBox(points, label) {
    const mid = connectorMidpoint(points)
    if (!mid || !label) return null
    const w = Math.max(24, Math.round(label.length * LABEL_FONT * 0.6) + 14)
    const h = LABEL_FONT + 10
    return { x: mid.x - w / 2, y: mid.y - h / 2, w, h }
}
