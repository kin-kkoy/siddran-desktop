import { describe, it, expect } from 'vitest'
import { cutPolyline, eraseFromStroke, strokeFrame, toDrawFrame } from './precisionErase'
import { strokeOutline } from '../Canvas/strokeOutline'

// Build a committed stroke exactly the way SandboxCanvas does on pointerup.
function makeStroke(points, options = { size: 6, inputType: 'mouse', minDist: 2 }) {
    const flat = strokeOutline(points, { ...options, last: true })
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (let i = 0; i < flat.length; i += 2) {
        minX = Math.min(minX, flat[i]); maxX = Math.max(maxX, flat[i])
        minY = Math.min(minY, flat[i + 1]); maxY = Math.max(maxY, flat[i + 1])
    }
    return {
        id: 's1', type: 'stroke', x: minX, y: minY, w: maxX - minX, h: maxY - minY, rotation: 0, z_index: 4,
        payload: {
            flatOutline: flat.map((v, i) => v - (i % 2 === 0 ? minX : minY)),
            points, color: '#e2ddf5', options, baseW: maxX - minX, baseH: maxY - minY,
        },
    }
}
const horizontal = () => Array.from({ length: 101 }, (_, i) => [i * 3, 100, 0.5])   // x 0…300

describe('cutPolyline', () => {
    const line = [[0, 0], [10, 0], [20, 0], [30, 0], [40, 0]]
    it('misses → null', () => {
        expect(cutPolyline(line, { x: 20, y: 50 }, 5)).toBeNull()
    })
    it('a hole in the middle leaves two runs ending at the circle edge', () => {
        const runs = cutPolyline(line, { x: 20, y: 0 }, 5)
        expect(runs).toHaveLength(2)
        expect(runs[0].at(-1)[0]).toBeCloseTo(15)
        expect(runs[1][0][0]).toBeCloseTo(25)
        expect(runs[0].cutStart).toBe(false)
        expect(runs[0].cutEnd).toBe(true)
        expect(runs[1].cutStart).toBe(true)
        expect(runs[1].cutEnd).toBe(false)
    })
    it('cuts a long segment whose both ends are outside the circle', () => {
        const runs = cutPolyline([[0, 0], [100, 0]], { x: 50, y: 0 }, 10)
        expect(runs.map(r => r.length)).toEqual([2, 2])
        expect(runs[0][1][0]).toBeCloseTo(40)
        expect(runs[1][0][0]).toBeCloseTo(60)
    })
    it('covering everything leaves nothing', () => {
        expect(cutPolyline(line, { x: 20, y: 0 }, 100)).toEqual([])
    })
})

describe('eraseFromStroke', () => {
    it('leaves strokes it does not touch alone', () => {
        expect(eraseFromStroke(makeStroke(horizontal()), { x: 150, y: 300 }, 8)).toBeNull()
    })

    it('splits a stroke in two around the eraser', () => {
        const s = makeStroke(horizontal())
        const pieces = eraseFromStroke(s, { x: 150, y: 100 }, 8)
        expect(pieces).toHaveLength(2)
        const [left, right] = pieces
        // Left piece ends before the hole, right one starts after it.
        expect(left.x + left.w).toBeLessThan(150 - 8)
        expect(right.x).toBeGreaterThan(150 + 8)
        // Both keep the stroke's look and stacking.
        for (const p of pieces) {
            expect(p.z_index).toBe(4)
            expect(p.payload.color).toBe('#e2ddf5')
            expect(p.payload.points.length).toBeGreaterThan(2)
            expect(p.payload.options.end?.taper === 0 || p.payload.options.start?.taper === 0).toBe(true)
        }
        // The far ends are where the original ends were.
        expect(left.x).toBeCloseTo(s.x, 0)
        expect(right.x + right.w).toBeCloseTo(s.x + s.w, 0)
    })

    it('erasing an end trims it instead of splitting', () => {
        const pieces = eraseFromStroke(makeStroke(horizontal()), { x: 0, y: 100 }, 10)
        expect(pieces).toHaveLength(1)
        expect(pieces[0].x).toBeGreaterThan(5)
    })

    it('follows a stroke that was moved and scaled after drawing', () => {
        const s = makeStroke(horizontal())
        // Moved 500 right and stretched to twice its width.
        const moved = { ...s, x: s.x + 500, w: s.w * 2 }
        const f = strokeFrame(moved)
        // The centre of the moved stroke maps back to the centre of the drawing.
        const c = toDrawFrame(f, moved.x + moved.w / 2, moved.y + moved.h / 2)
        expect(c.x).toBeCloseTo(150, 0)
        const pieces = eraseFromStroke(moved, { x: moved.x + moved.w / 2, y: moved.y + moved.h / 2 }, 8)
        expect(pieces).toHaveLength(2)
        // Pieces are placed in the moved frame and keep the 2× stretch.
        expect(pieces[0].x).toBeCloseTo(moved.x, 0)
        expect(pieces[1].x + pieces[1].w).toBeCloseTo(moved.x + moved.w, 0)
        expect(pieces[0].w / pieces[0].payload.baseW).toBeCloseTo(2, 5)
    })

    it('follows a rotated stroke', () => {
        const s = { ...makeStroke(horizontal()), rotation: 90 }
        const cx = s.x + s.w / 2, cy = s.y + s.h / 2
        // Rotated 90°, the stroke now runs vertically through its centre: its
        // left end is at the top. Erase 100 above the centre.
        const pieces = eraseFromStroke(s, { x: cx, y: cy - 100 }, 8)
        expect(pieces).toHaveLength(2)
        expect(pieces.every(p => p.rotation === 90)).toBe(true)
        // Missing the rotated stroke (where it would have been unrotated) does nothing.
        expect(eraseFromStroke(s, { x: cx - 100, y: cy }, 8)).toBeNull()
    })

    it('ignores locked strokes and legacy strokes without samples', () => {
        const s = makeStroke(horizontal())
        expect(eraseFromStroke({ ...s, payload: { ...s.payload, locked: true } }, { x: 150, y: 100 }, 8)).toBeNull()
        expect(eraseFromStroke({ ...s, payload: { ...s.payload, points: undefined } }, { x: 150, y: 100 }, 8)).toBeNull()
    })

    it('a piece can itself be erased again', () => {
        const [left] = eraseFromStroke(makeStroke(horizontal()), { x: 150, y: 100 }, 8)
        const again = eraseFromStroke({ ...left, id: 'p' }, { x: 60, y: 100 }, 8)
        expect(again).toHaveLength(2)
    })
})
