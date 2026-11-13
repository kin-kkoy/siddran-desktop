/**
 * Sticky attachment to a Format widget — TRIAL (2026-11-13, widgets only;
 * the user decides whether to keep it and extend it to frames, or remove it).
 *
 * Anything drawn in the DOM (cards, smaller widgets) that you DROP on a widget
 * gets `payload.attachedTo = <widget id>`. It stays attached — moving with
 * the widget, clipped to its edges — until you drag it off. Resizing the
 * widget never detaches it: shrink the widget and what sticks out is hidden,
 * grow it and it shows again. (Frames still decide membership by position,
 * at grab time.)
 *
 * Board shapes are never attached: they paint beneath the DOM, so they could
 * only ever be hidden under a widget (decided: a widget doesn't carry what's
 * underneath it).
 */
import { isFormat } from './formats'
import { itemAABB } from '../selection/hitTest'

const DOM_TYPES = new Set(['note', 'task', 'text', 'pdf'])
export const isDomItem = (it) => !!it && (DOM_TYPES.has(it.type) || isFormat(it))

const centre = (it) => { const b = itemAABB(it); return { x: b.x + b.w / 2, y: b.y + b.h / 2 } }
const holds = (w, p) => p.x >= w.x && p.x <= w.x + w.w && p.y >= w.y && p.y <= w.y + w.h

/** Everything attached to `widget`, and what's attached to those, and so on. */
export function attachedItems(widget, items) {
    const out = []
    const seen = new Set([widget.id])
    const queue = [widget.id]
    while (queue.length) {
        const id = queue.shift()
        for (const it of items) {
            if (it.payload?.attachedTo === id && !seen.has(it.id)) { seen.add(it.id); out.push(it); queue.push(it.id) }
        }
    }
    return out
}

/** The widget `item` would attach to where it now lies: the topmost one under its centre, below it in z. */
export function attachTarget(item, items) {
    if (!isDomItem(item)) return null
    const c = centre(item)
    const z = item.z_index ?? 0
    // Never to itself or to something already riding on it (no loops).
    const own = new Set([item.id, ...attachedItems(item, items).map(i => i.id)])
    let best = null
    for (const w of items) {
        if (!isFormat(w) || own.has(w.id) || (w.z_index ?? 0) >= z || !holds(w, c)) continue
        if (!best || (w.z_index ?? 0) > (best.z_index ?? 0)) best = w
    }
    return best
}

/**
 * After a drop: the payload changes that attach or detach each of `ids` (all
 * that moved). Something that moved along with its own widget is left alone.
 * Returns [{ id, payload }] — empty when nothing changes.
 */
export function attachPatches(ids, items) {
    const byId = new Map(items.map(i => [i.id, i]))
    const moved = new Set(ids)
    const out = []
    for (const id of ids) {
        const it = byId.get(id)
        if (!isDomItem(it) || it.payload?.locked) continue
        // Carried by its own widget (or moved with it): still attached, even if
        // it hangs past the widget's edge — that's the point of sticking.
        if (it.payload?.attachedTo && moved.has(it.payload.attachedTo)) continue
        const target = attachTarget(it, items)?.id
        const cur = it.payload?.attachedTo
        if ((target ?? null) === (cur ?? null)) continue
        if (target) out.push({ id, payload: { ...it.payload, attachedTo: target } })
        else { const { attachedTo: _a, ...rest } = it.payload; out.push({ id, payload: rest }) }
    }
    return out
}

/**
 * The rectangle an attached item is clipped to: its widget's, intersected
 * with the widget's own clip if that widget is itself attached. null = not
 * clipped (not attached, or its widget is gone).
 */
export function clipRect(item, byId) {
    let rect = null
    let id = item.payload?.attachedTo
    const seen = new Set([item.id])
    while (id && !seen.has(id)) {
        seen.add(id)
        const w = byId.get(id)
        if (!isFormat(w)) break
        const r = { x: w.x, y: w.y, w: w.w, h: w.h }
        rect = rect ? intersect(rect, r) : r
        id = w.payload?.attachedTo
    }
    return rect
}

function intersect(a, b) {
    const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y)
    return { x, y, w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x), h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y) }
}

/** Does `rect` cut off any of `item`? */
export function isClipped(item, rect) {
    return clipState(item, rect) != null
}

/** How `rect` shows `item`: null (whole), 'cropped' (partly) or 'hidden' (none of it). */
export function clipState(item, rect) {
    if (!rect) return null
    const b = itemAABB(item)
    const cut = b.x < rect.x - 0.5 || b.y < rect.y - 0.5 || b.x + b.w > rect.x + rect.w + 0.5 || b.y + b.h > rect.y + rect.h + 0.5
    if (!cut) return null
    const none = b.x >= rect.x + rect.w || b.y >= rect.y + rect.h || b.x + b.w <= rect.x || b.y + b.h <= rect.y
    return none ? 'hidden' : 'cropped'
}
