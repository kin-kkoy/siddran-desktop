import { describe, it, expect } from 'vitest'
import { keepInView } from './camera'

describe('keepInView', () => {
  const size = { w: 1000, h: 500 }
  const cam = { x: 0, y: 0, z: 1 }

  it('leaves the view alone while the node is inside the inner 80%', () => {
    expect(keepInView(cam, { x: 120, y: 60, w: 100, h: 50 }, size)).toBe(cam)
    expect(keepInView(cam, { x: 780, y: 390, w: 100, h: 50 }, size)).toBe(cam)
  })

  it('pans only the axis it crossed, bringing the node halfway to the middle', () => {
    const c = keepInView(cam, { x: 950, y: 200, w: 100, h: 50 }, size)   // into the right band
    expect(c.y).toBe(0)
    // the node's centre lands halfway between the middle (500) and the band's edge (900)
    expect(1000 - c.x).toBeCloseTo(700)
  })

  it('also when it is entirely out of view, at any zoom', () => {
    const z = { x: 0, y: 0, z: 0.5 }                  // the view spans 2000 × 1000
    const c = keepInView(z, { x: -400, y: 1200, w: 100, h: 50 }, size)
    expect(-350 - c.x).toBeCloseTo(1000 - 400)        // left side: 600 from the left edge
    expect(1225 - c.y).toBeCloseTo(500 + 200)
    expect(c.z).toBe(0.5)
  })
})
