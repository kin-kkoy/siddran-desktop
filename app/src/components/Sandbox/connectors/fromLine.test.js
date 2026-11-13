import { describe, it, expect } from 'vitest'
import { endAt, connectorFromLine, convertibleLine } from './fromLine'
import { nearBoxBorder } from '../selection/hitTest'

const box = (id, x, y, w, h, extra = {}) => ({ id, type: 'shape', x, y, w, h, rotation: 0, payload: { kind: 'roundedRect', ...extra } })
// An arrow from (100, 50) down to (100, 200), as the line tool writes it.
const arrow = { id: 'a', type: 'shape', x: 100, y: 50, w: 1, h: 150, rotation: 0,
    payload: { kind: 'arrow', points: [0, 0, 0, 150], baseW: 1, baseH: 150, stroke: '#f0b840', strokeWidth: 3 } }

describe('endAt', () => {
    const top = box('top', 50, 0, 100, 48)        // bottom edge at y=48
    const inner = box('inner', 40, 204, 120, 60)  // top edge at y=204
    const container = box('big', 0, -100, 400, 500)
    const items = [container, top, inner, arrow]
    it('attaches to the box whose border it touches, on that side', () => {
        expect(endAt({ x: 100, y: 50 }, items)).toEqual({ itemId: 'top', side: 's' })
        expect(endAt({ x: 100, y: 200 }, items)).toEqual({ itemId: 'inner', side: 'n' })
    })
    it('an end off-centre on a wide box still takes the edge it sits on', () => {
        expect(endAt({ x: 150, y: 204 }, items).side).toBe('n')
    })
    it('far from any border: a free point', () => {
        expect(endAt({ x: 300, y: 150 }, items)).toEqual({ point: { x: 300, y: 150 } })
    })
})

describe('connectorFromLine', () => {
    it('keeps colour, width and the arrowhead; sets the routing', () => {
        const c = connectorFromLine(arrow, [box('top', 50, 0, 100, 48), box('inner', 40, 204, 120, 60), arrow], 'curved')
        expect(c.type).toBe('connector')
        expect(c.payload).toMatchObject({ routing: 'curved', head: 'arrow', stroke: '#f0b840', strokeWidth: 3,
            from: { itemId: 'top', side: 's' }, to: { itemId: 'inner', side: 'n' } })
    })
    it('a plain line has no head', () => {
        const line = { ...arrow, payload: { ...arrow.payload, kind: 'line' } }
        expect(connectorFromLine(line, [line], 'straight').payload.head).toBe('none')
    })
    it('only lines, arrows and elbow arrows convert', () => {
        expect(convertibleLine(arrow)).toBe(true)
        expect(convertibleLine(box('b', 0, 0, 10, 10))).toBe(false)
        expect(convertibleLine({ ...arrow, payload: { kind: 'taperedArrow' } })).toBe(false)
    })
})

describe('nearBoxBorder', () => {
    const b = box('b', 0, 0, 200, 100)
    it('true on the outline, false in the empty middle', () => {
        expect(nearBoxBorder(b, 2, 50, 6)).toBe(true)
        expect(nearBoxBorder(b, 100, 98, 6)).toBe(true)
        expect(nearBoxBorder(b, 100, 50, 6)).toBe(false)
    })
})
