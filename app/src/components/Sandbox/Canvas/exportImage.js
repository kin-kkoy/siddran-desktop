/**
 * Export the board's Konva graphics (strokes + shapes + images) to a PNG.
 *
 * We frame the whole content — not just the current viewport — by temporarily
 * reposing the live <Stage> to fit the graphics' world bbox, calling toDataURL,
 * then restoring the stage. The mutate→capture→restore happens synchronously so
 * no frame paints in between (no visible flash) and React state is untouched.
 *
 * Known limitation: DOM cards (note/task/text) live outside Konva and are NOT
 * captured. SVG export and card-inclusive export are future work.
 */
import { itemAABB } from '../selection/hitTest'

const PAD = 24          // world px of breathing room around the content
const TARGET_SCALE = 2  // render at 2× for crispness…
const MAX_SIDE = 4000   // …unless that would blow past this pixel dimension

export function exportStagePNG(stage, graphicItems, title = 'sandbox') {
    if (!stage) return { ok: false, reason: 'no-stage' }
    if (!graphicItems || graphicItems.length === 0) return { ok: false, reason: 'empty' }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const it of graphicItems) {
        const b = itemAABB(it)
        if (b.x < minX) minX = b.x
        if (b.y < minY) minY = b.y
        if (b.x + b.w > maxX) maxX = b.x + b.w
        if (b.y + b.h > maxY) maxY = b.y + b.h
    }
    if (!isFinite(minX)) return { ok: false, reason: 'empty' }
    minX -= PAD; minY -= PAD; maxX += PAD; maxY += PAD
    const w = maxX - minX, h = maxY - minY
    if (w <= 0 || h <= 0) return { ok: false, reason: 'empty' }

    let scale = TARGET_SCALE
    if (Math.max(w, h) * scale > MAX_SIDE) scale = MAX_SIDE / Math.max(w, h)

    // snapshot the live stage so we can restore it exactly
    const snap = {
        x: stage.x(), y: stage.y(),
        sx: stage.scaleX(), sy: stage.scaleY(),
        width: stage.width(), height: stage.height(),
    }

    let url
    try {
        stage.scale({ x: scale, y: scale })
        stage.position({ x: -minX * scale, y: -minY * scale })
        stage.size({ width: Math.ceil(w * scale), height: Math.ceil(h * scale) })
        stage.draw()
        url = stage.toDataURL({ pixelRatio: 1 })
    } finally {
        stage.scale({ x: snap.sx, y: snap.sy })
        stage.position({ x: snap.x, y: snap.y })
        stage.size({ width: snap.width, height: snap.height })
        stage.draw()
    }

    const safe = (title || 'sandbox').trim().replace(/[^\w-]+/g, '_') || 'sandbox'
    const a = document.createElement('a')
    a.href = url
    a.download = `${safe}.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
    return { ok: true }
}
