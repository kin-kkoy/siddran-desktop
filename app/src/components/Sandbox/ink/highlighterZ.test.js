import { describe, it, expect } from 'vitest'
import { highlighterZ } from './highlighterZ'
import { strokeStyleFor, withAlpha, loadInk, normalizeInk, DEFAULT_INK } from './presets'

const at = (id, type, z, payload = {}, x = 0) => ({ id, type, x, y: 0, w: 100, h: 50, rotation: 0, z_index: z, payload })
const box = { x: 10, y: 10, w: 50, h: 20 }

describe('highlighterZ', () => {
    it('goes on top when it crosses nothing that should stay above it', () => {
        expect(highlighterZ(box, [], 7)).toBe(7)
        expect(highlighterZ(box, [at('img', 'image', 3)], 7)).toBe(7)
    })
    it('slides beneath the pen ink it crosses', () => {
        expect(highlighterZ(box, [at('ink', 'stroke', 5), at('ink2', 'stroke', 9)], 10)).toBe(4)
    })
    it('slides beneath outline-only shapes but stays above filled ones', () => {
        const items = [at('filled', 'shape', 2, { kind: 'rect', fill: '#5a9cf0' }), at('outline', 'shape', 6, { kind: 'rect', fill: 'transparent' })]
        expect(highlighterZ(box, items, 10)).toBe(5)
    })
    it('never hides beneath a sticky, and goes on top when the stack conflicts', () => {
        const items = [at('ink', 'stroke', 2), at('sticky', 'shape', 6, { kind: 'sticky', fill: '#f5e050' })]
        expect(highlighterZ(box, items, 10)).toBe(10)
    })
    it('ignores things it does not overlap, frames and earlier highlights as covers', () => {
        const items = [at('far', 'stroke', 1, {}, 900), at('hl', 'stroke', 3, { highlighter: true }), at('frame', 'shape', -5, { kind: 'frame' })]
        expect(highlighterZ(box, items, 10)).toBe(10)
    })
})

describe('ink presets', () => {
    it('bakes the highlighter opacity into its colour, flat and pressure-free', () => {
        const s = strokeStyleFor('highlighter', { size: 24, color: '#f5e050', smoothing: 0.5, opacity: 0.35 })
        expect(s.color).toBe('#f5e05059')
        expect(s.highlighter).toBe(true)
        expect(s.options).toMatchObject({ thinning: 0, start: { cap: false, taper: 0 }, end: { cap: false, taper: 0 } })
    })
    it('pen keeps its colour and scales size with tilt', () => {
        const s = strokeStyleFor('pen', { size: 6, color: '#e2ddf5', smoothing: 0.5 }, { tiltMult: 1.5 })
        expect(s).toMatchObject({ color: '#e2ddf5', highlighter: false })
        expect(s.options.size).toBe(9)
    })
    it('withAlpha replaces an existing alpha', () => {
        expect(withAlpha('#11223344', 1)).toBe('#112233')
        expect(withAlpha('#112233', 0.5)).toBe('#11223380')
    })
    it('drops malformed stored presets and migrates the old brush', () => {
        const bad = normalizeInk({ pen: { active: 9, presets: [{ size: 'x', color: 'red' }] } })
        expect(bad.pen.active).toBe(2)
        expect(bad.pen.presets[0]).toEqual(DEFAULT_INK.pen.presets[0])
        const store = new Map([['cinder_sandbox_brush_v3', JSON.stringify({ size: 9, smoothing: 0.2 })]])
        const ink = loadInk({ getItem: (k) => store.get(k) ?? null })
        expect(ink.pen.presets[1]).toMatchObject({ size: 9, smoothing: 0.2, color: '#e2ddf5' })
    })
})
