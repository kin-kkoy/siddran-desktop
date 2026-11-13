import { describe, it, expect } from 'vitest'
import { connectedTo, boardLink, glowFor } from './connected'

const links = [
    { id: 'l1', from: 'a', to: 'b' },
    { id: 'l2', from: 'b', to: 'c' },
    { id: 'l3', from: 'd', to: null },
]

describe('connectedTo', () => {
    it('a node brings its links and their other ends', () => {
        const r = connectedTo(links, ['b'])
        expect([...r.nodes].sort()).toEqual(['a', 'b', 'c'])
        expect([...r.links].sort()).toEqual(['l1', 'l2'])
    })
    it('a link brings its two ends only', () => {
        const r = connectedTo(links, [], ['l1'])
        expect([...r.nodes].sort()).toEqual(['a', 'b'])
        expect([...r.links]).toEqual(['l1'])
    })
    it('a free end adds no node', () => {
        const r = connectedTo(links, ['d'])
        expect([...r.nodes]).toEqual(['d'])
        expect([...r.links]).toEqual(['l3'])
    })
    it('nothing connected → just the selection', () => {
        const r = connectedTo(links, ['z'])
        expect([...r.nodes]).toEqual(['z'])
        expect(r.links.size).toBe(0)
    })
    it('several nodes take the union', () => {
        const r = connectedTo(links, new Set(['a', 'c']))
        expect([...r.nodes].sort()).toEqual(['a', 'b', 'c'])
        expect([...r.links].sort()).toEqual(['l1', 'l2'])
    })
})

describe('boardLink', () => {
    it('reads the item ids of both ends', () => {
        expect(boardLink({ id: 7, payload: { from: { itemId: 1, side: 'e' }, to: { point: { x: 0, y: 0 } } } }))
            .toEqual({ id: 7, from: 1, to: null })
    })
})

describe('glowFor', () => {
    const items = [
        { id: 1, type: 'shape' }, { id: 2, type: 'shape' }, { id: 3, type: 'shape' }, { id: 4, type: 'shape' },
        { id: 10, type: 'connector', payload: { from: { itemId: 1 }, to: { itemId: 2 } } },
        { id: 11, type: 'connector', payload: { from: { itemId: 2 }, to: { itemId: 3 } } },
    ]
    it('a box: its links and the boxes at their ends, not itself', () => {
        const g = glowFor(items, new Set([2]))
        expect([...g.nodes].sort()).toEqual([1, 3])
        expect([...g.links].sort()).toEqual([10, 11])
    })
    it('a link: its two ends, not itself', () => {
        const g = glowFor(items, new Set([10]))
        expect([...g.nodes].sort()).toEqual([1, 2])
        expect(g.links.size).toBe(0)
    })
    it('several selected → null (a whole diagram, select-all)', () => {
        expect(glowFor(items, new Set([1, 2]))).toBeNull()
    })
    it('nothing connected → null', () => {
        expect(glowFor(items, new Set([4]))).toBeNull()
        expect(glowFor(items, new Set())).toBeNull()
    })
})
