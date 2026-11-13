/**
 * Sticky attachment to a container: a Frame or a Format widget (decided
 * 2026-11-13 — it began as a trial on widgets, the user kept it and asked for
 * frames too).
 *
 * Something you DROP on a container (or insert onto a widget) gets
 * `payload.attachedTo = <container id>`. It stays attached, moving with the
 * container, until you drag it off on its own. Resizing a container never
 * detaches anything. What sticks out past the edge either hangs out whole
 * (the default) or is cropped at the edge, per container: `payload.overflow`
 * = 'clip' (the floating bar's crop button) — absent or 'hang' means hang.
 *
 * What may attach to what:
 *   - a widget takes anything stacked ABOVE it but frames and connectors
 *     (cards, smaller widgets, shapes, ink, images) — a widget doesn't carry
 *     what's underneath it (decided). Board graphics on a widget are drawn on
 *     a second canvas above the widgets (`widgetBorne`, SandboxCanvas), or the
 *     widget's DOM would hide them;
 *   - a frame takes anything but connectors (they follow their ends) whose
 *     centre is inside it; another frame only if it is the smaller of the two
 *     (so two frames can never hold each other).
 * A widget on top wins over the frame beneath; among frames, the smallest.
 *
 * Boards from before attachment have things in frames with no `attachedTo`.
 * Those still ride by position (frames' old rule), and are stamped as attached
 * the first time a frame on the board is moved or resized (`stampPatches`).
 */
import { isFormat } from '../formats/formats'
import { isFrame } from '../frames/frames'
import { itemAABB } from './hitTest'

const DOM_TYPES = new Set(['note', 'task', 'text', 'pdf'])
export const isDomItem = (it) => !!it && (DOM_TYPES.has(it.type) || isFormat(it))
export const isContainer = (it) => isFormat(it) || isFrame(it)

/** Does this container crop what hangs past its edge? (Default: no, it hangs.) */
export const crops = (c) => c?.payload?.overflow === 'clip'

const centre = (it) => { const b = itemAABB(it); return { x: b.x + b.w / 2, y: b.y + b.h / 2 } }
const holds = (c, p) => p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h
const area = (b) => (b.w || 0) * (b.h || 0)

/** Could `item` attach to `c` where they both are now? */
function fits(item, c) {
    if (!item || item.id === c.id || item.type === 'connector') return false
    if (isFormat(c)) return !isFrame(item) && (item.z_index ?? 0) > (c.z_index ?? 0) && holds(c, centre(item))
    if (isFrame(c)) return holds(c, centre(item)) && (!isFrame(item) || area(item) < area(c))
    return false
}

/** Everything attached to `container`, and what's attached to those, and so on. */
export function attachedItems(container, items) {
    const out = []
    const seen = new Set([container.id])
    const queue = [container.id]
    while (queue.length) {
        const id = queue.shift()
        for (const it of items) {
            if (it.payload?.attachedTo === id && !seen.has(it.id)) { seen.add(it.id); out.push(it); queue.push(it.id) }
        }
    }
    return out
}

/** The container `item` would attach to where it now lies (see the header for the rules). */
export function attachTarget(item, items) {
    if (!item || item.type === 'connector') return null
    // Never to itself or to something riding on it (no loops).
    const own = new Set([item.id, ...attachedItems(item, items).map(i => i.id)])
    let widget = null, frame = null
    for (const c of items) {
        if (!isContainer(c) || own.has(c.id) || !fits(item, c)) continue
        if (isFormat(c)) { if (!widget || (c.z_index ?? 0) > (widget.z_index ?? 0)) widget = c }
        else if (!frame || c.w * c.h < frame.w * frame.h) frame = c
    }
    return widget || frame
}

/**
 * After a drop: the payload changes that attach or detach each of `ids` (all
 * that moved). Something that moved along with its own container is left
 * alone — it stays attached even if it hangs past the edge.
 * Returns [{ id, payload }] — empty when nothing changes.
 */
export function attachPatches(ids, items) {
    const byId = new Map(items.map(i => [i.id, i]))
    const moved = new Set(ids)
    const out = []
    for (const id of ids) {
        const it = byId.get(id)
        if (!it || it.type === 'connector' || it.payload?.locked) continue
        if (it.payload?.attachedTo && moved.has(it.payload.attachedTo)) continue
        const target = attachTarget(it, items)?.id
        const cur = it.payload?.attachedTo
        if ((target ?? null) === (cur ?? null)) continue
        if (target) out.push({ id, payload: { ...it.payload, attachedTo: target } })
        else { const { attachedTo: _a, ...rest } = it.payload; out.push({ id, payload: rest }) }
    }
    return out
}

/** What `frame` carries by position only (things with no `attachedTo` that sit in it). */
export function legacyRiders(frame, items) {
    return items.filter(it => !it.payload?.attachedTo && it.type !== 'connector' && attachTarget(it, items)?.id === frame.id)
}

/**
 * When a frame is first moved or resized: attach everything that sits in ANY
 * frame by position only, to the frame it sits in — so from then on it
 * sticks (and a shrinking frame keeps it). Returns [{ id, payload }].
 */
export function stampPatches(items) {
    if (!items.some(isFrame)) return []
    const out = []
    for (const it of items) {
        if (it.payload?.attachedTo || it.type === 'connector' || it.payload?.locked) continue
        const t = attachTarget(it, items)
        if (t && isFrame(t)) out.push({ id: it.id, payload: { ...it.payload, attachedTo: t.id } })
    }
    return out
}

/**
 * The rectangle an attached item is cropped to: the intersection of every
 * cropping container up its chain. null = not cropped (not attached, its
 * container is gone, or every container up the chain lets things hang).
 */
export function clipRect(item, byId) {
    let rect = null
    let id = item.payload?.attachedTo
    const seen = new Set([item.id])
    while (id && !seen.has(id)) {
        seen.add(id)
        const c = byId.get(id)
        if (!isContainer(c)) break
        if (crops(c)) {
            const r = { x: c.x, y: c.y, w: c.w, h: c.h }
            rect = rect ? intersect(rect, r) : r
        }
        id = c.payload?.attachedTo
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

/**
 * Crop rects and per-container counts for a whole board — what the page draws.
 * clips: Map(itemId → rect); cut: Map(containerId → { cropped, hidden }), each
 * thing counted on the container it's attached to.
 */
export function boardClips(items, byId = new Map(items.map(i => [i.id, i]))) {
    const clips = new Map()
    const cut = new Map()
    for (const it of items) {
        if (!it.payload?.attachedTo) continue
        const r = clipRect(it, byId)
        if (!r) continue
        clips.set(it.id, r)
        const st = clipState(it, r)
        if (!st) continue
        const c = cut.get(it.payload.attachedTo) || { cropped: 0, hidden: 0 }
        c[st] += 1
        cut.set(it.payload.attachedTo, c)
    }
    return { clips, cut }
}

/**
 * Board graphics (strokes, shapes, images — not frames) that ride on a widget,
 * directly or through other things attached to it: they must be drawn ABOVE
 * the widgets (the top canvas), not on the board's canvas beneath the DOM.
 * Returns a Set of ids.
 */
export function widgetBorne(items, byId = new Map(items.map(i => [i.id, i]))) {
    const out = new Set()
    for (const it of items) {
        if (!it.payload?.attachedTo || isDomItem(it) || isFrame(it) || it.type === 'connector') continue
        let id = it.payload.attachedTo
        const seen = new Set([it.id])
        while (id && !seen.has(id)) {
            seen.add(id)
            const c = byId.get(id)
            if (!c) break
            if (isFormat(c)) { out.add(it.id); break }
            id = c.payload?.attachedTo
        }
    }
    return out
}

/** "2 cropped · 1 out of view" — or '' when nothing is cut. */
export const cutLabel = (c) => (c ? [c.cropped && `${c.cropped} cropped`, c.hidden && `${c.hidden} out of view`].filter(Boolean).join(' · ') : '')
