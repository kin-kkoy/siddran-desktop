/**
 * Pointer hit-testing in WORLD space, shared by the pointer-tool selection and
 * the eraser. Works for both render worlds because everything reduces to the
 * oriented box from getItemBounds (plus a precise polygon pass for strokes).
 */
import { getItemBounds, getOrientedAnchors, rotatePoint } from './itemBounds'

/** Point inside an oriented box (rotation about the box centre). */
export function pointInOrientedBox(px, py, box, pad = 0) {
    const cx = box.x + box.w / 2
    const cy = box.y + box.h / 2
    const r = rotatePoint(px, py, cx, cy, -(box.rotation || 0))
    return (
        r.x >= box.x - pad && r.x <= box.x + box.w + pad &&
        r.y >= box.y - pad && r.y <= box.y + box.h + pad
    )
}

// Even-odd ray cast against a flat [x,y,x,y,...] closed polygon.
export function pointInPolygon(flat, x, y) {
    if (!flat || flat.length < 6) return false
    let inside = false
    const n = flat.length / 2
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = flat[i * 2], yi = flat[i * 2 + 1]
        const xj = flat[j * 2], yj = flat[j * 2 + 1]
        const intersect = ((yi > y) !== (yj > y)) &&
            (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
        if (intersect) inside = !inside
    }
    return inside
}

/** Precise stroke hit: oriented-box reject, then polygon test in local space. */
export function strokeHitTest(item, wx, wy) {
    const box = getItemBounds(item)
    if (!pointInOrientedBox(wx, wy, box, 2)) return false
    const p = item.payload || {}
    const baseW = p.baseW ?? box.w
    const baseH = p.baseH ?? box.h
    const sx = baseW ? box.w / baseW : 1
    const sy = baseH ? box.h / baseH : 1
    const cx = box.x + box.w / 2
    const cy = box.y + box.h / 2
    const r = rotatePoint(wx, wy, cx, cy, -(box.rotation || 0)) // un-rotate
    const lx = (r.x - item.x) / sx
    const ly = (r.y - item.y) / sy
    return pointInPolygon(p.flatOutline, lx, ly)
}

/** Generic hit: strokes get the precise path test, everything else the box. */
export function itemHitTest(item, wx, wy, pad = 0) {
    if (item.type === 'stroke') return strokeHitTest(item, wx, wy)
    return pointInOrientedBox(wx, wy, getItemBounds(item), pad)
}

/** Axis-aligned bbox of an item (covers its rotated extent). */
export function itemAABB(item) {
    const a = getOrientedAnchors(getItemBounds(item))
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const k of ['nw', 'ne', 'se', 'sw']) {
        const pt = a[k]
        if (pt.x < minX) minX = pt.x
        if (pt.y < minY) minY = pt.y
        if (pt.x > maxX) maxX = pt.x
        if (pt.y > maxY) maxY = pt.y
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/** Marquee rect (normalised, world coords) vs item — AABB overlap. */
export function marqueeIntersects(item, rect) {
    const b = itemAABB(item)
    return !(
        b.x > rect.x + rect.w ||
        b.x + b.w < rect.x ||
        b.y > rect.y + rect.h ||
        b.y + b.h < rect.y
    )
}

/** Normalise a drag (start→current) into a positive-size rect. */
export function normalizeRect(x0, y0, x1, y1) {
    return {
        x: Math.min(x0, x1),
        y: Math.min(y0, y1),
        w: Math.abs(x1 - x0),
        h: Math.abs(y1 - y0),
    }
}
