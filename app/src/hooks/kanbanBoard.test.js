import { describe, it, expect, beforeEach } from 'vitest'
import {
  readPlacements, writePlacements, placementFor, setPlacement, prunePlacements,
  ROUTINES_COL, DAILY_KEY, bundleKey,
} from './kanbanBoard.js'

const A = '/bags/A'
beforeEach(() => {
  const store = new Map()
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
})

describe('placements', () => {
  it('round-trips and is Bag-scoped', () => {
    writePlacements({ [DAILY_KEY]: { col: 'high', order: 2 } }, A)
    expect(readPlacements(A)[DAILY_KEY]).toEqual({ col: 'high', order: 2 })
    expect(readPlacements('/bags/B')).toEqual({})
  })

  // An unplaced card must land somewhere, and last, so it can't displace an
  // arrangement you made deliberately.
  it('defaults to Routines, at the end', () => {
    const p = placementFor({}, bundleKey('x'))
    expect(p.col).toBe(ROUTINES_COL)
    expect(p.order).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('records a column and position without touching the others', () => {
    const p1 = setPlacement({}, DAILY_KEY, 'normal', 1)
    const p2 = setPlacement(p1, bundleKey('7'), 'low', 0)
    expect(p2[DAILY_KEY]).toEqual({ col: 'normal', order: 1 })
    expect(p2[bundleKey('7')]).toEqual({ col: 'low', order: 0 })
  })

  it('survives corrupt or half-formed entries', () => {
    localStorage.setItem('siddran_kanban_place:/bags/A', '{oops')
    expect(readPlacements(A)).toEqual({})
    writePlacements({ good: { col: 'high', order: 1 }, bad: { col: 5 }, worse: null }, A)
    expect(Object.keys(readPlacements(A))).toEqual(['good'])
  })

  it('defaults a missing order rather than dropping the entry', () => {
    writePlacements({ [DAILY_KEY]: { col: 'high' } }, A)
    expect(readPlacements(A)[DAILY_KEY]).toEqual({ col: 'high', order: 0 })
  })

  // A deleted bundle would otherwise keep its slot forever.
  it('prunes placements whose card is gone', () => {
    const p = { [DAILY_KEY]: { col: 'high', order: 0 }, [bundleKey('gone')]: { col: 'low', order: 1 } }
    expect(Object.keys(prunePlacements(p, [DAILY_KEY]))).toEqual([DAILY_KEY])
  })
})
