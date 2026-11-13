import { describe, it, expect } from 'vitest'
import { TEMPLATES } from './templates'
import { SHAPES } from '../shapes/registry'

const ids = () => { let i = 0; return () => `t${++i}` }

describe('starter templates', () => {
  it('ships at least ten', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(10)
    expect(new Set(TEMPLATES.map(t => t.id)).size).toBe(TEMPLATES.length)
  })

  it.each(TEMPLATES.map(t => [t.id, t]))('%s builds valid items', (_, t) => {
    const items = t.build({ newId: ids(), style: { stroke: '#e2ddf5' } })
    expect(items.length).toBeGreaterThan(0)
    const byId = new Map(items.map(i => [i.id, i]))
    expect(byId.size).toBe(items.length)                       // unique ids
    for (const it of items) {
      expect(['shape', 'text', 'connector']).toContain(it.type)
      for (const k of ['x', 'y', 'w', 'h']) expect(Number.isFinite(it[k])).toBe(true)
      if (it.type === 'shape') expect(SHAPES[it.payload.kind]).toBeTruthy()
      if (it.type === 'connector') {
        expect(byId.has(it.payload.from.itemId)).toBe(true)
        expect(byId.has(it.payload.to.itemId)).toBe(true)
      }
    }
  })

  it('places stickies inside their frames', () => {
    const items = TEMPLATES.find(t => t.id === 'kanban').build({ newId: ids() })
    const frames = items.filter(i => i.payload?.kind === 'frame')
    const stickies = items.filter(i => i.payload?.kind === 'sticky')
    for (const s of stickies) {
      const cx = s.x + s.w / 2, cy = s.y + s.h / 2
      expect(frames.some(f => cx > f.x && cx < f.x + f.w && cy > f.y && cy < f.y + f.h)).toBe(true)
    }
  })
})
