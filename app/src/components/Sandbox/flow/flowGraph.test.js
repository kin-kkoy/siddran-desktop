import { describe, it, expect } from 'vitest'
import { parseFlow, flowToItems, itemsToFlow } from './flowText'
import {
  emptyGraph, addNode, addNext, connect, removeNode, updateEdge, reverseEdge,
  graphToText, textToGraph, itemsToGraph, planDiagram, layoutFor, NODE_GROUPS, hasTextForm, familiesOf, moveFamily, setLowered, GAP_FAMILY, anchorOf, styleLinks, linkLook,
} from './flowGraph'
import { shapeOutline } from './svgPath'
import { routeConnector } from '../connectors/geometry'

const ids = () => { let i = 0; return () => `id${++i}` }
const strip = (g) => ({ dir: g.dir, nodes: g.nodes.map(({ key, label, kind, round }) => ({ key, label, kind, round })), edges: g.edges.map(({ from, to, label, head, dashed }) => ({ from, to, label, head, dashed })) })

describe('editing', () => {
  it('adds, links and removes nodes', () => {
    let g = emptyGraph()
    let r = addNode(g, { label: 'Start', kind: 'roundedRect', round: 'pill' }); g = r.graph
    const a = r.key
    r = addNext(g, a, { label: 'Next' }); g = r.graph
    expect(g.nodes.map((n) => n.key)).toEqual(['n1', 'n2'])
    expect(g.nodes[1]).toMatchObject({ kind: 'rect', round: 'some' })   // after a start, a step
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

  it('offers the shape menu\'s boxes, not its lines', () => {
    const all = NODE_GROUPS.flatMap((g) => g.kinds)
    expect(all).toEqual(expect.arrayContaining(['rect', 'rhombus', 'cylinder', 'cloud', 'terminator', 'speechBubble']))
    expect(all).not.toContain('arrow')
    expect(all).not.toContain('frame')
  })

  it('follows a start/end with a plain step', () => {
    let g = addNode(emptyGraph(), { kind: 'terminator', round: 'none' }).graph
    g = addNext(g, 'n1').graph
    expect(g.nodes[1]).toMatchObject({ kind: 'rect', round: 'some' })
  })
})

describe('graphToText', () => {
  it('round-trips through parseFlow, every kind and edge style', () => {
    let g = emptyGraph('right')
    const forms = [['rect', 'some'], ['roundedRect', 'some'], ['roundedRect', 'pill'], ['rhombus', 'none'], ['parallelogram', 'none'], ['cylinder', 'none'], ['ellipse', 'none'], ['hexagon', 'none']]
    for (const [kind, round] of forms) g = addNode(g, { label: `${kind} ${round}`, kind, round }).graph
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
    expect(hasTextForm('cloud')).toBe(false)
    // …but a box written differently is what the text now says
    expect(textToGraph('n1[A] --> n2{B}', prev).graph.nodes[1].kind).toBe('rhombus')
    // a terminator goes out as ([pill]) and comes back a terminator
    const term = { dir: 'down', nodes: [{ key: 'n1', label: 'Go', kind: 'terminator', round: 'none' }], edges: [] }
    expect(graphToText(term)).toContain('n1([Go])')
    expect(textToGraph(graphToText(term), term).graph.nodes[0].kind).toBe('terminator')
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
    expect(graph.nodes.map((n) => [n.label, n.kind, n.round])).toEqual(expect.arrayContaining([
      ['Start', 'roundedRect', 'pill'], ['Ok?', 'rhombus', 'none'], ['Store', 'cylinder', 'none'], ['Ask', 'parallelogram', 'none']]))
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

describe('families', () => {
  const twoFamilies = (dir) => {
    let g = addNode(emptyGraph(dir), { label: 'a' }).graph
    g = addNext(g, 'n1', { label: 'b' }).graph
    g = addNext(g, 'n1', { label: 'c' }).graph
    return addNode(g, { label: 'lonely' }).graph
  }
  const box = (nodes, keys) => {
    const ns = nodes.filter((n) => keys.includes(n.key))
    return { l: Math.min(...ns.map((n) => n.x)), r: Math.max(...ns.map((n) => n.x + n.w)), t: Math.min(...ns.map((n) => n.y)), b: Math.max(...ns.map((n) => n.y + n.h)) }
  }

  it('puts a new family beside the others, across the flow (top to bottom → a column to the right)', () => {
    const { nodes, sides, families } = layoutFor(twoFamilies('down'))
    expect(families).toBe(2)
    const tree = box(nodes, ['n1', 'n2', 'n3']), lone = box(nodes, ['n4'])
    expect(lone.l - tree.r).toBe(GAP_FAMILY)
    expect(lone.t).toBe(tree.t)
    expect(sides).toEqual([['s', 'n'], ['s', 'n']])
  })

  it('… and left to right → a row below', () => {
    const { nodes } = layoutFor(twoFamilies('right'))
    const tree = box(nodes, ['n1', 'n2', 'n3']), lone = box(nodes, ['n4'])
    expect(lone.t - tree.b).toBe(GAP_FAMILY)
    expect(lone.l).toBe(tree.l)
  })

  it('reorders families, keeping each family\'s own order', () => {
    const g = twoFamilies('down')
    const moved = moveFamily(g, 'n4', -1)
    expect(moved.nodes.map((n) => n.key)).toEqual(['n4', 'n1', 'n2', 'n3'])
    expect(familiesOf(moved)).toEqual([['n4'], ['n1', 'n2', 'n3']])
    expect(moveFamily(g, 'n4', 1)).toBe(g)         // already last
    const { nodes } = layoutFor(moved)
    expect(box(nodes, ['n4']).r).toBeLessThan(box(nodes, ['n1', 'n2', 'n3']).l)
  })

  it('lays one family out exactly as text-to-diagram does', () => {
    const g = parseFlow('A --> B\nA --> C\nC --> D').graph
    const { shapes } = flowToItems(g, { newId: ids() })
    const { nodes } = layoutFor(g)
    expect(nodes.map((n) => [n.x, n.y])).toEqual(shapes.map((s) => [s.x, s.y]))
  })
})

describe('lowering a node', () => {
  // parent P with two children: L (which has a long line of descendants) and R (alone).
  const tree = () => parseFlow('P --> L\nP --> R\nL --> L1 --> L2 --> L3').graph
  const at = (laid, k) => laid.nodes.find((n) => n.key === k)

  it('lets a childless node drop down beside the deep leaves of its sibling\'s branch', () => {
    const g = tree()
    let laid = layoutFor(g)
    expect(at(laid, 'R')).toMatchObject({ level: 1, canLower: true, canRaise: false })
    expect(at(laid, 'L')).toMatchObject({ canLower: false, hasKids: true })   // has children: stays above them
    const low = setLowered(g, 'R', 3)
    laid = layoutFor(low)
    expect(at(laid, 'R')).toMatchObject({ level: 4, lowered: 3, canLower: false, canRaise: true })
    expect(at(laid, 'R').y).toBe(at(laid, 'L3').y)
    expect(laid.sides[1]).toEqual(['s', 'n'])
  })

  it('gives the lowered node a clear lane: its link misses every box on the way down', () => {
    for (const dir of ['down', 'right']) {
      const g = { ...setLowered(tree(), 'R', 3), dir }
      const plan = planDiagram(g, { origin: { x: 0, y: 0 }, newId: ids() })
      const byId = new Map(plan.add.map((i) => [i.id, i]))
      const link = plan.add.find((i) => i.type === 'connector' && byId.get(i.payload.to.itemId).payload.text === 'R')
      expect(link.payload.bend).toBeTruthy()
      const from = byId.get(link.payload.from.itemId), to = byId.get(link.payload.to.itemId)
      const pts = routeConnector(anchorOf(from, link.payload.from.side), anchorOf(to, link.payload.to.side), 'elbow',
        { fromSide: link.payload.from.side, toSide: link.payload.to.side, bend: link.payload.bend })
      const others = plan.add.filter((i) => i.type === 'shape' && i !== from && i !== to)
      for (let k = 0; k < pts.length - 2; k += 2) {
        const [x1, y1, x2, y2] = [pts[k], pts[k + 1], pts[k + 2], pts[k + 3]]
        for (const o of others) {
          const hits = Math.max(x1, x2) > o.x && Math.min(x1, x2) < o.x + o.w && Math.max(y1, y2) > o.y && Math.min(y1, y2) < o.y + o.h
          expect(hits, `${dir}: segment ${[x1, y1, x2, y2]} crosses ${o.payload.text}`).toBe(false)
        }
      }
      // and the boxes themselves never overlap
      const shapes = plan.add.filter((i) => i.type === 'shape')
      for (const p of shapes) for (const q of shapes) if (p !== q) {
        expect(p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h).toBe(false)
      }
    }
  })

  it('leaves links without a lowered node unbent', () => {
    const plan = planDiagram(tree(), { origin: { x: 0, y: 0 }, newId: ids() })
    expect(plan.add.filter((i) => i.type === 'connector').every((c) => !c.payload.bend)).toBe(true)
  })

  it('never goes past the deepest level of its family', () => {
    const laid = layoutFor(setLowered(tree(), 'R', 99))
    expect(at(laid, 'R').level).toBe(4)
  })

  it('a node that has children ignores a drop', () => {
    const laid = layoutFor(setLowered(tree(), 'L', 2))
    expect(at(laid, 'L').level).toBe(1)
  })

  it('back to its natural place at 0, and the field goes', () => {
    const g = setLowered(setLowered(tree(), 'R', 2), 'R', 0)
    expect(g.nodes.find((n) => n.key === 'R').drop).toBeUndefined()
  })

  it('is kept on the board and comes back when reopened, and survives a Text-tab round trip', () => {
    const g = setLowered(tree(), 'R', 3)
    const plan = planDiagram(g, { origin: { x: 0, y: 0 }, newId: ids() })
    const r = plan.add.find((i) => i.payload?.text === 'R')
    expect(r.payload.flowDrop).toBe(3)
    const back = itemsToGraph(plan.add).graph
    const rr = back.nodes.find((n) => n.label === 'R')
    expect(rr.drop).toBe(3)
    expect(textToGraph(graphToText(back), back).graph.nodes.find((n) => n.label === 'R').drop).toBe(3)
  })
})

describe('link looks', () => {
  const fan = () => parseFlow('P --> A\nP --> B').graph

  it('restyles one link or all of them, keeping head/dashed in step', () => {
    let g = styleLinks(fan(), 'all', { routing: 'straight' })
    expect(g.edges.map((e) => linkLook(e, '#fff').routing)).toEqual(['straight', 'straight'])
    g = styleLinks(g, 1, { head: 'none', lineStyle: 'dotted', headStart: 'circle', stroke: '#ff0000', strokeWidth: 4 })
    expect(g.edges[1]).toMatchObject({ head: false, dashed: true })
    expect(linkLook(g.edges[1], '#fff')).toEqual({ routing: 'straight', head: 'none', headStart: 'circle', stroke: '#ff0000', strokeWidth: 4, lineStyle: 'dotted', body: null, avoid: false })
    expect(linkLook(g.edges[0], '#fff')).toMatchObject({ head: 'arrow', lineStyle: 'solid', stroke: '#fff' })
    g = styleLinks(g, 0, { body: 'tapered', routing: 'curved' })
    expect(linkLook(g.edges[0], '#fff')).toMatchObject({ body: 'tapered', routing: 'straight' })
  })

  it('lands on the board as the floating bar would set it, and reads back', () => {
    const g = styleLinks(styleLinks(fan(), 'all', { routing: 'curved', head: 'open' }), 1, { lineStyle: 'dotted', headStart: 'diamond' })
    const plan = planDiagram(g, { origin: { x: 0, y: 0 }, newId: ids() })
    const links = plan.add.filter((i) => i.type === 'connector')
    expect(links[0].payload).toMatchObject({ routing: 'curved', head: 'open' })
    expect(links[1].payload).toMatchObject({ routing: 'curved', head: 'open', lineStyle: 'dotted', dash: true, headStart: 'diamond' })
    const back = itemsToGraph(plan.add).graph
    expect(back.edges.map((e) => linkLook(e, '#e2ddf5'))).toEqual(g.edges.map((e) => linkLook(e, '#e2ddf5')))
  })

  it('updates a board link in place to the new look', () => {
    const { shapes, connectors } = flowToItems(fan(), { newId: ids() })
    const items = [...shapes, ...connectors]
    const { graph, origin } = itemsToGraph(items)
    const g = styleLinks(graph, 'all', { routing: 'straight', strokeWidth: 3, lineStyle: 'dashed' })
    const plan = planDiagram(g, { items, origin, scope: { shapeIds: shapes.map((x) => x.id), connectorIds: connectors.map((x) => x.id) }, newId: ids() })
    const p = plan.update.find((u) => u.id === connectors[0].id).patch.payload
    expect(p).toMatchObject({ routing: 'straight', strokeWidth: 3, lineStyle: 'dashed', dash: true })
  })

  it('carries "go around boxes" to the board and back, off by default', () => {
    expect(linkLook(fan().edges[0], '#fff').avoid).toBe(false)
    const g = styleLinks(styleLinks(fan(), 'all', { routing: 'curved' }), 0, { avoid: true })
    const plan = planDiagram(g, { origin: { x: 0, y: 0 }, newId: ids() })
    const links = plan.add.filter((i) => i.type === 'connector')
    expect(links[0].payload.avoid).toBe(true)
    expect(links[1].payload.avoid).toBeUndefined()
    expect(itemsToGraph(plan.add).graph.edges.map((e) => linkLook(e, '#fff').avoid)).toEqual([true, false])
    expect(linkLook(styleLinks(g, 0, { avoid: null }).edges[0], '#fff').avoid).toBe(false)
  })

  it('keeps a link\'s look through a Text-tab edit', () => {
    const g = styleLinks(fan(), 0, { routing: 'curved', stroke: '#52c47a' })
    const back = textToGraph(graphToText(g) + '  A --> B\n', g).graph
    expect(linkLook(back.edges[0], '#fff')).toMatchObject({ routing: 'curved', stroke: '#52c47a' })
    expect(back.edges[2].look).toBeUndefined()
  })

  it('a lowered node\'s link only takes the lane as an elbow', () => {
    const g = styleLinks(setLowered(parseFlow('P --> L\nP --> R\nL --> L1 --> L2').graph, 'R', 2), 'all', { routing: 'straight' })
    const plan = planDiagram(g, { origin: { x: 0, y: 0 }, newId: ids() })
    expect(plan.add.filter((i) => i.type === 'connector').every((c) => !c.payload.bend)).toBe(true)
  })
})
