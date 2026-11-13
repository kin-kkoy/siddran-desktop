/**
 * A free-standing line/arrow SHAPE made into a real connector.
 *
 * Arrows drawn with the line tools (kind line / arrow / elbowArrow) are shapes
 * with two loose ends: they don't follow the boxes they point at, and they
 * can't be straight / elbow / curved. Picking a routing on one turns it into a
 * connector with that routing. Each end that touches a box attaches to the
 * side it touches; an end in empty space stays a free point. The colour,
 * width, line style and arrowhead are kept.
 */
import { lineWorldPoints } from '../selection/lineHandles'
import { getItemBounds } from '../selection/itemBounds'
import { isLineKind } from '../shapes/registry'
import { isFrame } from '../frames/frames'
import { isFormat } from '../formats/formats'

// How far (board units) an end may sit from a box's border and still count as
// touching it: hand-drawn arrows stop a little short or run a little in.
const TOUCH = 14

const DEG = Math.PI / 180

// Distance from a point to a box's border, and the side (n/e/s/w) it is
// nearest — in the box's own (unrotated) frame.
function borderDistance(item, pt) {
    const b = getItemBounds(item)
    const w = Math.abs(b.w), h = Math.abs(b.h)
    const cx = b.x + w / 2, cy = b.y + h / 2
    const a = -(b.rotation || 0) * DEG
    const dx = pt.x - cx, dy = pt.y - cy
    const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a)
    const hw = w / 2, hh = h / 2
    const ox = Math.abs(lx) - hw, oy = Math.abs(ly) - hh
    const dist = (ox > 0 || oy > 0) ? Math.hypot(Math.max(ox, 0), Math.max(oy, 0)) : Math.min(-ox, -oy)
    // Which edge: the one whose line the point is closest to.
    const edges = { n: Math.abs(ly + hh), s: Math.abs(ly - hh), w: Math.abs(lx + hw), e: Math.abs(lx - hw) }
    const side = Object.keys(edges).reduce((m, k) => (edges[k] < edges[m] ? k : m), 'n')
    return { dist, side, area: w * h }
}

const attachable = (it) => it.type === 'shape' && !isLineKind(it.payload?.kind) && !isFrame(it) && !isFormat(it)

/** The end of a connector at world point `pt`: the box it touches, else a free point. */
export function endAt(pt, items, excludeId = null, tol = TOUCH) {
    let best = null
    for (const it of items) {
        if (it.id === excludeId || !attachable(it)) continue
        const d = borderDistance(it, pt)
        if (d.dist > tol) continue
        // Nearest border wins; on a tie the smaller box (a box inside a big
        // container touches both near the shared edge — it's the inner one).
        if (!best || d.dist < best.dist - 0.5 || (Math.abs(d.dist - best.dist) <= 0.5 && d.area < best.area)) best = { ...d, id: it.id }
    }
    return best ? { itemId: best.id, side: best.side } : { point: { x: Math.round(pt.x * 100) / 100, y: Math.round(pt.y * 100) / 100 } }
}

/** A connector item (no id/z) that replaces line shape `item`, with `routing`. */
export function connectorFromLine(item, items, routing) {
    const p = item.payload || {}
    const pts = lineWorldPoints(item)
    const start = pts[0], end = pts[pts.length - 1]
    const kind = p.kind
    const payload = {
        from: endAt(start, items, item.id),
        to: endAt(end, items, item.id),
        routing,
        head: kind === 'line' || kind === 'divider' ? 'none' : 'arrow',
        headStart: 'none',
        stroke: p.stroke || '#e2ddf5',
        strokeWidth: p.strokeWidth || 2,
    }
    if (p.lineStyle) payload.lineStyle = p.lineStyle
    if (p.dash || (p.lineStyle && p.lineStyle !== 'solid')) payload.dash = true
    return { type: 'connector', x: 0, y: 0, w: 0, h: 0, rotation: 0, payload }
}

/** Can this shape become a connector? (Tapered arrows draw a body of their own.) */
export const convertibleLine = (it) => it?.type === 'shape' && ['line', 'arrow', 'elbowArrow'].includes(it.payload?.kind)
