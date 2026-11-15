import { describe, it, expect } from 'vitest'
import { exportRect } from './exportImage'

describe('exportRect', () => {
    it('a frame: exactly its rectangle', () => {
        expect(exportRect([], { x: 5, y: 6, w: 70, h: 80 })).toEqual({ x: 5, y: 6, w: 70, h: 80 })
    })
    it('items: their bounds plus padding', () => {
        const items = [{ type: 'shape', x: 0, y: 0, w: 100, h: 50 }, { type: 'shape', x: 200, y: 100, w: 50, h: 50 }]
        expect(exportRect(items)).toEqual({ x: -24, y: -24, w: 298, h: 198 })
    })
    it('nothing: null', () => {
        expect(exportRect([])).toBeNull()
    })
})
