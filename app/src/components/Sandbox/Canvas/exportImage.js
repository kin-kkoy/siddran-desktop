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

export function exportStagePNG(stage, graphicItems, title = 'sandbox', clip = null, topStage = null) {
    if (!stage) return { ok: false, reason: 'no-stage' }
    if (!clip && (!graphicItems || graphicItems.length === 0)) return { ok: false, reason: 'empty' }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    if (clip) {
        // An exact world rect (a frame): no padding, nothing outside it.
        minX = clip.x; minY = clip.y; maxX = clip.x + clip.w; maxY = clip.y + clip.h
    } else {
        for (const it of graphicItems) {
            const b = itemAABB(it)
            if (b.x < minX) minX = b.x
            if (b.y < minY) minY = b.y
            if (b.x + b.w > maxX) maxX = b.x + b.w
            if (b.y + b.h > maxY) maxY = b.y + b.h
        }
        if (!isFinite(minX)) return { ok: false, reason: 'empty' }
        minX -= PAD; minY -= PAD; maxX += PAD; maxY += PAD
    }
    const w = maxX - minX, h = maxY - minY
    if (w <= 0 || h <= 0) return { ok: false, reason: 'empty' }

    let scale = TARGET_SCALE
    if (Math.max(w, h) * scale > MAX_SIDE) scale = MAX_SIDE / Math.max(w, h)

    // snapshot the live stage so we can restore it exactly
    // The top canvas (what rides on widgets, SandboxCanvas) is posed the same
    // way and painted over the board's.
    const stages = topStage ? [stage, topStage] : [stage]
    const snaps = stages.map(s => ({ s, x: s.x(), y: s.y(), sx: s.scaleX(), sy: s.scaleY(), width: s.width(), height: s.height() }))
    const W = Math.ceil(w * scale), H = Math.ceil(h * scale)

    let url
    try {
        const out = document.createElement('canvas')
        out.width = W; out.height = H
        const ctx = out.getContext('2d')
        // The connection outlines are a selection aid, not part of the board.
        for (const s of stages) s.find('.sb-glow').forEach(l => l.visible(false))
        for (const s of stages) {
            s.scale({ x: scale, y: scale })
            s.position({ x: -minX * scale, y: -minY * scale })
            s.size({ width: W, height: H })
            s.draw()
            ctx.drawImage(s.toCanvas({ pixelRatio: 1 }), 0, 0)
        }
        url = out.toDataURL('image/png')
    } finally {
        for (const n of snaps) {
            n.s.find('.sb-glow').forEach(l => l.visible(true))
            n.s.scale({ x: n.sx, y: n.sy })
            n.s.position({ x: n.x, y: n.y })
            n.s.size({ width: n.width, height: n.height })
            n.s.draw()
        }
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
