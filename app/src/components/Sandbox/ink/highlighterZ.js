/**
 * Where a new highlighter stroke goes in the stack (spec §10.3: beneath text,
 * above the board).
 *
 * It slides beneath the pen ink and the outline-only shapes it crosses, so a
 * highlight sits behind handwriting like a real marker. It stays above filled
 * things (filled shapes, stickies, images, earlier highlights) — beneath those
 * it would simply vanish. Text boxes are DOM cards and always paint above the
 * canvas anyway. z stays an integer (the CLI reads z_index as i64).
 */
import { marqueeIntersects } from '../selection/hitTest'

const GRAPHIC = new Set(['stroke', 'shape', 'image'])

function covers(it) {
    if (it.type === 'stroke') return !it.payload?.highlighter
    if (it.type === 'shape') {
        const f = it.payload?.fill
        return it.payload?.kind !== 'sticky' && (!f || f === 'transparent')
    }
    return false
}

/** `box` is the new stroke's world box {x,y,w,h}; `nextZ` the top-of-stack z. */
export function highlighterZ(box, items, nextZ) {
    let minCover = Infinity, maxBase = -Infinity
    for (const it of items) {
        if (!GRAPHIC.has(it.type) || it.payload?.kind === 'frame') continue
        if (!marqueeIntersects(it, box)) continue
        const z = it.z_index ?? 0
        if (covers(it)) minCover = Math.min(minCover, z)
        else maxBase = Math.max(maxBase, z)
    }
    if (minCover === Infinity) return nextZ
    const z = minCover - 1
    // Equal z with a base item still paints above it: the new item is appended
    // last and the stack sort is stable.
    return z >= maxBase ? z : nextZ
}
