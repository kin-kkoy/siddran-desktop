import { describe, it, expect } from 'vitest'
import { routeConnector, CURVE_SEGMENTS } from './geometry'
import { headGeometry, trimPath, pathEnds, HEAD_TYPES, headInset } from './heads'
import { lineStyleOf, dashFor } from './lineStyle'

describe('curved routing', () => {
  const a = { x: 0, y: 0 }, b = { x: 300, y: 200 }

  it('starts and ends exactly on the endpoints', () => {
    const pts = routeConnector(a, b, 'curved', { fromSide: 's', toSide: 'n' })
    expect(pts.length).toBe((CURVE_SEGMENTS + 1) * 2)
    expect(pts.slice(0, 2)).toEqual([0, 0])
    expect(pts.slice(-2)).toEqual([300, 200])
  })

  it('leaves perpendicular to the attached side', () => {
    const down = routeConnector(a, b, 'curved', { fromSide: 's', toSide: 'n' })
    expect(Math.abs(down[2] - down[0])).toBeLessThan(Math.abs(down[3] - down[1]))   // first step mostly down
    const right = routeConnector(a, b, 'curved', { fromSide: 'e', toSide: 'w' })
    expect(Math.abs(right[2] - right[0])).toBeGreaterThan(Math.abs(right[3] - right[1]))
  })

  it('works with free ends (no sides)', () => {
    const pts = routeConnector(a, b, 'curved')
    expect(pts.every(Number.isFinite)).toBe(true)
  })
})

describe('connector heads', () => {
  const tip = { x: 100, y: 0 }, prev = { x: 0, y: 0 }

  it.each(HEAD_TYPES.filter(t => t !== 'none'))('%s has finite geometry at the tip', (type) => {
    const g = headGeometry(type, tip, prev, 2)
    expect(g).toBeTruthy()
    const nums = g.shape === 'circle' ? [g.cx, g.cy, g.r] : g.pts
    expect(nums.every(Number.isFinite)).toBe(true)
    if (g.shape === 'poly') expect(Math.max(...g.pts.filter((_, i) => i % 2 === 0))).toBeLessThanOrEqual(100.0001)
  })

  it('none and unknown draw nothing', () => {
    expect(headGeometry('none', tip, prev)).toBeNull()
    expect(headGeometry('bogus', tip, prev)).toBeNull()
  })

  it('points the arrow the way the line travels', () => {
    const g = headGeometry('arrow', { x: 0, y: 100 }, { x: 0, y: 0 }, 2)
    expect(g.pts[0]).toBe(0); expect(g.pts[1]).toBe(100)
    expect(g.pts[3]).toBeLessThan(100)   // the barbs sit behind the tip
  })

  it('trims the line so a head is not overdrawn, never past the segment', () => {
    const pts = [0, 0, 100, 0]
    const t = trimPath(pts, 0, headInset('arrow', 2))
    expect(t[2]).toBeLessThan(100)
    expect(trimPath([0, 0, 3, 0], 50, 50).every(Number.isFinite)).toBe(true)
    expect(pathEnds([0, 0, 5, 5, 10, 0]).end.prev).toEqual({ x: 5, y: 5 })
  })
})

describe('line style', () => {
  it('keeps the older dash flag meaning dashed', () => {
    expect(lineStyleOf({ dash: true })).toBe('dashed')
    expect(lineStyleOf({})).toBe('solid')
    expect(lineStyleOf({ dash: true, lineStyle: 'dotted' })).toBe('dotted')
    expect(dashFor({})).toBeUndefined()
    expect(dashFor({ lineStyle: 'dashed', strokeWidth: 2 })).toEqual([8, 6])
  })
})

describe('connector bend', () => {
  const a = { x: 0, y: 0 }, b = { x: 200, y: 100 }
  const mid = { x: 100, y: 50 }
  const passes = (pts, M) => { for (let i = 0; i < pts.length; i += 2) if (Math.abs(pts[i] - M.x) < 0.6 && Math.abs(pts[i + 1] - M.y) < 0.6) return true; return false }

  it('a straight line bends through the handle', () => {
    const pts = routeConnector(a, b, 'straight', { bend: { dx: 0, dy: -60 } })
    expect(pts).toEqual([0, 0, 100, -10, 200, 100])
  })

  it('a curve passes through the handle', () => {
    const M = { x: mid.x + 30, y: mid.y - 40 }
    const pts = routeConnector(a, b, 'curved', { fromSide: 'e', toSide: 'w', bend: { dx: 30, dy: -40 } })
    expect(passes(pts, M)).toBe(true)
  })

  it('an elbow moves its middle run to the handle and stays orthogonal', () => {
    const pts = routeConnector(a, b, 'elbow', { fromSide: 's', toSide: 'n', bend: { dx: 0, dy: 20 } })
    const ys = []; for (let i = 1; i < pts.length; i += 2) ys.push(pts[i])
    expect(ys).toContain(70)
    for (let i = 2; i < pts.length; i += 2) expect(pts[i] === pts[i - 2] || pts[i + 1] === pts[i - 1]).toBe(true)
  })

  it('ignores a malformed bend', () => {
    expect(routeConnector(a, b, 'straight', { bend: { dx: 'x' } })).toEqual([0, 0, 200, 100])
  })
})
