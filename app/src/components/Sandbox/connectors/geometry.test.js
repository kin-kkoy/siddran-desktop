import { describe, it, expect } from 'vitest'
import { routeConnector, connectorPoints } from './geometry'

const pairs = (pts) => { const o = []; for (let i = 0; i < pts.length; i += 2) o.push([pts[i], pts[i + 1]]); return o }
// Every segment is horizontal or vertical.
const orthogonal = (pts) => pairs(pts).every((p, i, a) => i === 0 || p[0] === a[i - 1][0] || p[1] === a[i - 1][1])

describe('routeConnector with sides', () => {
  it('leaves the bottom and enters the top, even when the target is mostly sideways', () => {
    // Bottom-centre of a diamond to top-centre of a box down and to the left —
    // the case that used to run horizontally into the top of the box.
    const pts = pairs(routeConnector({ x: 160, y: 247 }, { x: 85, y: 320 }, 'elbow', { fromSide: 's', toSide: 'n' }))
    expect(pts[0]).toEqual([160, 247])
    expect(pts[1][0]).toBe(160)                         // first move is straight down
    expect(pts.at(-2)[0]).toBe(85)                      // last move is straight down…
    expect(pts.at(-2)[1]).toBeLessThan(320)             // …from above the target
  })

  it('goes round the side for a link back up to an earlier step', () => {
    const fromBox = { x: 200, y: 450, w: 120, h: 70 }  // lower box
    const toBox = { x: 70, y: 180, w: 180, h: 70 }     // upper box, overlapping horizontally
    const pts = routeConnector({ x: 260, y: 520 }, { x: 160, y: 180 }, 'elbow', { fromSide: 's', toSide: 'n', fromBox, toBox })
    expect(orthogonal(pts)).toBe(true)
    const xs = pairs(pts).map((p) => p[0])
    expect(Math.max(...xs)).toBeGreaterThan(320)        // outside both boxes
  })

  it('makes a U when both ends face the same way', () => {
    const pts = pairs(routeConnector({ x: 0, y: 50 }, { x: 200, y: 80 }, 'elbow', { fromSide: 's', toSide: 's' }))
    expect(pts[1][1]).toBeGreaterThan(80)               // below the lower of the two
    expect(pts.length).toBe(4)
  })

  it('handles left/right sides the same way, turned', () => {
    const pts = pairs(routeConnector({ x: 100, y: 0 }, { x: 300, y: 90 }, 'elbow', { fromSide: 'e', toSide: 'w' }))
    expect(pts[1][1]).toBe(0)
    expect(pts.at(-2)[1]).toBe(90)
  })

  it('draws an L when one side is vertical and the other horizontal', () => {
    expect(routeConnector({ x: 0, y: 0 }, { x: 100, y: 100 }, 'elbow', { fromSide: 's', toSide: 'w' })).toEqual([0, 0, 0, 100, 100, 100])
  })

  it('a straight drop needs no corners', () => {
    expect(routeConnector({ x: 50, y: 0 }, { x: 50, y: 100 }, 'elbow', { fromSide: 's', toSide: 'n' })).toEqual([50, 0, 50, 100])
  })

  it('keeps the old dog-leg for a free end', () => {
    expect(routeConnector({ x: 0, y: 0 }, { x: 100, y: 10 })).toEqual([0, 0, 50, 0, 50, 10, 100, 10])
  })
})

describe('connectorPoints', () => {
  const shape = (id, x, y, rotation = 0) => ({ id, type: 'shape', x, y, w: 100, h: 50, rotation, payload: {} })
  it('uses the stored sides', () => {
    const byId = new Map([['a', shape('a', 0, 0)], ['b', shape('b', 200, 200)]])
    const pts = connectorPoints({ payload: { from: { itemId: 'a', side: 's' }, to: { itemId: 'b', side: 'n' } } }, byId)
    expect(pts.slice(0, 4)).toEqual([50, 50, 50, 125])   // halfway between the two 20px stubs
    expect(pts.slice(-2)).toEqual([250, 200])
  })
  it('ignores sides on a rotated box', () => {
    const byId = new Map([['a', shape('a', 0, 0, 45)], ['b', shape('b', 200, 200)]])
    const pts = connectorPoints({ payload: { from: { itemId: 'a', side: 's' }, to: { itemId: 'b', side: 'n' } } }, byId)
    expect(pts).toHaveLength(8)                          // the plain dog-leg
  })
})

describe('detours clear the boxes in between', () => {
  it('a U loop runs outside a box standing between its ends', () => {
    // Users DB (lower) back up to the diamond (upper), both on their east side,
    // with "Login form" sticking out further right in between.
    const shape = (id, x, y, w, h) => ({ id, type: 'shape', x, y, w, h, rotation: 0, payload: {} })
    const byId = new Map([
      ['db', shape('db', 438, 468, 122, 76)],
      ['q', shape('q', 310, 196, 182, 72)],
      ['form', shape('form', 415, 340, 168, 56)],
    ])
    const pts = connectorPoints({ payload: { from: { itemId: 'db', side: 'e' }, to: { itemId: 'q', side: 'e' } } }, byId)
    const xs = pts.filter((_, i) => i % 2 === 0)
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(583 + 20)
  })
})
