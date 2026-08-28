import { describe, it, expect } from 'vitest'
import {
  parseDiagram, serializeDiagram, diagramFence, diagramBounds, emptyDiagram, DIAGRAM_LANG,
} from './diagramBlock'

const shape = (id, over = {}) => ({
  id, type: 'shape', x: 0, y: 0, w: 100, h: 60, z_index: 0,
  payload: { kind: 'rect' }, ...over,
})

const connector = (id, fromId, toId) => ({
  id, type: 'connector', x: 0, y: 0, w: 1, h: 1, z_index: 1,
  payload: { from: { itemId: fromId, side: 'e' }, to: { itemId: toId, side: 'w' } },
})

const body = (items) => JSON.stringify({ v: 1, items })

describe('parseDiagram', () => {
  it('reads a well-formed block', () => {
    const doc = parseDiagram(body([shape('a'), shape('b', { x: 200 })]))
    expect(doc.items).toHaveLength(2)
    expect(doc.items[0].payload.kind).toBe('rect')
  })

  it('treats an empty block as a new blank diagram', () => {
    expect(parseDiagram('')).toEqual({ v: 1, items: [] })
    expect(parseDiagram('   \n ')).toEqual({ v: 1, items: [] })
  })

  it('returns null for anything it cannot use, rather than throwing', () => {
    expect(parseDiagram('{not json')).toBeNull()
    expect(parseDiagram('[1,2,3]')).toBeNull()          // no items array
    expect(parseDiagram('{"v":1}')).toBeNull()
    expect(parseDiagram('null')).toBeNull()
  })

  it('drops item types that are not part of the flowchart subset', () => {
    const doc = parseDiagram(body([
      shape('a'),
      { id: 's', type: 'stroke', x: 0, y: 0, w: 1, h: 1, payload: { flatOutline: [] } },
      { id: 'i', type: 'image', x: 0, y: 0, w: 1, h: 1, payload: {} },
    ]))
    expect(doc.items.map(i => i.id)).toEqual(['a'])
  })

  it('drops connectors that point at shapes not in the block', () => {
    const doc = parseDiagram(body([shape('a'), connector('c', 'a', 'missing')]))
    expect(doc.items.map(i => i.id)).toEqual(['a'])
  })

  it('keeps connectors whose endpoints both resolve', () => {
    const doc = parseDiagram(body([shape('a'), shape('b'), connector('c', 'a', 'b')]))
    expect(doc.items.map(i => i.id)).toEqual(['a', 'b', 'c'])
  })

  it('drops a connector missing an endpoint entirely', () => {
    const doc = parseDiagram(body([
      shape('a'),
      { id: 'c', type: 'connector', x: 0, y: 0, w: 1, h: 1, payload: { from: { itemId: 'a', side: 'e' } } },
    ]))
    expect(doc.items.map(i => i.id)).toEqual(['a'])
  })

  it('fills defaults for a sparse item', () => {
    const doc = parseDiagram(body([{ id: 'a', type: 'shape' }]))
    const it = doc.items[0]
    expect(it.w).toBeGreaterThan(0)
    expect(it.h).toBeGreaterThan(0)
    expect(it.payload.kind).toBe('rect')
    expect(it.payload.text).toBe('')
  })

  it('gives an unidentified item a deterministic id', () => {
    const a = parseDiagram(body([{ type: 'shape' }, { type: 'shape' }]))
    const b = parseDiagram(body([{ type: 'shape' }, { type: 'shape' }]))
    // Same file must parse to the same links on every machine.
    expect(a.items.map(i => i.id)).toEqual(b.items.map(i => i.id))
    expect(new Set(a.items.map(i => i.id)).size).toBe(2)
  })

  it('rejects nonsense numbers instead of propagating NaN', () => {
    const doc = parseDiagram(body([shape('a', { x: 'left', w: null, h: undefined })]))
    expect(Number.isFinite(doc.items[0].x)).toBe(true)
    expect(doc.items[0].w).toBeGreaterThan(0)
  })

  it('coerces a non-string text payload', () => {
    const doc = parseDiagram(body([shape('a', { payload: { kind: 'rect', text: 42 } })]))
    expect(doc.items[0].payload.text).toBe('42')
  })
})

describe('serializeDiagram', () => {
  it('round-trips', () => {
    const original = parseDiagram(body([shape('a'), shape('b', { x: 200 }), connector('c', 'a', 'b')]))
    const again = parseDiagram(serializeDiagram(original))
    expect(again.items).toEqual(original.items)
  })

  it('is byte-stable for an unchanged diagram', () => {
    // Otherwise merely opening a note would dirty it and the autosave would
    // rewrite the file for nothing.
    const doc = parseDiagram(body([shape('a'), connector('c', 'a', 'a')]))
    expect(serializeDiagram(doc)).toBe(serializeDiagram(doc))
    expect(serializeDiagram(parseDiagram(serializeDiagram(doc)))).toBe(serializeDiagram(doc))
  })

  it('rounds sub-pixel noise away', () => {
    const doc = parseDiagram(body([shape('a', { x: 10.123456789 })]))
    expect(serializeDiagram(doc)).toContain('"x":10.12')
  })
})

describe('diagramFence', () => {
  it('wraps the body in a fence the markdown parser will see', () => {
    const fence = diagramFence(emptyDiagram())
    expect(fence.startsWith('```' + DIAGRAM_LANG + '\n')).toBe(true)
    expect(fence.endsWith('\n```')).toBe(true)
  })
})

describe('diagramBounds', () => {
  it('covers every shape', () => {
    const doc = parseDiagram(body([shape('a'), shape('b', { x: 200, y: 50 })]))
    expect(diagramBounds(doc.items)).toEqual({ x: 0, y: 0, w: 300, h: 110 })
  })

  it('is null when there is nothing to draw', () => {
    expect(diagramBounds([])).toBeNull()
  })
})
