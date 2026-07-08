import { getStroke } from 'perfect-freehand'

/**
 * Wraps perfect-freehand with two profiles depending on the input device.
 *
 * Pipeline: distanceDedup → (stylus) smoothPressure → getStroke.
 *
 * History note: we used to densify the raw samples through a Catmull-Rom
 * spline before getStroke. That was a mistake on two counts — an
 * interpolating spline passes exactly through every jittery sample (baking
 * the noise in), and perfect-freehand's `streamline` is a per-point lerp
 * filter whose strength depends on input spacing, so 16× denser input made
 * it converge ~98% per original segment and smoothed almost nothing. Raw,
 * deduped points let the library's own low-pass actually work.
 *
 *  Tuning notes (per knob):
 *   - `streamline` — low-pass on the control polyline. Strongest single knob.
 *   - `thinning`   — pressure→width influence. 0 = uniform width.
 *   - `smoothing`  — min spacing between outline vertices. Kept moderate:
 *     the renderer now draws quadratic curves through vertex midpoints
 *     (see drawStrokePath), which handles corner softness.
 *   - `simulatePressure` — velocity-derived pressure. Off everywhere: real
 *     pressure on stylus, uniform width on mouse.
 */
export const MOUSE_OPTIONS = {
    size: 6,
    thinning: 0,
    smoothing: 0.62,
    streamline: 0.6,
    simulatePressure: false,
    last: true,
    start: { taper: 12, cap: true },
    end:   { taper: 12, cap: true },
}

export const STYLUS_OPTIONS = {
    size: 8,
    thinning: 0.45,
    smoothing: 0.62,
    streamline: 0.5,
    simulatePressure: false,
    last: true,
    start: { taper: 0, cap: true },
    end:   { taper: 0, cap: true },
}

function pickProfile(inputType) {
    return inputType === 'pen' ? STYLUS_OPTIONS : MOUSE_OPTIONS
}

/**
 * Drop successive samples that are closer than `minDist` world-units to the
 * previously kept sample. Hand jitter is roughly constant in SCREEN pixels,
 * so callers should pass a zoom-aware threshold (e.g. 2 / zoom) — a fixed
 * world-unit value filters almost nothing when zoomed out.
 *
 * Always keeps the first and last input points so the stroke endpoints don't
 * move.
 */
export function distanceDedup(points, minDist = 1.5) {
    if (!points || points.length === 0) return []
    if (points.length === 1) return [points[0]]

    const minSq = minDist * minDist
    const out = [points[0]]
    let last = points[0]
    for (let i = 1; i < points.length - 1; i++) {
        const p = points[i]
        const dx = p[0] - last[0]
        const dy = p[1] - last[1]
        if (dx * dx + dy * dy >= minSq) {
            out.push(p)
            last = p
        }
    }
    const final = points[points.length - 1]
    const dx = final[0] - last[0]
    const dy = final[1] - last[1]
    if (dx * dx + dy * dy >= minSq) {
        out.push(final)
    } else if (out.length > 1) {
        out[out.length - 1] = final
    } else {
        out.push(final)
    }
    return out
}

/**
 * Exponential moving average over the pressure channel only. getStroke
 * low-passes positions (streamline) but passes pressure through raw — on a
 * tablet the raw pressure jitters enough to wobble the width even on a
 * gentle straight line.
 */
export function smoothPressure(points, alpha = 0.35) {
    if (!points || points.length < 2) return points ?? []
    const out = new Array(points.length)
    let ema = points[0][2] ?? 0.5
    out[0] = points[0]
    for (let i = 1; i < points.length; i++) {
        const p = points[i]
        ema = ema + alpha * ((p[2] ?? 0.5) - ema)
        out[i] = [p[0], p[1], ema]
    }
    return out
}

/**
 * sceneFunc-style renderer: draws the flat outline as quadratic Béziers
 * through consecutive vertex midpoints (the tldraw getSvgPathFromStroke
 * technique, but straight onto a canvas context — no SVG string to build or
 * parse per frame). Straight-segment polygons facet visibly because
 * perfect-freehand culls outline vertices to ~size·smoothing spacing.
 */
export function drawStrokePath(ctx, flat) {
    const n = flat.length
    if (n < 6) {
        if (n >= 2) {
            ctx.moveTo(flat[0], flat[1])
            for (let i = 2; i < n; i += 2) ctx.lineTo(flat[i], flat[i + 1])
            ctx.closePath()
        }
        return
    }
    ctx.moveTo((flat[0] + flat[2]) / 2, (flat[1] + flat[3]) / 2)
    for (let i = 2; i < n; i += 2) {
        const x = flat[i]
        const y = flat[i + 1]
        const nx = flat[(i + 2) % n]
        const ny = flat[(i + 3) % n]
        ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2)
    }
    // Close the loop back through the first vertex.
    ctx.quadraticCurveTo(flat[0], flat[1], (flat[0] + flat[2]) / 2, (flat[1] + flat[3]) / 2)
    ctx.closePath()
}

/**
 * A round dot outline (closed polygon) centred at (cx, cy). Used so a single
 * click/tap — which has no travel for getStroke to build a ribbon from — still
 * leaves a visible mark instead of nothing.
 */
function dotOutline(cx, cy, r) {
    const seg = 18
    const flat = new Array(seg * 2)
    for (let i = 0; i < seg; i++) {
        const a = (i / seg) * Math.PI * 2
        flat[i * 2] = cx + Math.cos(a) * r
        flat[i * 2 + 1] = cy + Math.sin(a) * r
    }
    return flat
}

export function strokeOutline(points, options) {
    if (!points || points.length === 0) return []
    const profile = pickProfile(options?.inputType)
    let pts = distanceDedup(points, options?.minDist ?? 1.5)

    // Tap (no meaningful travel) → a round dot, sized from the brush + pressure.
    const tapEps = (options?.minDist ?? 1.5) * 1.2
    let minX = pts[0][0], maxX = minX, minY = pts[0][1], maxY = minY
    for (const p of pts) {
        if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]
        if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]
    }
    if (Math.max(maxX - minX, maxY - minY) <= tapEps) {
        const size = options?.size ?? profile.size
        const pressure = pts[pts.length - 1][2] ?? 0.5
        const r = Math.max(0.75, (size / 2) * (0.6 + 0.4 * pressure))
        return dotOutline((minX + maxX) / 2, (minY + maxY) / 2, r)
    }

    if (options?.inputType === 'pen') pts = smoothPressure(pts)
    const outline = getStroke(pts, { ...profile, ...options })
    const flat = new Array(outline.length * 2)
    for (let i = 0; i < outline.length; i++) {
        flat[i * 2]     = outline[i][0]
        flat[i * 2 + 1] = outline[i][1]
    }
    return flat
}
