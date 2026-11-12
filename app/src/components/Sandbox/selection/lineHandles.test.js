import { describe, it, expect } from 'vitest'
import { lineWorldPoints, lineHandles, dragLineHandle, straightenLine } from './lineHandles'

const arrow = { id: 'a', type: 'shape', x: 100, y: 100, w: 200, h: 50, rotation: 0,
    payload: { kind: 'arrow', stroke: '#fff', strokeWidth: 2, points: [0, 50, 200, 0], baseW: 200, baseH: 50 } }

describe('lineHandles', () => {
    it('maps local points to the world, honouring scale and rotation', () => {
        expect(lineWorldPoints(arrow)).toEqual([{ x: 100, y: 150 }, { x: 300, y: 100 }])
        // Stretched to twice the width: the far end moves out.
        expect(lineWorldPoints({ ...arrow, w: 400 })[1]).toEqual({ x: 500, y: 100 })
        // Rotated 180° about its centre: the ends swap places.
        const r = lineWorldPoints({ ...arrow, rotation: 180 })
        expect(r[0].x).toBeCloseTo(300); expect(r[0].y).toBeCloseTo(100)
    })

    it('offers ends and a middle for arrows, only ends for others', () => {
        expect(lineHandles(arrow)).toMatchObject({ start: { x: 100, y: 150 }, end: { x: 300, y: 100 }, mid: { x: 200, y: 125 }, curved: false })
        expect(lineHandles({ ...arrow, payload: { ...arrow.payload, kind: 'elbowArrow' } }).mid).toBeUndefined()
    })

    it('dragging an end re-fits the box around the new points', () => {
        const p = dragLineHandle(arrow, 'end', { x: 400, y: 300 })
        expect(p).toMatchObject({ x: 100, y: 150, w: 300, h: 150, rotation: 0 })
        expect(p.payload.points).toEqual([0, 0, 300, 150])
        expect(p.payload.baseW).toBe(300)
    })

    it('dragging the middle curves it through that point, and it can be straightened', () => {
        const p = dragLineHandle(arrow, 'mid', { x: 200, y: 40 })
        const curved = { ...arrow, ...p }
        expect(curved.payload.curved).toBe(true)
        expect(lineWorldPoints(curved)).toEqual([{ x: 100, y: 150 }, { x: 200, y: 40 }, { x: 300, y: 100 }])
        expect(lineHandles(curved).mid).toEqual({ x: 200, y: 40 })
        // Moving an end keeps the bend.
        const moved = { ...curved, ...dragLineHandle(curved, 'start', { x: 50, y: 150 }) }
        expect(lineWorldPoints(moved)[1]).toEqual({ x: 200, y: 40 })
        const straight = { ...moved, ...straightenLine(moved) }
        expect(straight.payload.curved).toBeUndefined()
        expect(lineWorldPoints(straight)).toHaveLength(2)
    })

    it('keeps an elbow square and a divider level', () => {
        const elbow = { ...arrow, payload: { ...arrow.payload, kind: 'elbowArrow', points: [0, 50, 200, 50, 200, 0] } }
        const e = dragLineHandle(elbow, 'end', { x: 260, y: 300 })
        expect(lineWorldPoints({ ...elbow, ...e })).toEqual([{ x: 100, y: 150 }, { x: 260, y: 150 }, { x: 260, y: 300 }])
        const div = { ...arrow, h: 1, payload: { ...arrow.payload, kind: 'divider', points: [0, 0, 200, 0], baseH: 1 } }
        const d = dragLineHandle(div, 'end', { x: 500, y: 900 })
        const pts = lineWorldPoints({ ...div, ...d })
        expect(pts[1].y).toBe(pts[0].y)
    })
})
