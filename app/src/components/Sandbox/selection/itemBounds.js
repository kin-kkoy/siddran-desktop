/**
 * Geometry helpers that let ONE transform/selection system work over both
 * render worlds (Konva graphics + DOM cards). Every item reduces to an oriented
 * world-space box `{ x, y, w, h, rotation }` (rotation in degrees, Konva-style).
 *
 * The transform overlay reads these boxes and never cares whether the item
 * draws in Konva or the DOM.
 */

// Fallback sizes for items that somehow lack w/h (legacy data).
const CARD_DEFAULT_W = 200
const CARD_DEFAULT_H = 90

const DEG = Math.PI / 180

export function rotatePoint(px, py, cx, cy, deg) {
    if (!deg) return { x: px, y: py }
    const a = deg * DEG
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    const dx = px - cx
    const dy = py - cy
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
}

// Max extent of a bbox-relative flat outline ([x,y,x,y,...]). The outline is
// already offset so its min corner sits at (0,0), so the max IS the size.
function outlineSize(flat) {
    let w = 0, h = 0
    if (!flat) return { w, h }
    for (let i = 0; i < flat.length; i += 2) {
        if (flat[i] > w) w = flat[i]
        if (flat[i + 1] > h) h = flat[i + 1]
    }
    return { w, h }
}

/**
 * Oriented world-space bounds for a single item. Every item stores its RENDER
 * size in item.w/item.h, so this is uniform. Strokes additionally keep their
 * base outline size in payload.baseW/baseH (the renderer scales by w/baseW);
 * we only fall back to the outline extent for legacy items missing w/h.
 */
export function getItemBounds(item) {
    const rotation = item.rotation || 0
    let w = item.w
    let h = item.h
    if (w == null || h == null) {
        if (item.type === 'stroke') {
            const s = outlineSize(item.payload?.flatOutline)
            w = w ?? s.w
            h = h ?? s.h
        } else {
            w = w ?? CARD_DEFAULT_W
            h = h ?? CARD_DEFAULT_H
        }
    }
    return { x: item.x, y: item.y, w, h, rotation }
}

export function boxCenter(box) {
    return { x: box.x + box.w / 2, y: box.y + box.h / 2 }
}

/**
 * The 8 transform anchors + center of an oriented box, in WORLD coords (already
 * rotated). Keys: nw n ne e se s sw w center. Edge order is clockwise from NW.
 */
export function getOrientedAnchors(box) {
    const cx = box.x + box.w / 2
    const cy = box.y + box.h / 2
    const hw = box.w / 2
    const hh = box.h / 2
    const local = {
        nw: [-hw, -hh], n: [0, -hh], ne: [hw, -hh],
        e: [hw, 0], se: [hw, hh], s: [0, hh],
        sw: [-hw, hh], w: [-hw, 0], center: [0, 0],
    }
    const out = {}
    for (const k in local) {
        out[k] = rotatePoint(cx + local[k][0], cy + local[k][1], cx, cy, box.rotation)
    }
    return out
}

/** Unit "up" vector of a box (points from center toward the top edge). */
export function boxUpVector(box) {
    const a = (box.rotation || 0) * DEG
    return { x: Math.sin(a), y: -Math.cos(a) }
}

/**
 * Selection bounds. Single item → its own oriented box (handles rotate with it).
 * Multi → axis-aligned union of every item's rotated corners (rotation 0).
 */
export function getSelectionBounds(items) {
    if (!items || items.length === 0) return null
    if (items.length === 1) return getItemBounds(items[0])

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const item of items) {
        const a = getOrientedAnchors(getItemBounds(item))
        for (const k of ['nw', 'ne', 'se', 'sw']) {
            const p = a[k]
            if (p.x < minX) minX = p.x
            if (p.y < minY) minY = p.y
            if (p.x > maxX) maxX = p.x
            if (p.y > maxY) maxY = p.y
        }
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, rotation: 0 }
}
