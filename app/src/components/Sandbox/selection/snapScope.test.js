import { describe, it, expect } from 'vitest'
import { snapScope, frameAt, frameMembers } from './snapScope'
import { computeSnapTo, snapEdge, snapEdgeHit } from './snapping'

const frame = (id, x, y, w, h, extra = {}) => ({ id, type: 'shape', x, y, w, h, rotation: 0, z_index: -5, payload: { kind: 'frame', title: id, ...extra } })
const shape = (id, x, y, w, h, extra = {}) => ({ id, type: 'shape', x, y, w, h, rotation: 0, z_index: 3, payload: { kind: 'rect', ...extra } })
const has = (arr, v) => Array.from(arr).some(x => Math.abs(x - v) < 1e-9)

describe('frame-scoped snapping', () => {
  // Two frames, one above the other; F has a box on it, G (above) has another.
  const F = frame('F', 0, 500, 400, 300)
  const G = frame('G', 0, 0, 400, 250)
  const onF = shape('a', 50, 550, 100, 40, { attachedTo: 'F' })
  const onG = shape('b', 213, 50, 100, 40, { attachedTo: 'G' })
  const loose = shape('c', 900, 600, 50, 50)
  const items = [F, G, onF, onG, loose]

  it('over a frame: its own edges and centre lines and its own things only', () => {
    const s = snapScope({ x: 200, y: 650 }, items, new Set(['m']), new Map())
    expect(s.frame.id).toBe('F')
    expect(has(s.targets.xs, 0) && has(s.targets.xs, 200) && has(s.targets.xs, 400)).toBe(true)   // frame edges + centre
    expect(has(s.targets.xs, 50) && has(s.targets.xs, 150)).toBe(true)                           // the box on it
    expect(has(s.targets.xs, 213)).toBe(false)                                                    // the frame above: no
    expect(has(s.targets.xs, 900)).toBe(false)                                                    // loose things: no
    expect(s.origin).toEqual({ x: 0, y: 500 })
  })

  it('not over a frame, or the frame opts out: no scope (snap to everything)', () => {
    expect(snapScope({ x: 900, y: 600 }, items, new Set(), new Map())).toBe(null)
    const out = frame('F', 0, 500, 400, 300, { snapOutside: true })
    expect(snapScope({ x: 200, y: 650 }, [out, G, onF, onG], new Set(), new Map())).toBe(null)
  })

  it('what moves is never a target', () => {
    const s = snapScope({ x: 200, y: 650 }, items, new Set(['a']), new Map())
    expect(has(s.targets.xs, 50)).toBe(false)
  })

  it('nested frames: the smallest holding the centre; a nested frame counts, its contents do not', () => {
    const inner = frame('I', 20, 520, 100, 100, { attachedTo: 'F' })
    const onInner = shape('d', 33, 530, 20, 20, { attachedTo: 'I' })
    const all = [F, inner, onInner]
    expect(frameAt({ x: 50, y: 550 }, [F, inner])?.id).toBe('I')
    const ids = frameMembers(F, all, [F, inner]).map(i => i.id)
    expect(ids).toEqual(['I'])
  })

  it('older boards: things in a frame by position only count as on it', () => {
    const unattached = shape('e', 70, 600, 10, 10)
    expect(frameMembers(F, [F, G, unattached], [F, G]).map(i => i.id)).toEqual(['e'])
  })

  it('slides: same-size frames lend their positions, moved into this frame', () => {
    const S1 = frame('S1', 0, 0, 400, 300)
    const S2 = frame('S2', 500, 0, 400, 300)
    const title = shape('t', 537, 20, 100, 30, { attachedTo: 'S2' })    // x 37 within its slide
    const small = frame('X', 0, 400, 200, 150)
    const onSmall = shape('u', 11, 410, 10, 10, { attachedTo: 'X' })
    const s = snapScope({ x: 200, y: 150 }, [S1, S2, title, small, onSmall], new Set(), new Map())
    expect(s.frame.id).toBe('S1')
    expect(has(s.targets.xs, 37)).toBe(true)     // mapped from S2
    expect(has(s.targets.xs, 537)).toBe(false)   // not where it really is
    expect(has(s.targets.xs, 11)).toBe(false)    // a frame of another size lends nothing
  })

  it('the grid counts from the frame corner', () => {
    // Frame at x=10: grid lines at 10, 34, 58… — a box edge at 33 snaps to 34, not to 24.
    const snap = computeSnapTo({ x: 33, y: 0, w: 1000, h: 1000 }, { xs: new Float64Array(), ys: new Float64Array() }, 24, 5, { x: 10, y: 0 })
    expect(snap.dx).toBeCloseTo(1)
    expect(snapEdge(33, new Float64Array(), 24, 5, 10)).toBe(34)
    expect(snapEdge(23, new Float64Array(), 24, 5)).toBe(24)   // the board's grid, unchanged
  })

  it('real things beat the grid, and a grid snap draws no guide', () => {
    // A frame centre at 1206; the grid line at 1200 is nearer (dragged edge at 1201) — the centre still wins.
    const targets = { xs: Float64Array.from([0, 1206, 2412]), ys: new Float64Array() }
    const a = computeSnapTo({ x: 1201, y: 5000, w: 0, h: 0 }, targets, 24, 26)
    expect(a.dx).toBeCloseTo(5)
    expect(a.guides).toEqual([{ type: 'v', pos: 1206 }])
    // Nothing real within reach: the grid pulls, silently.
    const b = computeSnapTo({ x: 1581, y: 5000, w: 0, h: 0 }, targets, 24, 26)
    expect(b.dx).toBeCloseTo(3)
    expect(b.guides).toEqual([])
    expect(snapEdgeHit(1201, targets.xs, 24, 26)).toEqual({ pos: 1206, grid: false })
    expect(snapEdgeHit(1581, targets.xs, 24, 26)).toEqual({ pos: 1584, grid: true })
  })
})
