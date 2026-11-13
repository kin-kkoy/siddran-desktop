/**
 * Slides — every frame on the board is a slide (spec §11.8, §13.9: "a slide
 * is a frame"). There is no Slides item and no new item type: the deck is an
 * ordering layer over the frames, kept on each frame's payload.
 *
 * Optional frame payload fields (absent = old behaviour):
 *   - `slideOrder`  (number) — position in the deck. Frames without one follow
 *     the ordered ones, in reading order (rows top to bottom, then left to right).
 *   - `slideHidden` (true)   — skipped when presenting; still on the board.
 *
 * Reordering never moves a frame on the canvas (spec R11.11).
 */
import { isFrame } from '../frames/frames'
import { isFormat } from '../formats/formats'
import { itemAABB } from '../selection/hitTest'

export const CARD_TYPES = new Set(['note', 'task', 'text', 'pdf'])

const hasOrder = (f) => Number.isFinite(f.payload?.slideOrder)

/**
 * Reading order: frames whose tops lie within half the row's first frame's
 * height of it share a row; rows go top to bottom, each left to right.
 */
export function readingOrder(frames) {
    const byY = [...frames].sort((a, b) => a.y - b.y || a.x - b.x)
    const rows = []
    for (const f of byY) {
        const row = rows[rows.length - 1]
        if (row && f.y < row.top + row.h / 2) row.frames.push(f)
        else rows.push({ top: f.y, h: Math.max(1, f.h), frames: [f] })
    }
    return rows.flatMap(r => r.frames.sort((a, b) => a.x - b.x || a.y - b.y))
}

/** Every frame, in deck order (hidden ones included). */
export function deckOrder(items) {
    const frames = items.filter(isFrame)
    const ordered = frames.filter(hasOrder)
    const rest = frames.filter(f => !hasOrder(f))
    // Ties (two frames with the same number, e.g. after a merge) fall back to
    // reading order so the deck is stable.
    const reading = new Map(readingOrder(frames).map((f, i) => [f.id, i]))
    ordered.sort((a, b) => a.payload.slideOrder - b.payload.slideOrder || reading.get(a.id) - reading.get(b.id))
    return [...ordered, ...readingOrder(rest)]
}

export const isHiddenSlide = (f) => f.payload?.slideHidden === true

/** The frames a presentation walks through. */
export function presentedFrames(items) {
    return deckOrder(items).filter(f => !isHiddenSlide(f))
}

/**
 * Move frame `id` to position `to` (0-based, in deck order). Returns
 * `[{ id, slideOrder }]` for every frame whose number changes — numbering
 * all of them 1…n, so the order is explicit from then on.
 */
export function reorderPatches(items, id, to) {
    const deck = deckOrder(items)
    const from = deck.findIndex(f => f.id === id)
    if (from < 0) return []
    const next = [...deck]
    const [moved] = next.splice(from, 1)
    next.splice(Math.max(0, Math.min(to, next.length)), 0, moved)
    const out = []
    next.forEach((f, i) => { if (f.payload?.slideOrder !== i + 1) out.push({ id: f.id, slideOrder: i + 1 }) })
    return out
}

/**
 * The viewport that shows `frame` as large as fits in a `w`×`h` screen,
 * centred (letterboxed). `pad` is screen px kept free on every side. The
 * zoom stays inside the board's limits (useSandboxCanvas clamps to 0.1–8),
 * so the centring is computed for the zoom actually used.
 */
export function fitFrameViewport(frame, w, h, pad = 0, minZoom = 0.1, maxZoom = 8) {
    const fw = Math.max(1, frame.w), fh = Math.max(1, frame.h)
    const zoom = Math.max(minZoom, Math.min(maxZoom, (w - pad * 2) / fw, (h - pad * 2) / fh))
    return {
        x: Math.round(w / 2 - (frame.x + fw / 2) * zoom),
        y: Math.round(h / 2 - (frame.y + fh / 2) * zoom),
        zoom,
    }
}

/**
 * Where "Present from here" starts: the selected frame if one is selected
 * (a hidden one starts at the next shown slide), else the frame under the
 * view's centre (the smallest, for nested frames), else the first slide.
 * Returns an index into `shown`.
 */
export function startIndex(items, shown, { selectedIds, center } = {}) {
    if (!shown.length) return -1
    const deck = deckOrder(items)
    const pick = (id) => {
        const at = shown.findIndex(f => f.id === id)
        if (at >= 0) return at
        // A hidden frame: the next shown one after it in deck order.
        const d = deck.findIndex(f => f.id === id)
        for (let i = d + 1; i < deck.length; i++) {
            const s = shown.findIndex(f => f.id === deck[i].id)
            if (s >= 0) return s
        }
        return -1
    }
    for (const id of selectedIds || []) {
        const it = items.find(i => i.id === id)
        if (it && isFrame(it)) { const at = pick(id); if (at >= 0) return at }
    }
    if (center) {
        const under = deck
            .filter(f => center.x >= f.x && center.x <= f.x + f.w && center.y >= f.y && center.y <= f.y + f.h)
            .sort((a, b) => a.w * a.h - b.w * b.h)
        for (const f of under) { const at = pick(f.id); if (at >= 0) return at }
    }
    return 0
}

/** Index after a navigation key, clamped to the deck. */
export function stepIndex(index, delta, count) {
    if (count <= 0) return -1
    return Math.max(0, Math.min(count - 1, index + delta))
}

/** Items that meet `frame`, in paint order: frames, links, graphics, then DOM (cards/widgets). */
export function frameContents(frame, items) {
    const fx = frame.x, fy = frame.y, fx2 = frame.x + frame.w, fy2 = frame.y + frame.h
    const meets = (it) => {
        if (it.type === 'connector') return true   // filtered by its points when drawn
        const b = itemAABB(it)
        return b.x < fx2 && b.x + b.w > fx && b.y < fy2 && b.y + b.h > fy
    }
    const rank = (it) => isFrame(it) ? 0 : it.type === 'connector' ? 1 : (CARD_TYPES.has(it.type) || isFormat(it)) ? 3 : 2
    return items
        .filter(it => it.id !== frame.id && meets(it))
        .sort((a, b) => rank(a) - rank(b) || (a.z_index ?? 0) - (b.z_index ?? 0))
}
