import { describe, it, expect } from 'vitest'
import { scatter, withNewKeys, moveTo, raise, prunePlacements } from './missionBoard'

// A deterministic stand-in for Math.random, so "random" layouts can be asserted.
const seeded = (seed = 1) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}

describe('scatter', () => {
  const keys = ['task:a', 'task:b', 'task:c', 'daily:d']

  it('places every key inside the board', () => {
    const out = scatter(keys, seeded())
    expect(Object.keys(out).sort()).toEqual([...keys].sort())
    for (const p of Object.values(out)) {
      expect(p.x).toBeGreaterThanOrEqual(14)
      expect(p.x).toBeLessThanOrEqual(86)
      expect(p.y).toBeGreaterThanOrEqual(14)
      expect(p.y).toBeLessThanOrEqual(86)
      expect(Math.abs(p.tilt)).toBeLessThanOrEqual(7)
    }
  })

  it('gives every paper its own place in the stack', () => {
    const z = Object.values(scatter(keys, seeded())).map(p => p.z)
    expect(new Set(z).size).toBe(keys.length)
  })

  it('is deterministic for a given source of randomness', () => {
    expect(scatter(keys, seeded(7))).toEqual(scatter(keys, seeded(7)))
  })

  it('does not stack papers on the same spot', () => {
    const pts = Object.values(scatter(keys, seeded(3)))
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        expect(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)).toBeGreaterThan(1)
      }
    }
  })

  // A little overlap is the look; a buried title is a bug. Papers are boxes, so
  // this measures overlap per axis the way the scatter itself does.
  it('keeps a full board readable — no paper is mostly buried', () => {
    const overlap = (a, b) => Math.min(
      Math.max(0, 18 - Math.abs(a.x - b.x)) / 18,
      Math.max(0, 14 - Math.abs(a.y - b.y)) / 14,
    )
    for (let trial = 1; trial <= 40; trial++) {
      const many = Array.from({ length: 14 }, (_, i) => `task:${i}`)
      const pts = Object.values(scatter(many, seeded(trial)))
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          expect(overlap(pts[i], pts[j])).toBeLessThan(0.62)
        }
      }
    }
  })
})

describe('withNewKeys', () => {
  it('places newcomers without moving what is already pinned up', () => {
    const before = scatter(['task:a', 'task:b'], seeded())
    const after = withNewKeys(before, ['task:a', 'task:b', 'task:c'], seeded(9))
    expect(after['task:a']).toEqual(before['task:a'])
    expect(after['task:b']).toEqual(before['task:b'])
    expect(after['task:c']).toBeDefined()
  })

  it('puts a newcomer on top of the stack', () => {
    const before = scatter(['task:a', 'task:b'], seeded())
    const after = withNewKeys(before, ['task:a', 'task:b', 'task:c'], seeded(9))
    const top = Math.max(before['task:a'].z, before['task:b'].z)
    expect(after['task:c'].z).toBeGreaterThan(top)
  })

  it('is a no-op when nothing is new', () => {
    const before = scatter(['task:a'], seeded())
    expect(withNewKeys(before, ['task:a'])).toBe(before)
  })
})

describe('moveTo', () => {
  it('moves one paper and keeps its tilt and stacking', () => {
    const before = scatter(['task:a', 'task:b'], seeded())
    const after = moveTo(before, 'task:a', 40, 55)
    expect(after['task:a']).toMatchObject({ x: 40, y: 55, tilt: before['task:a'].tilt, z: before['task:a'].z })
    expect(after['task:b']).toEqual(before['task:b'])
  })

  it('clamps a paper dragged past the edge back onto the board', () => {
    const after = moveTo({}, 'task:a', 300, -80)
    expect(after['task:a'].x).toBe(86)
    expect(after['task:a'].y).toBe(14)
  })
})

describe('raise', () => {
  it('brings a paper to the front', () => {
    const before = scatter(['task:a', 'task:b', 'task:c'], seeded())
    const bottom = Object.entries(before).sort((a, b) => a[1].z - b[1].z)[0][0]
    const after = raise(before, bottom)
    expect(after[bottom].z).toBeGreaterThan(Math.max(...Object.values(before).map(p => p.z)))
  })

  it('leaves the arrangement alone when it is already on top', () => {
    const before = scatter(['task:a', 'task:b'], seeded())
    const top = Object.entries(before).sort((a, b) => b[1].z - a[1].z)[0][0]
    expect(raise(before, top)).toBe(before)
  })
})

describe('prunePlacements', () => {
  it('forgets papers whose task is gone', () => {
    const before = scatter(['task:a', 'task:b'], seeded())
    expect(Object.keys(prunePlacements(before, ['task:a']))).toEqual(['task:a'])
  })

  it('survives being handed nothing at all', () => {
    expect(prunePlacements(null, ['task:a'])).toEqual({})
  })
})
