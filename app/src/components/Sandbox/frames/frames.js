/**
 * Frames — titled regions that group and present a part of the board (spec §11).
 *
 * Stored as `type: 'shape', payload.kind: 'frame'` rather than a new item type:
 * an older Siddran build sends every unknown *type* down the stroke renderer
 * (which would throw on a board containing one), but an unknown shape *kind*
 * simply draws nothing. So a board touched by this build stays openable by the
 * old one, and siddran-cli round-trips it untouched.
 *
 * Membership is geometric and decided when a drag starts (an item belongs to a
 * frame if its centre is inside it) — no parentId to keep in step across the
 * three-way merge or the CLI.
 */
import { itemAABB } from '../selection/hitTest'

export const FRAME_KIND = 'frame'
export const FRAME_TITLE_PX = 13      // screen px — the title stays legible at any zoom
export const FRAME_TITLE_GAP = 6      // screen px between title baseline area and the frame
export const FRAME_EDGE_PX = 8        // screen px either side of the border that grabs the frame
export const FRAME_DEFAULT_FILL = 'rgba(128,128,150,0.10)'
export const FRAME_FILLS = [FRAME_DEFAULT_FILL, '#ffffff', '#fff7b2', '#d9ccff', '#a9d8ff', '#8fd98a', '#ffb84d', '#ff9ec4']

export const isFrame = (it) => it?.type === 'shape' && it.payload?.kind === FRAME_KIND

/** World-space rect of a frame's title strip at `zoom`. */
export function frameTitleRect(frame, zoom = 1) {
    const title = frame.payload?.title || 'Frame'
    const h = (FRAME_TITLE_PX + FRAME_TITLE_GAP + 4) / zoom
    const w = Math.min(frame.w, (title.length * FRAME_TITLE_PX * 0.62 + 12) / zoom)
    return { x: frame.x, y: frame.y - h, w: Math.max(w, 40 / zoom), h }
}

/**
 * A frame is picked by its title or its border, not its interior — so a drag
 * inside a frame still draws a marquee over the things in it.
 */
export function frameHit(frame, x, y, zoom = 1) {
    const t = frameTitleRect(frame, zoom)
    if (x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h) return true
    const e = FRAME_EDGE_PX / zoom
    const { x: fx, y: fy, w, h } = frame
    const inOuter = x >= fx - e && x <= fx + w + e && y >= fy - e && y <= fy + h + e
    const inInner = x > fx + e && x < fx + w - e && y > fy + e && y < fy + h - e
    return inOuter && !inInner
}

/** Items whose centre lies inside `frame` (connectors excluded — they follow their ends). */
export function frameChildren(frame, items) {
    const out = []
    for (const it of items) {
        if (it.id === frame.id || it.type === 'connector') continue
        const b = itemAABB(it)
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2
        if (cx >= frame.x && cx <= frame.x + frame.w && cy >= frame.y && cy <= frame.y + frame.h) out.push(it)
    }
    return out
}

/** A marquee only takes a frame it fully contains (else every drag inside one would grab it). */
export function marqueeTakesFrame(frame, rect) {
    return frame.x >= rect.x && frame.y >= rect.y && frame.x + frame.w <= rect.x + rect.w && frame.y + frame.h <= rect.y + rect.h
}

/** Next default title: "Frame 1", "Frame 2", … */
export function nextFrameTitle(items) {
    let n = 0
    for (const it of items) {
        const m = isFrame(it) && /^Frame (\d+)$/.exec(it.payload?.title || '')
        if (m) n = Math.max(n, Number(m[1]))
    }
    return `Frame ${n + 1}`
}

export function framePayload(title, fill = FRAME_DEFAULT_FILL) {
    return { kind: FRAME_KIND, title, fill, stroke: 'rgba(160,160,190,0.35)', strokeWidth: 1 }
}
