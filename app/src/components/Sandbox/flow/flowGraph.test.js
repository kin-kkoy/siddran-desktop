import { describe, it, expect } from 'vitest'
import { parseFlow, flowToItems, itemsToFlow } from './flowText'
import {
  emptyGraph, addNode, addNext, connect, removeNode, updateEdge, reverseEdge,
  graphToText, textToGraph, itemsToGraph, planDiagram, layoutFor, kindOf, NODE_KINDS,
} from './flowGraph'
import { shapeOutline } from './svgPath'

const ids = () => { let i = 0; return () => `id${++i}` }
const strip = (g) => ({ dir: g.dir, nodes: g.nodes.map(({ key, label, kind, round }) => ({ key, label, kind, round })), edges: g.edges.map(({ from, to, label, head, dashed }) => ({ from, to, label, head, dashed })) })

describe('editing', () => {
  it('adds, links and removes nodes', () => {
    let g = emptyGraph()
    let r = addNode(g, { label: 'Start', kind: 'roundedRect', round: 'pill' }); g = r.graph
    const a = r.key
    r = addNext(g, a, { label: 'Next' }); g = r.graph
    expect(g.nodes.map((n) => n.key)).toEqual(['n1', 'n2'])
    expect(g.nodes[1]).toMatchObject({ kind: 'roundedRect', round: 'pill' })
    expect(g.edges).toEqual([{ from: 'n1', to: 'n2', label: null, head: true, dashed: false }])
    expect(connect(g, 'n1', 'n2')).toBe(g)   // no duplicate
    expect(connect(g, 'n1', 'n1')).toBe(g)   // no self-link
    g = removeNode(g, 'n1')
    expect(g.nodes.map((n) => n.key)).toEqual(['n2'])
    expect(g.edges).toEqual([])
    expect(addNode(g).key).toBe('n3')        // never reuses a live key
  })

  it('makes a decision\'s next node a plain step', () => {
    let g = addNode(emptyGraph(), { kind: 'rhombus', round: 'none' }).graph
    g = addNext(g, 'n1').graph
    expect(g.nodes[1]).toMatchObject({ kind: 'rect', round: 'some' })
  })

  it('reverses an edge unless the reverse exists', () => {
    let g = { dir: 'down', nodes: [{ key: 'a' }, { key: 'b' }], edges: [{ from: 'a', to: 'b' }] }
    g = reverseEdge(g, 0)
    expect(g.edges[0]).toMatchObject({ from: 'b', to: 'a' })
    g = { ...g, edges: [...g.edges, { from: 'a', to: 'b' }] }
    expect(reverseEdge(g, 0)).toBe(g)
  })

  it('names every picker kind', () => {
    for (const k of NODE_KINDS) expect(kindOf({ kind: k.kind, round: k.round }).id).toBe(k.id)
    expect(kindOf({ kind: 'cloud' })).toBeNull()
  })
})

describe('graphToText', () => {
  it('round-trips through parseFlow, every kind and edge style', () => {
    let g = emptyGraph('right')
    for (const k of NODE_KINDS) g = addNode(g, { label: k.label, kind: k.kind, round: k.round }).graph
    g = { ...g, nodes: [...g.nodes, { key: 'flag', label: 'Flag', kind: 'rect', round: 'none' }] }
    g = connect(g, 'n1', 'n2'); g = connect(g, 'n2', 'n3', { label: 'yes' })
    g = connect(g, 'n3', 'n4', { head: false }); g = connect(g, 'n4', 'n5', { dashed: true })
    g = connect(g, 'n5', 'n6', { dashed: true, head: false, label: 'maybe' })
    const back = parseFlow(graphToText(g)).graph
    expect(strip(back)).toEqual(strip(g))
  })

  it('keeps labels with brackets and pipes in one piece', () => {
    let g = addNode(emptyGraph(), { label: 'a ] b ) c', kind: 'rect', round: 'some' }).graph
    g = addNode(g, { label: 'x' }).graph
    g = connect(g, 'n1', 'n2', { label: 'p|q' })
    const { graph, problems } = parseFlow(graphToText(g))
    expect(problems).toEqual([])
    expect(graph.nodes).toHaveLength(2)
    expect(graph.nodes[0].label).toBe('a ⟧ b ) c')   // only this box's own closer needs swapping
    expect(graph.edges[0].label).toBe('p¦q')
  })

  it('writes an empty label as … and reads it back empty', () => {
    const g = addNode(emptyGraph(), { label: '' }).graph
    expect(graphToText(g)).toContain('n1[…]')
    expect(textToGraph(graphToText(g)).graph.nodes[0].label).toBe('')
  })
})

describe('textToGraph', () => {
  it('keeps board links for keys and ends the text still has', () => {
    const prev = {
      dir: 'down',
      nodes: [{ key: 'n1', label: 'A', kind: 'rect', round: 'some', itemId: 's1' }, { key: 'n2', label: 'B', kind: 'cloud', round: 'none', itemId: 's2' }],
      edges: [{ from: 'n1', to: 'n2', label: null, head: true, dashed: false, itemId: 'c1' }],
    }
    const { graph } = textToGraph('flowchart TD\n  n1[A renamed] --> n2[B]\n  n2 --> n3[New]\n', prev)
    expect(graph.nodes.map((n) => n.itemId)).toEqual(['s1', 's2', undefined])
    expect(graph.nodes[1].kind).toBe('cloud')        // a plain box in the text = unchanged board shape
    expect(graph.edges.map((e) => e.itemId)).toEqual(['c1', undefined])
  })
})

describe('itemsToGraph', () => {
  const board = () => {
    const g = parseFlow('flowchart LR\nA([Start]) --> B{Ok?}\nB -->|yes| C[(Store)]\nB -.-> D[/Ask/]').graph
    return flowToItems(g, { origin: { x: 50, y: 60 }, newId: ids() })
  }

  it('reads a laid-out diagram back as the graph it came from', () => {
    const { shapes, connectors } = board()
    const { graph, origin } = itemsToGraph([...shapes, ...connectors])
    expect(origin).toEqual({ x: 50, y: 60 })
    expect(graph.dir).toBe('right')
    expect(graph.nodes.map((n) => [n.label, kindOf(n)?.id])).toEqual(expect.arrayContaining([['Start', 'terminal'], ['Ok?', 'decision'], ['Store', 'database'], ['Ask', 'data']]))
    const label = (k) => graph.nodes.find((n) => n.key === k).label
    expect(graph.edges.map((e) => [label(e.from), label(e.to), e.label, e.dashed])).toEqual([
      ['Start', 'Ok?', null, false], ['Ok?', 'Store', 'yes', false], ['Ok?', 'Ask', null, true],
    ])
    expect(graph.nodes.every((n) => n.itemId)).toBe(true)
    expect(graph.edges.every((e) => e.itemId)).toBe(true)
  })

  it('numbers nodes as itemsToFlow does, so the two read alike', () => {
    const { shapes, connectors } = board()
    const items = [...shapes, ...connectors]
    const viaText = parseFlow(itemsToFlow(items)).graph
    const { graph } = itemsToGraph(items)
    expect(graph.nodes.map((n) => [n.key, n.label])).toEqual(viaText.nodes.map((n) => [n.key, n.label]))
    expect(graph.edges.map((e) => [e.from, e.to])).toEqual(viaText.edges.map((e) => [e.from, e.to]))
  })

  it('leaves out frames and line shapes', () => {
    const items = [
      { id: 'f', type: 'shape', x: 0, y: 0, w: 500, h: 500, payload: { kind: 'frame' } },
      { id: 'l', type: 'shape', x: 0, y: 0, w: 50, h: 0, payload: { kind: 'arrow' } },
      { id: 'b', type: 'shape', x: 10, y: 10, w: 100, h: 50, payload: { kind: 'rect', radius: 0, text: 'Box' } },
    ]
    const { graph } = itemsToGraph(items)
    expect(graph.nodes).toEqual([{ key: 'n1', label: 'Box', kind: 'rect', round: 'none', itemId: 'b' }])
  })
})

describe('planDiagram', () => {
  it('inserts a fresh graph as shapes and connectors', () => {
    let g = addNode(emptyGraph(), { label: 'One' }).graph
    g = addNext(g, 'n1', { label: 'Two' }).graph
    const plan = planDiagram(g, { origin: { x: 0, y: 0 }, newId: ids() })
    expect(plan.update).toEqual([])
    expect(plan.remove).toEqual([])
    expect(plan.add.map((i) => i.type)).toEqual(['shape', 'shape', 'connector'])
    const [a, b, c] = plan.add
    expect(a.y).toBeLessThan(b.y)
    expect(c.payload).toMatchObject({ from: { itemId: a.id, side: 's' }, to: { itemId: b.id, side: 'n' }, head: 'arrow' })
    expect(plan.shapeIds).toEqual([a.id, b.id])
  })

  it('updates in place: keeps ids and styles, removes what was deleted', () => {
    const g0 = parseFlow('A[One] --> B[Two] --> C[Three]').graph
    const { shapes, connectors } = flowToItems(g0, { origin: { x: 100, y: 100 }, newId: ids() })
    shapes[0].payload.fill = '#ff0000'
    connectors[0].payload.bend = { dx: 30, dy: 0 }
    const outside = { id: 'out', type: 'shape', x: 900, y: 100, w: 100, h: 50, payload: { kind: 'rect' } }
    const dangling = { id: 'dl', type: 'connector', payload: { from: { itemId: shapes[2].id, side: 'e' }, to: { itemId: 'out', side: 'w' } } }
    const items = [...shapes, ...connectors, outside, dangling]
    const scope = { shapeIds: shapes.map((s) => s.id), connectorIds: connectors.map((c) => c.id) }

    let { graph, origin } = itemsToGraph([...shapes, ...connectors])
    graph = removeNode(graph, 'n3')                          // Three goes (and its link out)
    graph = { ...graph, nodes: graph.nodes.map((n) => (n.key === 'n1' ? { ...n, label: 'First' } : n)) }
    graph = updateEdge(graph, 0, { label: 'then', dashed: true })
    graph = addNext(graph, 'n2', { label: 'New' }).graph

    const plan = planDiagram(graph, { items, scope, origin, newId: () => 'fresh' + Math.random() })
    const upd = new Map(plan.update.map((u) => [u.id, u.patch]))
    expect(upd.get(shapes[0].id).payload).toMatchObject({ text: 'First', fill: '#ff0000' })
    expect(upd.get(shapes[1].id)).toMatchObject({ w: shapes[1].w, h: shapes[1].h })    // untouched text keeps its size
    const link = upd.get(connectors[0].id).payload
    expect(link).toMatchObject({ label: 'then', lineStyle: 'dashed' })
    expect(link.bend).toBeUndefined()
    expect(plan.remove.sort()).toEqual([shapes[2].id, connectors[1].id, 'dl'].sort())
    expect(plan.add.map((i) => i.type)).toEqual(['shape', 'connector'])
    expect(plan.add[0].payload.text).toBe('New')
    expect(Math.min(...plan.update.filter((u) => u.patch.x != null).map((u) => u.patch.x), plan.add[0].x)).toBe(origin.x)
  })

  it('lays a sideways graph out left to right', () => {
    let g = addNode(emptyGraph('right'), { label: 'a' }).graph
    g = addNext(g, 'n1', { label: 'b' }).graph
    const { nodes, sides } = layoutFor(g)
    expect(nodes[0].x).toBeLessThan(nodes[1].x)
    expect(sides[0]).toEqual(['e', 'w'])
  })
})

describe('shapeOutline', () => {
  it('draws boxes, rounded corners and registry shapes as SVG paths', () => {
    expect(shapeOutline('rect', 100, 50, 0)).toMatch(/^M0 0 L100 0/)
    expect(shapeOutline('roundedRect', 100, 50, 10)).toContain('A10 10 0 0 1 100 10')
    expect(shapeOutline('ellipse', 100, 50)).toMatch(/A50 25 0 0 1 0 25 A50 25 0 0 1 100 25/)
    expect(shapeOutline('rhombus', 100, 50)).toMatch(/^M50 0/)
    expect(shapeOutline('cylinder', 100, 120)).toMatch(/A50 18 /)
    expect(shapeOutline('parallelogram', 100, 50)).toContain('Z')
  })
})

describe('planDiagram ≡ flowToItems for a new diagram', () => {
  it('places exactly what text-to-diagram (and the CLI) would', () => {
    const g = parseFlow('flowchart TD\nA([Start]) --> B{Ok?}\nB -->|yes| C[(Store)]\nB -.-> D[/Ask about a fairly long thing/]\nD --> A').graph
    const want = flowToItems(g, { origin: { x: 10, y: 20 }, newId: ids() })
    const plan = planDiagram(g, { origin: { x: 10, y: 20 }, newId: ids() })
    expect(plan.add).toEqual([...want.shapes, ...want.connectors])
  })
})
