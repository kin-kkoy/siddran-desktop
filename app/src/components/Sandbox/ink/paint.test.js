import { describe, it, expect } from 'vitest'
import { paintPayload } from './paint'

const shape = (payload, type = 'shape') => ({ id: 'x', type, payload })

describe('paintPayload', () => {
    it('fills box shapes, stickies and frames', () => {
        expect(paintPayload(shape({ kind: 'rect', fill: 'transparent' }), '#5a9cf0').fill).toBe('#5a9cf0')
        expect(paintPayload(shape({ kind: 'sticky', fill: '#f5e050' }), '#7ee07e').fill).toBe('#7ee07e')
        expect(paintPayload(shape({ kind: 'frame', fill: 'x' }), '#11223344').fill).toBe('#11223344')
    })
    it('"no fill" empties a box but never a sticky', () => {
        expect(paintPayload(shape({ kind: 'ellipse', fill: '#fff' }), 'transparent').fill).toBe('transparent')
        expect(paintPayload(shape({ kind: 'sticky', fill: '#fff' }), 'transparent')).toBeNull()
    })
    it('recolours lines, arrows and connectors by their stroke', () => {
        expect(paintPayload(shape({ kind: 'arrow', stroke: '#fff' }), '#e05c5c')).toMatchObject({ stroke: '#e05c5c' })
        expect(paintPayload(shape({ stroke: '#fff' }, 'connector'), '#e05c5c')).toMatchObject({ stroke: '#e05c5c' })
        expect(paintPayload(shape({ kind: 'line', stroke: '#fff' }), 'transparent')).toBeNull()
    })
    it('recolours ink, keeping a highlight see-through', () => {
        expect(paintPayload(shape({ color: '#ffffff' }, 'stroke'), '#e05c5c').color).toBe('#e05c5c')
        expect(paintPayload(shape({ color: '#f5e05059', highlighter: true }, 'stroke'), '#7ee07e').color).toBe('#7ee07e59')
    })
    it('leaves images and locked things alone', () => {
        expect(paintPayload(shape({ url: 'a' }, 'image'), '#fff')).toBeNull()
        expect(paintPayload(shape({ kind: 'rect', locked: true }), '#fff')).toBeNull()
    })
})
