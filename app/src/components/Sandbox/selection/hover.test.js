import { describe, it, expect } from 'vitest'
import { nextHoverId, DOT_REACH_PX } from './hover'

// The connection-dot bug: hovering a shape showed its dots 14 px outside the
// edge, but moving onto a dot cleared the hover (the hit-test ended at the
// edge) and the dot vanished before it could be clicked.
const shape = { id: 'a', type: 'shape', x: 100, y: 100, w: 200, h: 100, rotation: 0, payload: { kind: 'rect' } }
const rightDot = { x: 300 + 14, y: 150 }   // where the east dot is drawn at zoom 1

describe('connection-dot hover', () => {
  it('keeps the hover when the pointer reaches a dot outside the shape', () => {
    expect(nextHoverId({ hitId: null, current: shape, world: rightDot, zoom: 1 })).toBe('a')
  })

  it('keeps it while the pointer is over the overlay (the dot itself)', () => {
    expect(nextHoverId({ hitId: null, current: shape, world: { x: 9999, y: 9999 }, onOverlay: true })).toBe('a')
  })

  it('scales the reach with zoom — the dots are a fixed screen distance out', () => {
    // At 0.5 zoom, 14 screen px is 28 world units.
    expect(nextHoverId({ hitId: null, current: shape, world: { x: 300 + 28, y: 150 }, zoom: 0.5 })).toBe('a')
  })

  it('lets go once the pointer is well past the dots', () => {
    expect(nextHoverId({ hitId: null, current: shape, world: { x: 300 + DOT_REACH_PX + 5, y: 150 }, zoom: 1 })).toBeNull()
  })

  it('a shape directly under the pointer wins', () => {
    expect(nextHoverId({ hitId: 'b', current: shape, world: rightDot })).toBe('b')
  })
})
