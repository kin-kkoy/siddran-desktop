import { describe, it, expect } from 'vitest'
import { attachedItems, attachTarget, attachPatches, clipRect, isClipped, clipState, legacyRiders, stampPatches, boardClips, cutLabel, widgetBorne } from './attach'

const widget = (id, x, y, w, h, z, extra = {}) => ({ id, type: 'shape', x, y, w, h, rotation: 0, z_index: z, payload: { kind: 'format', ...extra } })
const frame = (id, x, y, w, h, extra = {}) => ({ id, type: 'shape', x, y, w, h, rotation: 0, z_index: -5, payload: { kind: 'frame', title: id, ...extra } })
const card = (id, x, y, w, h, z, extra = {}) => ({ id, type: 'note', x, y, w, h, rotation: 0, z_index: z, payload: { noteId: 1, ...extra } })
const shape = (id, x, y, w, h, extra = {}) => ({ id, type: 'shape', x, y, w, h, rotation: 0, z_index: 3, payload: { kind: 'rect', ...extra } })
const CLIP = { overflow: 'clip' }

describe('sticky attachment — widgets', () => {
  const W = widget('W', 0, 0, 400, 300, 1)

  it('a card dropped on a widget attaches; dragged off, it detaches', () => {
    const on = card('C', 100, 100, 100, 100, 2)
    expect(attachPatches(['C'], [W, on])).toEqual([{ id: 'C', payload: { noteId: 1, attachedTo: 'W' } }])
    const off = card('C', 600, 100, 100, 100, 2, { attachedTo: 'W' })
    expect(attachPatches(['C'], [W, off])).toEqual([{ id: 'C', payload: { noteId: 1 } }])
    expect(attachPatches(['C'], [W, { ...on, payload: { ...on.payload, attachedTo: 'W' } }])).toEqual([])
  })

  it('a card hanging off a small widget stays attached when the widget is moved', () => {
    const small = widget('W', 0, 0, 120, 120, 1)
    const hanging = card('C', 100, 100, 100, 100, 2, { attachedTo: 'W' })   // centre outside the widget
    expect(attachPatches(['W', 'C'], [small, hanging])).toEqual([])
    expect(attachPatches(['C'], [small, hanging])).toEqual([{ id: 'C', payload: { noteId: 1 } }])
  })

  it('a widget takes anything above it but frames — never what is underneath', () => {
    expect(attachTarget(shape('S', 100, 100, 50, 50), [W])?.id).toBe('W')
    expect(attachTarget({ id: 'K', type: 'stroke', x: 100, y: 100, w: 5, h: 5, z_index: 9, payload: {} }, [W])?.id).toBe('W')
    expect(attachTarget(shape('S', 100, 100, 50, 50, {}), [{ ...W, z_index: 7 }])).toBeNull()   // the shape is beneath it
    expect(attachTarget({ ...frame('G', 50, 50, 100, 100), z_index: 9 }, [W])).toBeNull()
    expect(attachTarget(card('U', 100, 100, 50, 50, 0), [W])).toBeNull()   // under the widget
    expect(attachPatches(['L'], [W, card('L', 100, 100, 50, 50, 3, { locked: true })])).toEqual([])
  })

  it('takes the topmost widget, never one riding on itself', () => {
    const inner = widget('I', 50, 50, 200, 150, 2, { attachedTo: 'W' })
    expect(attachTarget(card('C', 100, 100, 40, 40, 3), [W, inner])?.id).toBe('I')
    expect(attachTarget({ ...W, z_index: 9 }, [{ ...W, z_index: 9 }, inner])).toBeNull()
  })

  it('collects what rides along, all the way down', () => {
    const inner = widget('I', 50, 50, 200, 150, 2, { attachedTo: 'W' })
    const c = card('C', 60, 60, 40, 40, 3, { attachedTo: 'I' })
    expect(attachedItems(W, [W, inner, c, card('X', 0, 0, 10, 10, 4)]).map(i => i.id)).toEqual(['I', 'C'])
  })
})

describe('sticky attachment — frames', () => {
  const F = frame('F', 0, 0, 600, 400)

  it('a frame takes anything but connectors, and a smaller frame whose centre is inside', () => {
    expect(attachTarget(shape('S', 100, 100, 50, 50), [F])?.id).toBe('F')
    expect(attachTarget({ id: 'K', type: 'stroke', x: 10, y: 10, w: 5, h: 5, payload: {} }, [F])?.id).toBe('F')
    expect(attachTarget({ id: 'C', type: 'connector', x: 0, y: 0, w: 0, h: 0, payload: {} }, [F])).toBeNull()
    expect(attachTarget(frame('G', 50, 50, 100, 100), [F])?.id).toBe('F')
    expect(attachTarget(frame('G', 400, 50, 300, 100), [F])?.id).toBe('F')   // pokes out, centre inside (550)
    expect(attachTarget(frame('G', 500, 50, 300, 100), [F])).toBeNull()      // centre outside (650)
    expect(attachTarget(frame('B', -100, -100, 900, 700), [F, frame('B', -100, -100, 900, 700)])).toBeNull()   // bigger never goes in a smaller one
  })

  it('the smallest frame wins, and a widget on top wins over the frame beneath', () => {
    const G = frame('G', 50, 50, 200, 200)
    expect(attachTarget(shape('S', 100, 100, 20, 20), [F, G])?.id).toBe('G')
    const W = widget('W', 60, 60, 150, 150, 1)
    expect(attachTarget(card('C', 100, 100, 20, 20, 2), [F, G, W])?.id).toBe('W')
    expect(attachTarget(W, [F, G, W])?.id).toBe('G')
  })

  it('things in a frame by position only ride with it, and are stamped as attached on its first move', () => {
    const s = shape('S', 100, 100, 50, 50)
    const out = shape('O', 900, 100, 50, 50)
    const stuck = shape('T', 100, 100, 50, 50, { attachedTo: 'elsewhere' })
    expect(legacyRiders(F, [F, s, out, stuck]).map(i => i.id)).toEqual(['S'])
    expect(stampPatches([F, s, out, stuck])).toEqual([{ id: 'S', payload: { kind: 'rect', attachedTo: 'F' } }])
    expect(stampPatches([s, out])).toEqual([])
  })
})

describe('drawn above the widgets', () => {
  it('board graphics riding on a widget, directly or through a card or a smaller widget', () => {
    const W = widget('W', 0, 0, 400, 300, 1)
    const I = widget('I', 10, 10, 100, 100, 2, { attachedTo: 'W' })
    const F = frame('F', 500, 0, 300, 300)
    const items = [W, I, F,
      shape('A', 20, 20, 10, 10, { attachedTo: 'W' }),
      shape('B', 20, 20, 10, 10, { attachedTo: 'I' }),
      shape('C', 520, 20, 10, 10, { attachedTo: 'F' }),
      card('D', 20, 20, 10, 10, 4, { attachedTo: 'W' }),
      shape('E', 900, 900, 10, 10)]
    expect([...widgetBorne(items)].sort()).toEqual(['A', 'B'])
  })
})

describe('crop or hang', () => {
  it('hangs by default; crops only when the container says clip', () => {
    const W = widget('W', 0, 0, 120, 120, 1)
    const c = card('C', 100, 100, 100, 100, 2, { attachedTo: 'W' })
    expect(clipRect(c, new Map([W, c].map(i => [i.id, i])))).toBeNull()
    const Wc = widget('W', 0, 0, 120, 120, 1, CLIP)
    expect(clipRect(c, new Map([Wc, c].map(i => [i.id, i])))).toEqual({ x: 0, y: 0, w: 120, h: 120 })
    const F = frame('F', 0, 0, 120, 120, CLIP)
    const s = shape('S', 100, 100, 100, 100, { attachedTo: 'F' })
    expect(clipRect(s, new Map([F, s].map(i => [i.id, i])))).toEqual({ x: 0, y: 0, w: 120, h: 120 })
  })

  it('crops through the chain: a hanging container inside a cropping one still gets the outer crop', () => {
    const F = frame('F', 0, 0, 120, 120, CLIP)
    const W = widget('W', 60, 60, 200, 200, 2, { attachedTo: 'F' })   // hangs (default)
    const d = card('D', 70, 70, 10, 10, 3, { attachedTo: 'W' })
    expect(clipRect(d, new Map([F, W, d].map(i => [i.id, i])))).toEqual({ x: 0, y: 0, w: 120, h: 120 })
    const Wc = { ...W, payload: { ...W.payload, overflow: 'clip' } }
    expect(clipRect(d, new Map([F, Wc, d].map(i => [i.id, i])))).toEqual({ x: 60, y: 60, w: 60, h: 60 })
    expect(clipRect(card('Z', 0, 0, 1, 1, 1, { attachedTo: 'gone' }), new Map())).toBeNull()
  })

  it('says whether something is cropped or out of view, and counts per container', () => {
    const r = { x: 0, y: 0, w: 120, h: 120 }
    expect(isClipped(card('D', 10, 10, 50, 50, 2), r)).toBe(false)
    expect(clipState(card('C', 100, 100, 100, 100, 2), r)).toBe('cropped')
    expect(clipState(card('E', 300, 300, 50, 50, 2), r)).toBe('hidden')
    const F = frame('F', 0, 0, 120, 120, CLIP)
    const items = [F, shape('A', 100, 100, 100, 100, { attachedTo: 'F' }), shape('B', 300, 300, 10, 10, { attachedTo: 'F' }), shape('C', 10, 10, 10, 10, { attachedTo: 'F' })]
    const { clips, cut } = boardClips(items)
    expect(clips.size).toBe(3)
    expect(cut.get('F')).toEqual({ cropped: 1, hidden: 1 })
    expect(cutLabel(cut.get('F'))).toBe('1 cropped · 1 out of view')
    expect(cutLabel(undefined)).toBe('')
  })
})

import { snapEdge, snapLines } from './snapping'
describe('resize snapping', () => {
  it('snaps a dragged edge to the nearest edge or centre, else the grid, within the threshold', () => {
    const { xs } = snapLines([{ id: 'F', type: 'shape', x: 100, y: 0, w: 200, h: 100, rotation: 0, payload: { kind: 'frame' } }])
    expect(xs).toEqual([100, 200, 300])
    expect(snapEdge(296, xs, 24, 6)).toBe(300)   // a frame's inner edge
    expect(snapEdge(203, xs, 24, 6)).toBe(200)   // its centre
    expect(snapEdge(239, xs, 24, 6)).toBe(240)   // nothing near: the grid
    expect(snapEdge(250, xs, 0, 6)).toBeNull()
  })
})

import { computeSnap, computeSnapTo, snapTargets, inView } from './snapping'
describe('move snapping against prebuilt targets', () => {
  // The old scan, kept here as the reference.
  const brute = (m, items, grid, thr) => {
    const xs = [], ys = []
    for (const it of items) { xs.push(it.x, it.x + it.w / 2, it.x + it.w); ys.push(it.y, it.y + it.h / 2, it.y + it.h) }
    // Real lines first; the grid only when none is within reach.
    const best = (ml, ts) => {
      let d = 0, bd = thr + 1
      for (const v of ml) for (const t of ts) if (Math.abs(t - v) < bd) { bd = Math.abs(t - v); d = t - v }
      if (bd <= thr) return d
      for (const v of ml) {
        const g = Math.round(v / grid) * grid
        if (Math.abs(g - v) < bd) { bd = Math.abs(g - v); d = g - v }
      }
      return bd <= thr ? d : 0
    }
    return { dx: best([m.x, m.x + m.w / 2, m.x + m.w], xs), dy: best([m.y, m.y + m.h / 2, m.y + m.h], ys) }
  }
  it('gives the same nudge as scanning every item', () => {
    let seed = 7
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    const items = Array.from({ length: 300 }, (_, i) => ({ id: `i${i}`, type: 'shape', x: rnd() * 4000, y: rnd() * 3000, w: 20 + rnd() * 300, h: 20 + rnd() * 200, rotation: 0, payload: { kind: 'rect' } }))
    const targets = snapTargets(items)
    for (let k = 0; k < 200; k++) {
      const m = { x: rnd() * 4000, y: rnd() * 3000, w: 50 + rnd() * 200, h: 40 + rnd() * 100 }
      const a = computeSnapTo(m, targets, 24, 10), b = brute(m, items, 24, 10)
      // itemAABB goes through rotation maths: equal to ~1e-12, not bit for bit.
      expect(a.dx).toBeCloseTo(b.dx, 9)
      expect(a.dy).toBeCloseTo(b.dy, 9)
      expect(computeSnap(m, items, 24, 10).dx).toBe(a.dx)
    }
  })
  it('looks only at what is in view', () => {
    const a = { id: 'a', type: 'shape', x: 0, y: 0, w: 10, h: 10, rotation: 0, payload: {} }
    const b = { ...a, id: 'b', x: 5000 }
    expect(inView([a, b], { x: -100, y: -100, w: 1000, h: 1000 }).map(i => i.id)).toEqual(['a'])
  })
})
