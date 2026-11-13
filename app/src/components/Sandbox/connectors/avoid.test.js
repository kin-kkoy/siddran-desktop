import { describe, it, expect } from 'vitest'
import { pathHits, shortestAround, roundCorners, aroundBoxes } from './avoid'
import { routeConnector } from './geometry'

const box = (x, y, w, h) => ({ x, y, w, h })
const segsClear = (pts, boxes) => !pathHits(pts, boxes)

describe('avoid', () => {
  it('sees a segment through a box, not one along its edge', () => {
    expect(pathHits([0, 50, 200, 50], [box(50, 0, 100, 100)])).toBe(true)
    expect(pathHits([0, 0, 200, 0], [box(50, 0, 100, 100)])).toBe(false)
    expect(pathHits([0, 150, 200, 150], [box(50, 0, 100, 100)])).toBe(false)
  })

  it('finds the shortest way round one box', () => {
    const path = shortestAround({ x: 0, y: 50 }, { x: 300, y: 50 }, [box(100, 0, 100, 120)])
    expect(path.map((p) => [p.x, p.y])).toEqual([[0, 50], [100, 0], [200, 0], [300, 50]])   // over the top: shorter than under
  })

  it('returns null when there is no way through', () => {
    expect(shortestAround({ x: 0, y: 0 }, { x: 10, y: 10 }, [box(-50, -50, 100, 100)])).toBeNull()
  })

  it('goes direct when nothing is in the way', () => {
    expect(aroundBoxes([0, 0, 0, 300], { x: 0, y: 0 }, { x: 0, y: 300 }, 's', 'n', [box(100, 100, 50, 50)], false)).toBeNull()
  })

  it('goes round a box in the way, leaving and arriving square to the sides', () => {
    const blocker = box(-60, 120, 120, 60)
    const pts = routeConnector({ x: 0, y: 0 }, { x: 0, y: 300 }, 'straight', {
      fromSide: 's', toSide: 'n', fromBox: box(-60, -60, 120, 60), toBox: box(-60, 300, 120, 60), avoid: true, obstacles: () => [blocker],
    })
    expect(pts.length).toBeGreaterThan(4)
    expect(segsClear(pts, [blocker])).toBe(true)
    expect(pts.slice(0, 4)).toEqual([0, 0, 0, 20])                  // straight out of the bottom first
    expect(pts.slice(-4)).toEqual([0, 280, 0, 300])                  // and straight into the top
    // off: straight through, as before
    expect(routeConnector({ x: 0, y: 0 }, { x: 0, y: 300 }, 'straight', { obstacles: () => [blocker] })).toEqual([0, 0, 0, 300])
  })

  it('a curved link goes round with rounded corners, still clear', () => {
    const blocker = box(-60, 120, 120, 60)
    const pts = routeConnector({ x: 0, y: 0 }, { x: 0, y: 300 }, 'curved', {
      fromSide: 's', toSide: 'n', fromBox: box(-60, -60, 120, 60), toBox: box(-60, 300, 120, 60), avoid: true, obstacles: () => [blocker],
    })
    expect(pts.length).toBeGreaterThan(20)
    expect(segsClear(pts, [blocker])).toBe(true)
  })

  it('never cuts back through its own box', () => {
    // target above the source: the direct line would leave through the source box
    const from = box(-60, 200, 120, 60), to = box(200, 0, 120, 60)
    const pts = routeConnector({ x: 0, y: 260 }, { x: 260, y: 0 }, 'straight', { fromSide: 's', toSide: 'n', fromBox: from, toBox: to, avoid: true, obstacles: () => [] })
    expect(segsClear(pts, [from, to])).toBe(true)
  })

  it('ignores a frame round the whole diagram', () => {
    const frame = box(-500, -500, 1000, 1000), blocker = box(-60, 120, 120, 60)
    const pts = routeConnector({ x: 0, y: 0 }, { x: 0, y: 300 }, 'straight', { fromSide: 's', toSide: 'n', avoid: true, obstacles: () => [frame, blocker] })
    expect(segsClear(pts, [blocker])).toBe(true)
  })

  it('rounds corners into a smooth polyline', () => {
    const pts = roundCorners([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }])
    expect(pts.slice(0, 2)).toEqual([0, 0])
    expect(pts.slice(-2)).toEqual([100, 100])
    expect(pts.length).toBe(2 + 9 * 2 + 2)
  })
})
