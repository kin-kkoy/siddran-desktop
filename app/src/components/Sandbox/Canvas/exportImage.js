/**
 * Export the board's Konva graphics (strokes + shapes + images) to a PNG.
 *
 * It frames the whole content, not just the view, and it doesn't hold the board
 * still while it works:
 *   - the live stage is never moved: Konva renders just the content's region,
 *     wherever it is, at the export's resolution (Layer.toCanvas with a
 *     region + pixelRatio), layer by layer with breaks between, so panning and
 *     zooming carry on;
 *   - the slow part, PNG encoding, runs in a worker (pngWorker.js), or via the
 *     asynchronous canvas.toBlob where workers can't encode.
 * Only the rendering of one layer at a time runs on the page.
 *
 * Known limitation: DOM cards (note/task/text) live outside Konva and are NOT
 * captured.
 */
import { itemAABB } from '../selection/hitTest'

const PAD = 24          // world px of breathing room around the content
const TARGET_SCALE = 2  // render at 2× for crispness…
const MAX_SIDE = 4000   // …unless that would blow past this pixel dimension

// One painted frame (so the spinner shows) — or 50 ms, when the window isn't
// on screen and no frame comes (the export must not wait for one forever).
const nextFrame = () => Promise.race([
    new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))),
    new Promise(r => setTimeout(r, 50)),
])

/** The world rect to export: the clip (a frame) exactly, else the items' bounds + padding. */
export function exportRect(graphicItems, clip = null) {
    if (clip) return { x: clip.x, y: clip.y, w: clip.w, h: clip.h }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const it of graphicItems || []) {
        const b = itemAABB(it)
        if (b.x < minX) minX = b.x
        if (b.y < minY) minY = b.y
        if (b.x + b.w > maxX) maxX = b.x + b.w
        if (b.y + b.h > maxY) maxY = b.y + b.h
    }
    if (!isFinite(minX)) return null
    return { x: minX - PAD, y: minY - PAD, w: maxX - minX + 2 * PAD, h: maxY - minY + 2 * PAD }
}

// Paint the world rect `r` of a stage into `ctx` (W×H px), one layer at a
// time with a breather between, so the page stalls for one layer's render at
// most, never the whole board's. The connection outlines (a selection aid,
// not part of the board) are left out.
async function renderRegion(stage, r, scale, ctx, W, H) {
    for (const layer of stage.getLayers()) {
        if (!layer.isVisible() || layer.name() === 'sb-glow' || !layer.getChildren().length) continue
        // Measured per layer: you may have panned or zoomed since the last one.
        const z = stage.scaleX() || 1
        const config = {
            x: stage.x() + r.x * z, y: stage.y() + r.y * z,
            width: r.w * z, height: r.h * z,
            pixelRatio: scale / z,
        }
        ctx.drawImage(layer.toCanvas(config), 0, 0, W, H)
        await nextFrame()
    }
}

let worker = null
function encodeInWorker(canvas) {
    if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined' || typeof Worker === 'undefined') return null
    return (async () => {
        if (!worker) worker = new Worker(new URL('./pngWorker.js', import.meta.url), { type: 'module' })
        const bitmap = await createImageBitmap(canvas)
        return await new Promise((resolve, reject) => {
            const w = worker
            const done = (e) => {
                w.removeEventListener('message', done)
                w.removeEventListener('error', fail)
                if (e.data?.blob) resolve(e.data.blob); else reject(new Error(e.data?.error || 'encode failed'))
            }
            const fail = (e) => { w.removeEventListener('message', done); w.removeEventListener('error', fail); reject(e) }
            w.addEventListener('message', done)
            w.addEventListener('error', fail)
            w.postMessage({ bitmap }, [bitmap])
        })
    })()
}
const encodeOnPage = (canvas) => new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/png'))

async function encodePNG(canvas) {
    try {
        const viaWorker = encodeInWorker(canvas)
        if (viaWorker) return await viaWorker
    } catch { /* this WebView can't encode in a worker — encode on the page */ }
    return encodeOnPage(canvas)
}

/**
 * Export to `<title>.png`. Async: resolves { ok } once the file is handed to the
 * browser to save, or { ok: false, reason: 'empty' | 'no-stage' | 'failed' }.
 */
export async function exportStagePNG(stage, graphicItems, title = 'sandbox', clip = null, topStage = null) {
    if (!stage) return { ok: false, reason: 'no-stage' }
    const r = exportRect(graphicItems, clip)
    if (!r || r.w <= 0 || r.h <= 0) return { ok: false, reason: 'empty' }
    let scale = TARGET_SCALE
    if (Math.max(r.w, r.h) * scale > MAX_SIDE) scale = MAX_SIDE / Math.max(r.w, r.h)

    // Let the button's spinner paint before the render takes the page.
    await nextFrame()
    let blob
    try {
        // The top canvas (what rides on widgets) is painted over the board's.
        const W = Math.ceil(r.w * scale), H = Math.ceil(r.h * scale)
        const out = document.createElement('canvas')
        out.width = W; out.height = H
        const ctx = out.getContext('2d')
        for (const s of topStage ? [stage, topStage] : [stage]) await renderRegion(s, r, scale, ctx, W, H)
        blob = await encodePNG(out)
    } catch {
        return { ok: false, reason: 'failed' }
    }

    const safe = (title || 'sandbox').trim().replace(/[^\w-]+/g, '_') || 'sandbox'
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${safe}.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    return { ok: true }
}
