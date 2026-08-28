import { describe, it, expect } from 'vitest'
import { shapePath } from './diagramSvg'
import { SHAPES } from '../components/Sandbox/shapes/registry'

// These cover the PathRecorder — the part that lets the Sandbox's own shape
// geometry emit SVG instead of canvas strokes. The DOM half of diagramSvg
// (building the <svg> tree) is exercised in the app: this repo's vitest runs in
// the node environment with no jsdom, so `document` does not exist here.

const numbersIn = (d) => (d.match(/-?\d+(\.\d+)?/g) || []).map(Number)

describe('shapePath', () => {
  it('returns null for kinds an SVG primitive draws instead', () => {
    // rect / roundedRect / ellipse have no registry render fn — shapeElement
    // emits <rect>/<ellipse> for them. Null is the signal, not a failure.
    expect(shapePath('rect', 100, 60)).toBeNull()
    expect(shapePath('ellipse', 100, 60)).toBeNull()
  })

  it('returns null for an unknown kind rather than throwing', () => {
    expect(shapePath('no-such-shape', 100, 60)).toBeNull()
  })

  it('draws a closed triangle inside its box', () => {
    const d = shapePath('triangle', 100, 60)
    expect(d.startsWith('M')).toBe(true)
    expect(d.endsWith('Z')).toBe(true)
    const n = numbersIn(d)
    const xs = n.filter((_, i) => i % 2 === 0)
    const ys = n.filter((_, i) => i % 2 === 1)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...xs)).toBeLessThanOrEqual(100)
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...ys)).toBeLessThanOrEqual(60)
  })

  it('draws the flowchart diamond', () => {
    const d = shapePath('rhombus', 100, 60)
    // Four corners, closed: the midpoints of each edge of the box.
    expect(d).toContain('M50 0')
    expect(d).toContain('L100 30')
    expect(d).toContain('L50 60')
    expect(d).toContain('L0 30')
    expect(d.endsWith('Z')).toBe(true)
  })

  it('rounds corners when a radius is given, and stays inside the box', () => {
    const square = shapePath('rhombus', 100, 60, 0)
    const round = shapePath('rhombus', 100, 60, 10)
    expect(round).not.toBe(square)
    // A fillet is flattened into extra segments, so the rounded path is longer.
    expect((round.match(/L/g) || []).length).toBeGreaterThan((square.match(/L/g) || []).length)
    const n = numbersIn(round)
    expect(n.every(v => Number.isFinite(v))).toBe(true)
  })

  it('handles the cylinder, which is the only shape using elliptical arcs', () => {
    const d = shapePath('cylinder', 100, 80)
    expect(d).toBeTruthy()
    expect(numbersIn(d).every(v => Number.isFinite(v))).toBe(true)
    // Two caps plus the body means the path restarts at least once.
    expect((d.match(/M/g) || []).length).toBeGreaterThanOrEqual(2)
  })

  it('never emits NaN for any registry shape, at any radius', () => {
    // The recorder is the single point where every shape's geometry is
    // re-expressed; one bad clamp would silently produce an invisible path.
    for (const kind of Object.keys(SHAPES)) {
      for (const radius of [0, 4, 40, 1000]) {
        const d = shapePath(kind, 120, 80, radius)
        if (d == null) continue
        expect(d, `${kind} @ r=${radius}`).not.toContain('NaN')
        expect(numbersIn(d).every(Number.isFinite), `${kind} @ r=${radius}`).toBe(true)
      }
    }
  })

  it('survives a degenerate box', () => {
    for (const kind of Object.keys(SHAPES)) {
      const d = shapePath(kind, 1, 1, 8)
      if (d == null) continue
      expect(d, kind).not.toContain('NaN')
    }
  })
})
