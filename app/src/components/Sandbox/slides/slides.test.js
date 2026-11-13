import { describe, it, expect } from 'vitest'
import { readingOrder, deckOrder, presentedFrames, reorderPatches, fitFrameViewport, startIndex, stepIndex, frameContents } from './slides'

const frame = (id, x, y, extra = {}, w = 100, h = 60) =>
    ({ id, type: 'shape', x, y, w, h, payload: { kind: 'frame', title: id, ...extra } })
const ids = (fs) => fs.map(f => f.id)

describe('readingOrder', () => {
    it('reads rows top to bottom, each left to right', () => {
        const fs = [frame('c', 0, 100), frame('b', 200, 5), frame('a', 0, 0), frame('d', 200, 110)]
        expect(ids(readingOrder(fs))).toEqual(['a', 'b', 'c', 'd'])
    })
    it('a frame lower by more than half a row starts a new row', () => {
        const fs = [frame('a', 300, 0), frame('b', 0, 40)]
        expect(ids(readingOrder(fs))).toEqual(['a', 'b'])
    })
})

describe('deckOrder', () => {
    it('falls back to reading order and ignores non-frames', () => {
        const items = [frame('b', 200, 0), { id: 'x', type: 'shape', x: 0, y: 0, w: 1, h: 1, payload: { kind: 'rect' } }, frame('a', 0, 0)]
        expect(ids(deckOrder(items))).toEqual(['a', 'b'])
    })
    it('numbered frames come first, the rest follow in reading order', () => {
        const items = [frame('a', 0, 0), frame('b', 200, 0, { slideOrder: 2 }), frame('c', 400, 0, { slideOrder: 1 }), frame('d', 0, 200)]
        expect(ids(deckOrder(items))).toEqual(['c', 'b', 'a', 'd'])
    })
    it('breaks ties in slideOrder by reading order', () => {
        const items = [frame('b', 200, 0, { slideOrder: 1 }), frame('a', 0, 0, { slideOrder: 1 })]
        expect(ids(deckOrder(items))).toEqual(['a', 'b'])
    })
})

describe('presentedFrames', () => {
    it('skips hidden slides', () => {
        const items = [frame('a', 0, 0), frame('b', 200, 0, { slideHidden: true }), frame('c', 400, 0)]
        expect(ids(presentedFrames(items))).toEqual(['a', 'c'])
    })
})

describe('reorderPatches', () => {
    const items = [frame('a', 0, 0), frame('b', 200, 0), frame('c', 400, 0)]
    it('numbers every frame 1..n in the new order', () => {
        expect(reorderPatches(items, 'c', 0)).toEqual([
            { id: 'c', slideOrder: 1 }, { id: 'a', slideOrder: 2 }, { id: 'b', slideOrder: 3 },
        ])
    })
    it('only patches frames whose number changes', () => {
        const numbered = [frame('a', 0, 0, { slideOrder: 1 }), frame('b', 200, 0, { slideOrder: 2 }), frame('c', 400, 0, { slideOrder: 3 })]
        expect(reorderPatches(numbered, 'c', 1)).toEqual([{ id: 'c', slideOrder: 2 }, { id: 'b', slideOrder: 3 }])
    })
    it('clamps the target and ignores unknown ids', () => {
        expect(reorderPatches(items, 'a', 99).map(p => p.id)).toEqual(['b', 'c', 'a'])
        expect(reorderPatches(items, 'zz', 0)).toEqual([])
    })
})

describe('fitFrameViewport', () => {
    it('letterboxes a 16:9 frame in a 4:3 screen, centred', () => {
        const v = fitFrameViewport({ x: 100, y: 50, w: 1600, h: 900 }, 800, 600)
        expect(v.zoom).toBeCloseTo(0.5)
        // frame centre (900, 500) lands on the screen centre (400, 300)
        expect(900 * v.zoom + v.x).toBeCloseTo(400, 0)
        expect(500 * v.zoom + v.y).toBeCloseTo(300, 0)
    })
    it('keeps the padding free', () => {
        const v = fitFrameViewport({ x: 0, y: 0, w: 100, h: 100 }, 200, 400, 20)
        expect(v.zoom).toBeCloseTo(1.6)
    })
})

describe('startIndex', () => {
    const items = [frame('a', 0, 0), frame('b', 200, 0, { slideHidden: true }), frame('c', 400, 0), frame('big', 380, -20, {}, 300, 200)]
    const shown = presentedFrames(items)
    it('starts at the selected frame', () => {
        expect(shown[startIndex(items, shown, { selectedIds: new Set(['c']) })].id).toBe('c')
    })
    it('a selected hidden frame starts at the next shown one', () => {
        expect(shown[startIndex(items, shown, { selectedIds: new Set(['b']) })].id).toBe(ids(shown)[ids(shown).indexOf('a') + 1])
    })
    it('else the smallest frame under the view centre', () => {
        expect(shown[startIndex(items, shown, { center: { x: 450, y: 30 } })].id).toBe('c')
        expect(shown[startIndex(items, shown, { center: { x: 650, y: 150 } })].id).toBe('big')
    })
    it('else the first slide; -1 for an empty deck', () => {
        expect(startIndex(items, shown, { center: { x: -999, y: -999 } })).toBe(0)
        expect(startIndex([], [], {})).toBe(-1)
    })
})

describe('stepIndex', () => {
    it('clamps to the deck', () => {
        expect(stepIndex(0, -1, 3)).toBe(0)
        expect(stepIndex(2, 1, 3)).toBe(2)
        expect(stepIndex(1, 1, 3)).toBe(2)
        expect(stepIndex(0, 1, 0)).toBe(-1)
    })
})

describe('frameContents', () => {
    it('takes what meets the frame, frames first and cards last', () => {
        const f = frame('f', 0, 0, {}, 200, 200)
        const items = [
            f,
            { id: 'card', type: 'text', x: 150, y: 150, w: 100, h: 40, z_index: 1, payload: {} },
            { id: 'box', type: 'shape', x: 10, y: 10, w: 20, h: 20, z_index: 9, payload: { kind: 'rect' } },
            { id: 'far', type: 'shape', x: 500, y: 500, w: 20, h: 20, payload: { kind: 'rect' } },
            frame('inner', 20, 20, {}, 50, 50),
        ]
        expect(frameContents(f, items).map(i => i.id)).toEqual(['inner', 'box', 'card'])
    })
})
