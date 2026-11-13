import { describe, it, expect } from 'vitest'
import { attachedItems, attachTarget, attachPatches, clipRect, isClipped, clipState, legacyRiders, stampPatches, boardClips, cutLabel } from './attach'

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

  it('a widget takes only DOM things above it', () => {
    expect(attachTarget(shape('S', 100, 100, 50, 50), [W])).toBeNull()
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

  it('a frame takes anything but connectors, and a frame only if it fits wholly inside', () => {
    expect(attachTarget(shape('S', 100, 100, 50, 50), [F])?.id).toBe('F')
    expect(attachTarget({ id: 'K', type: 'stroke', x: 10, y: 10, w: 5, h: 5, payload: {} }, [F])?.id).toBe('F')
    expect(attachTarget({ id: 'C', type: 'connector', x: 0, y: 0, w: 0, h: 0, payload: {} }, [F])).toBeNull()
    expect(attachTarget(frame('G', 50, 50, 100, 100), [F])?.id).toBe('F')
    expect(attachTarget(frame('G', 500, 50, 300, 100), [F])).toBeNull()   // only partly inside
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
