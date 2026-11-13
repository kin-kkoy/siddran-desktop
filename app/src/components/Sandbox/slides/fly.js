import { fitFrameViewport } from './slides'

const FLY_MS = 260

/** Glide the board to viewport `to` (timers, not rAF: a hidden window gets no frames). */
export function fly(canvas, to) {
    const from = canvas.viewport
    const t0 = performance.now()
    const step = () => {
        const k = Math.min(1, (performance.now() - t0) / FLY_MS)
        const e = 1 - Math.pow(1 - k, 3)
        // Interpolate the zoom geometrically so the glide feels even.
        const zoom = from.zoom * Math.pow(to.zoom / from.zoom, e)
        canvas.setViewport({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, zoom })
        if (k < 1) setTimeout(step, 16)
        else canvas.setViewport(to)
    }
    step()
}

/**
 * Glide to show `rect` whole in the board's visible part: the canvas shell
 * (`shell`, an element) minus `rightInset` px (the Slides panel).
 */
export function flyToRect(canvas, rect, shell, rightInset = 0) {
    const r = shell?.getBoundingClientRect()
    const w = Math.max(200, (r ? r.width : window.innerWidth) - rightInset)
    const h = r ? r.height : window.innerHeight
    fly(canvas, fitFrameViewport(rect, w, h, 56))
}
