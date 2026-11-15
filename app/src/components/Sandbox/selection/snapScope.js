/**
 * Frame-scoped snapping (decided 2026-11-15, the user uses frames heavily and
 * kept getting guides from things on OTHER frames).
 *
 * Something dragged or resized over a frame snaps only to:
 *   - the frame's own edges and centre lines;
 *   - what sits on that frame (attached to it, or riding on something attached
 *     to it — but not the contents of a smaller frame nested inside it), plus,
 *     on boards from before attachment, what lies in it by position only;
 *   - where things sit on OTHER frames of the same size (slides), moved into
 *     this frame, so a title at the same spot on every slide lines up;
 *   - a grid counted from the frame's top-left corner.
 * The frame is the smallest one holding the dragged box's centre — the rule
 * selection/attach.js uses on drop, so the scope changes as soon as the box is
 * over a frame, not when it lands.
 *
 * A frame with `payload.snapOutside` (the magnet on its floating bar) opts out:
 * things on it line up with everything, as before. Absent = scoped.
 * Frames themselves (moving or resizing) always snap to everything.
 */
import { isFrame } from '../frames/frames'
import { itemAABB } from './hitTest'
import { snapLines } from './snapping'

export const snapsOutside = (f) => !!f?.payload?.snapOutside

const area = (b) => (b.w || 0) * (b.h || 0)
const holds = (c, p) => p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h
const centreOf = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })

/** The smallest frame in `frames` holding point `p`, not in `skip`, smaller than `maxArea`. */
export function frameAt(p, frames, skip, maxArea = Infinity) {
    let best = null
    for (const f of frames) {
        if (skip?.has(f.id) || !holds(f, p)) continue
        const a = area(f)
        if (a >= maxArea) continue
        if (!best || a < area(best)) best = f
    }
    return best
}

/** What sits on `frame` for snapping (see the header). `frames`: every frame on the board. */
export function frameMembers(frame, items, frames, byId = new Map(items.map(i => [i.id, i]))) {
    const out = []
    for (const it of items) {
        if (it.id === frame.id || it.type === 'connector') continue
        let id = it.payload?.attachedTo
        if (id) {
            // Up the attachment chain: reaching this frame first means it's on it;
            // reaching another frame first means it's on that one.
            const seen = new Set([it.id])
            while (id && !seen.has(id)) {
                if (id === frame.id) { out.push(it); break }
                seen.add(id)
                const c = byId.get(id)
                if (!c || isFrame(c)) break
                id = c.payload?.attachedTo
            }
        } else {
            // Not attached (older boards): by position, the way attach.js decides.
            const b = itemAABB(it)
            const max = isFrame(it) ? area(b) : Infinity
            if (frameAt(centreOf(b), frames, new Set([it.id]), max)?.id === frame.id) out.push(it)
        }
    }
    return out
}

const sorted = (arr) => Float64Array.from(arr).sort()
const SAME = 0.5   // world units: frames this close in size count as the same size (slides)

/**
 * The snap scope for a box centred on `p`: { frame, targets, origin } — or
 * null when the box isn't over a frame, or that frame opts out (snap to
 * everything). `skip`: ids that are moving (never targets, never the scope).
 * `cache`: a Map kept for the gesture, so each frame's lines are built once.
 */
export function snapScope(p, items, skip, cache) {
    const frames = cache?.frames || items.filter(it => isFrame(it))
    if (cache && !cache.frames) cache.frames = frames
    const frame = frameAt(p, frames, skip)
    if (!frame || snapsOutside(frame)) return null
    const hit = cache?.get(frame.id)
    if (hit) return hit
    const byId = cache?.byId || new Map(items.map(i => [i.id, i]))
    if (cache && !cache.byId) cache.byId = byId
    const own = frameMembers(frame, items, frames, byId).filter(it => !skip?.has(it.id))
    const { xs, ys } = snapLines([frame, ...own])
    // Slides: the same spots on every other frame of this size, moved into this one.
    for (const g of frames) {
        if (g.id === frame.id || Math.abs(g.w - frame.w) > SAME || Math.abs(g.h - frame.h) > SAME) continue
        const dx = frame.x - g.x, dy = frame.y - g.y
        const l = snapLines(frameMembers(g, items, frames, byId).filter(it => !skip?.has(it.id)))
        for (const x of l.xs) xs.push(x + dx)
        for (const y of l.ys) ys.push(y + dy)
    }
    const scope = { frame, targets: { xs: sorted(xs), ys: sorted(ys) }, origin: { x: frame.x, y: frame.y } }
    cache?.set(frame.id, scope)
    return scope
}
