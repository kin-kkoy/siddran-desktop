import { describe, it, expect } from 'vitest'
import { SHAPES, SHAPE_GROUPS, shapesInGroup, ALL_SHAPES, isLineKind } from './registry'
import { shapePath } from '../../../utils/diagramSvg'

// Every filled shape has to survive the trip through diagramSvg's PathRecorder,
// or it would draw on the canvas and vanish from a note diagram. The recorder
// throws on a ctx method it does not implement, which is what we want here.
describe('shape registry', () => {
    const drawn = Object.keys(SHAPES).filter(k => SHAPES[k].render)

    it.each(drawn)('%s records a finite, non-empty SVG path', (kind) => {
        for (const [w, h] of [[120, 80], [40, 160], [1, 1]]) {
            const d = shapePath(kind, w, h, 6)
            expect(d).toBeTruthy()
            expect(d.startsWith('M')).toBe(true)
            expect(d).not.toMatch(/NaN|Infinity/)
        }
    })

    it('every kind belongs to a known group', () => {
        const groups = new Set([...SHAPE_GROUPS.map(g => g.id), 'sticky', 'frame'])
        for (const k of Object.keys(SHAPES)) expect(groups.has(SHAPES[k].group)).toBe(true)
    })

    it('ships the basic, flowchart and callout packs', () => {
        expect(shapesInGroup('basic').length).toBeGreaterThanOrEqual(18)
        expect(shapesInGroup('flowchart').length).toBeGreaterThanOrEqual(10)
        expect(shapesInGroup('callout').length).toBeGreaterThanOrEqual(4)
    })

    it('keeps every kind the CLI and older boards already write', () => {
        for (const k of ['rect', 'roundedRect', 'ellipse', 'triangle', 'rhombus', 'pentagon', 'hexagon', 'star',
            'speechBubble', 'cylinder', 'parallelogram', 'blockArrow', 'line', 'arrow', 'elbowArrow', 'divider']) {
            expect(SHAPES[k]).toBeTruthy()
        }
    })

    it('hides the sticky from the generic shape grid', () => {
        expect(ALL_SHAPES).not.toContain('sticky')
        expect(ALL_SHAPES).not.toContain('frame')
        expect(isLineKind('sticky')).toBe(false)
    })
})
