import { describe, it, expect } from 'vitest'
import { recognizeStroke, shapeFromRecognition, resample } from './recognize'

// Deterministic wobble so the "hand-drawn" strokes are the same every run.
function rng(seed) {
    let s = seed
    return () => { s = (s * 16807) % 2147483647; return (s / 2147483647) - 0.5 }
}
// Walk a polygon (or polyline) with `per` samples per edge and some jitter.
function drawPath(corners, { closed = true, per = 20, jitter = 3, seed = 7, overshoot = 0 } = {}) {
    const r = rng(seed)
    const out = []
    const n = corners.length
    const edges = closed ? n : n - 1
    for (let i = 0; i < edges; i++) {
        const a = corners[i], b = corners[(i + 1) % n]
        for (let k = 0; k < per; k++) {
            const t = k / per
            out.push([a[0] + (b[0] - a[0]) * t + r() * jitter, a[1] + (b[1] - a[1]) * t + r() * jitter, 0.5])
        }
    }
    const last = closed ? corners[0] : corners[n - 1]
    out.push([last[0] + overshoot, last[1] + overshoot * 0.5, 0.5])
    return out
}
function drawEllipse(cx, cy, rx, ry, { jitter = 3, seed = 3, gap = 0 } = {}) {
    const r = rng(seed)
    const out = []
    const n = 80
    for (let i = 0; i <= n - gap; i++) {
        const a = (i / n) * Math.PI * 2
        out.push([cx + Math.cos(a) * rx + r() * jitter, cy + Math.sin(a) * ry + r() * jitter, 0.5])
    }
    return out
}

describe('recognizeStroke', () => {
    it('resamples to evenly spaced points', () => {
        const pts = resample([[0, 0], [100, 0]], 11)
        expect(pts).toHaveLength(11)
        expect(pts[5][0]).toBeCloseTo(50)
    })

    it('turns a rough box into a rectangle', () => {
        const rec = recognizeStroke(drawPath([[0, 0], [300, 0], [300, 160], [0, 160]]))
        expect(rec?.kind).toBe('rect')
        expect(rec.w).toBeGreaterThan(290)
        expect(rec.h).toBeGreaterThan(150)
    })

    it('turns a rough loop into an ellipse, and a near-round one into a circle', () => {
        expect(recognizeStroke(drawEllipse(200, 200, 160, 80))?.kind).toBe('ellipse')
        const c = recognizeStroke(drawEllipse(200, 200, 100, 94))
        expect(c?.kind).toBe('ellipse')
        expect(c.w).toBe(c.h)
    })

    it('tells triangles (either way up) and diamonds apart', () => {
        expect(recognizeStroke(drawPath([[100, 0], [200, 180], [0, 180]]))).toMatchObject({ kind: 'triangle', rotation: 0 })
        expect(recognizeStroke(drawPath([[0, 0], [200, 0], [100, 180]]))).toMatchObject({ kind: 'triangle', rotation: 180 })
        expect(recognizeStroke(drawPath([[100, 0], [200, 100], [100, 200], [0, 100]]))?.kind).toBe('rhombus')
    })

    it('recognises a straight line and snaps it to horizontal', () => {
        const rec = recognizeStroke(drawPath([[0, 0], [300, 9]], { closed: false, per: 40 }))
        expect(rec?.kind).toBe('line')
        expect(rec.to[1]).toBeCloseTo(rec.from[1], 5)
    })

    it('recognises an arrow drawn as shaft-then-head', () => {
        // shaft → tip, then back along one barb
        const pts = drawPath([[0, 100], [300, 100], [260, 75]], { closed: false, per: 30, jitter: 2 })
        const rec = recognizeStroke(pts)
        expect(rec?.kind).toBe('arrow')
        expect(rec.to[0]).toBeGreaterThan(280)
    })

    it('keeps scribbles, squiggles and specks as ink', () => {
        const zig = []
        for (let i = 0; i < 40; i++) zig.push([i * 8, (i % 2) * 60, 0.5])
        expect(recognizeStroke(zig)).toBeNull()
        expect(recognizeStroke([[0, 0], [3, 2], [5, 4]])).toBeNull()
        // A "C": open and curved — neither a line nor a closed shape.
        expect(recognizeStroke(drawEllipse(200, 200, 100, 100, { gap: 28 }))).toBeNull()
    })
})

describe('shapeFromRecognition', () => {
    const style = { stroke: '#e2ddf5', strokeWidth: 3 }
    it('builds a line shape with local points', () => {
        const s = shapeFromRecognition({ kind: 'arrow', from: [100, 50], to: [20, 50] }, style, { points: [] })
        expect(s).toMatchObject({ type: 'shape', x: 20, y: 50, w: 80, h: 1 })
        expect(s.payload).toMatchObject({ kind: 'arrow', points: [80, 0, 0, 0], baseW: 80, baseH: 1 })
        expect(s.payload.sourceInk).toEqual({ points: [] })
    })
    it('builds a box shape, transparent unless a fill is given', () => {
        const s = shapeFromRecognition({ kind: 'rect', x: 1, y: 2, w: 30, h: 40, rotation: 0 }, style, null)
        expect(s.payload).toMatchObject({ kind: 'rect', fill: 'transparent', stroke: '#e2ddf5', strokeWidth: 3 })
    })
})
