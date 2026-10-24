// Mirrors Siddran-CLI crates/core/src/diagram.rs tests, case for case — the two
// implementations must agree (see the header of flowText.js).
import { describe, it, expect } from 'vitest'
import { parseFlow, flowToItems, tidy, itemsToFlow, nodeSize } from './flowText'

const ids = () => { let i = 0; return () => `id${++i}` }

describe('parseFlow', () => {
  it('parses shapes, labels and chains', () => {
    const { graph: g, problems } = parseFlow('flowchart LR\nA[Start] --> B{OK?} -->|yes| C((Done))\nB -- no --> A')
    expect(problems).toEqual([])
    expect(g.dir).toBe('right')
    expect(g.nodes.map((n) => [n.key, n.kind, n.label])).toEqual([['A', 'rect', 'Start'], ['B', 'rhombus', 'OK?'], ['C', 'ellipse', 'Done']])
    expect(g.edges).toHaveLength(3)
    expect(g.edges[1].label).toBe('yes')
    expect(g.edges[2]).toMatchObject({ from: 'B', to: 'A', label: 'no' })
  })

  it('parses fan-out and the less common shapes', () => {
    const { graph: g } = parseFlow('A([Begin]) --> B[(DB)] & C[/In/] & D{{Prep}}\nE --- F')
    expect(g.edges).toHaveLength(4)
    expect(g.nodes.map((n) => n.kind)).toEqual(['roundedRect', 'cylinder', 'parallelogram', 'hexagon', 'rect', 'rect'])
    expect(g.edges[3].head).toBe(false)
  })

  it('reports a bad line instead of failing the whole diagram', () => {
    const { graph: g, problems } = parseFlow('A --> B\nthis is ??? not a diagram -->\nB --> C')
    expect(g.nodes).toHaveLength(3)
    expect(problems).toHaveLength(1)
  })

  it('throws when there is nothing to draw', () => {
    expect(() => parseFlow('%% just a comment')).toThrow(/no nodes/)
  })
})

describe('flowToItems', () => {
  it('puts each step below the last and attaches the connectors', () => {
    const { shapes, connectors } = flowToItems(parseFlow('A[One] --> B[Two] --> C[Three]').graph, { origin: { x: 100, y: 200 }, newId: ids() })
    expect(shapes[0].y).toBeLessThan(shapes[1].y)
    expect(shapes[1].y).toBeLessThan(shapes[2].y)
    expect(Math.min(shapes[0].x, shapes[1].x)).toBe(100)
    expect(shapes[0].y).toBe(200)
    expect(connectors[0].payload.from).toEqual({ itemId: shapes[0].id, side: 's' })
    expect(connectors[0].payload.to).toEqual({ itemId: shapes[1].id, side: 'n' })
  })

  it('sets branches side by side without overlapping', () => {
    const { shapes } = flowToItems(parseFlow('A{Choice} -->|left| B[Left path]\nA -->|right| C[Right path]').graph, { newId: ids() })
    expect(shapes[1].y).toBe(shapes[2].y)
    expect(shapes[1].x + shapes[1].w).toBeLessThanOrEqual(shapes[2].x)
  })

  it('lays out a loop', () => {
    expect(flowToItems(parseFlow('A --> B --> C --> A').graph, { newId: ids() }).connectors).toHaveLength(3)
  })

  it('uses whole-number coordinates', () => {
    const { shapes } = flowToItems(parseFlow('A[A label of some length] --> B{Is it long enough to wrap onto two lines?}').graph, { newId: ids() })
    for (const s of shapes) for (const k of ['x', 'y', 'w', 'h']) expect(Number.isInteger(s[k])).toBe(true)
  })

  it('carries edge labels and dashes onto the connectors', () => {
    const { connectors } = flowToItems(parseFlow('A -->|yes| B\nA -.-> C').graph, { newId: ids() })
    expect(connectors[0].payload.label).toBe('yes')
    expect(connectors[1].payload.dash).toBe(true)
  })
})

describe('itemsToFlow', () => {
  it('round-trips structure', () => {
    const { shapes, connectors } = flowToItems(parseFlow('A[Start] --> B{OK?}\nB -->|yes| C[End]').graph, { newId: ids() })
    const text = itemsToFlow([...shapes, ...connectors])
    const { graph, problems } = parseFlow(text)
    expect(problems).toEqual([])
    expect(graph.nodes).toHaveLength(3)
    expect(graph.edges).toHaveLength(2)
    expect(text).toContain('|yes|')
  })
})

describe('tidy', () => {
  it('stacks a messy chain top-down, keeping the group where it was', () => {
    const shapes = [
      { id: 'a', x: 500, y: 300, w: 120, h: 56 },
      { id: 'b', x: 100, y: 100, w: 120, h: 56 },
      { id: 'c', x: 300, y: 600, w: 120, h: 56 },
    ]
    const conns = [
      { id: 'k1', payload: { from: { itemId: 'a', side: 'w' }, to: { itemId: 'b', side: 'e' } } },
      { id: 'k2', payload: { from: { itemId: 'b', side: 'n' }, to: { itemId: 'c', side: 'n' } } },
    ]
    const { moves, resides } = tidy(shapes, conns)
    const at = Object.fromEntries(moves.map((m) => [m.id, m]))
    expect(at.a.y).toBeLessThan(at.b.y)
    expect(at.b.y).toBeLessThan(at.c.y)
    expect(Math.min(...moves.map((m) => m.x))).toBe(100)
    expect(Math.min(...moves.map((m) => m.y))).toBe(100)
    expect(resides).toEqual([{ id: 'k1', from: 's', to: 'n' }, { id: 'k2', from: 's', to: 'n' }])
  })
})

describe('parity with Siddran-CLI', () => {
  // Measured from the Rust diagram::node_size (its `parity` test pins the same numbers).
  it('sizes boxes the same way', () => {
    expect(nodeSize('Start', 'rect')).toMatchObject({ w: 120, h: 56 })
    expect(nodeSize('Is it long enough to wrap onto two lines?', 'rhombus')).toMatchObject({ w: 312, h: 114 })
  })
})
