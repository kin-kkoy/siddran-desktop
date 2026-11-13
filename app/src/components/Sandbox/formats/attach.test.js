import { describe, it, expect } from 'vitest'
import { attachedItems, attachTarget, attachPatches, clipRect, isClipped } from './attach'

const widget = (id, x, y, w, h, z, extra = {}) => ({ id, type: 'shape', x, y, w, h, rotation: 0, z_index: z, payload: { kind: 'format', ...extra } })
const card = (id, x, y, w, h, z, extra = {}) => ({ id, type: 'note', x, y, w, h, rotation: 0, z_index: z, payload: { noteId: 1, ...extra } })

describe('sticky attachment to a widget', () => {
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
    // Dragged on its own, the same card detaches.
    expect(attachPatches(['C'], [small, hanging])).toEqual([{ id: 'C', payload: { noteId: 1 } }])
  })

  it('only DOM things attach, only to a widget beneath them', () => {
    const shape = { id: 'S', type: 'shape', x: 100, y: 100, w: 50, h: 50, z_index: 5, payload: { kind: 'rect' } }
    expect(attachTarget(shape, [W, shape])).toBeNull()
    expect(attachTarget(card('U', 100, 100, 50, 50, 0), [W])).toBeNull()   // under the widget
    expect(attachTarget(card('L', 100, 100, 50, 50, 3, { locked: true }), [W])?.id).toBe('W')
    expect(attachPatches(['L'], [W, card('L', 100, 100, 50, 50, 3, { locked: true })])).toEqual([])
  })

  it('takes the topmost widget, never one riding on itself', () => {
    const inner = widget('I', 50, 50, 200, 150, 2, { attachedTo: 'W' })
    expect(attachTarget(card('C', 100, 100, 40, 40, 3), [W, inner])?.id).toBe('I')
    // W dropped onto I (which rides on W) would be a loop.
    expect(attachTarget({ ...W, z_index: 9 }, [{ ...W, z_index: 9 }, inner])).toBeNull()
  })

  it('collects what rides along, all the way down', () => {
    const inner = widget('I', 50, 50, 200, 150, 2, { attachedTo: 'W' })
    const c = card('C', 60, 60, 40, 40, 3, { attachedTo: 'I' })
    expect(attachedItems(W, [W, inner, c, card('X', 0, 0, 10, 10, 4)]).map(i => i.id)).toEqual(['I', 'C'])
  })

  it('clips to the widget (and its own widget), and says when something is cut off', () => {
    const small = widget('W', 0, 0, 120, 120, 1)
    const c = card('C', 100, 100, 100, 100, 2, { attachedTo: 'W' })
    const byId = new Map([small, c].map(i => [i.id, i]))
    expect(clipRect(c, byId)).toEqual({ x: 0, y: 0, w: 120, h: 120 })
    expect(isClipped(c, clipRect(c, byId))).toBe(true)
    expect(isClipped(card('D', 10, 10, 50, 50, 2), { x: 0, y: 0, w: 120, h: 120 })).toBe(false)
    const inner = widget('I', 60, 60, 200, 200, 2, { attachedTo: 'W' })
    const d = card('D', 70, 70, 10, 10, 3, { attachedTo: 'I' })
    expect(clipRect(d, new Map([small, inner, d].map(i => [i.id, i])))).toEqual({ x: 60, y: 60, w: 60, h: 60 })
    expect(clipRect(card('Z', 0, 0, 1, 1, 1, { attachedTo: 'gone' }), byId)).toBeNull()
  })
})
