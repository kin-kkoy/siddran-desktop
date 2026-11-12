// The node editor's model: a flowchart graph you edit by hand, and the bridges
// to the two things it sits between — flowchart text (the Text tab, AI, paste)
// and board items (Insert / Update).
//
// A graph is the same shape `parseFlow` returns, so flowText.js's layout draws
// it unchanged (and the CLI's diagram.rs, which mirrors that file, stays the
// only layout to keep in step):
//
//   { dir: 'down' | 'right',
//     nodes: [{ key, label, kind, round, itemId? }],
//     edges: [{ from, to, label, head, dashed, itemId? }] }
//
// `itemId` is set on nodes and edges that came from the board, so Update can
// change those items in place (keeping their colours, ids and undo history)
// rather than deleting and redrawing them.

import { layoutGraph, nodeSize, wrap, DEFAULT_STYLE, parseFlow } from './flowText'
import { isLineKind, SHAPES, shapesInGroup } from '../shapes/registry'
import { isFrame } from '../frames/frames'

/**
 * The node kinds the editor offers: the shape menu's own sections, minus lines
 * (a node is a box) — so any shape you can draw can be a step.
 */
export const NODE_GROUPS = [
  { id: 'basic', label: 'Basic' }, { id: 'flowchart', label: 'Flowchart' }, { id: 'callout', label: 'Callouts' },
].map((g) => ({ ...g, kinds: shapesInGroup(g.id) }))

export const kindLabel = (kind) => SHAPES[kind]?.label || kind

// The kinds flowchart text has a bracket form for; any other shape is written
// as a plain [box] and kept as it is when the text comes back (textToGraph).
const TEXT_KINDS = new Set(['rect', 'roundedRect', 'terminator', 'rhombus', 'ellipse', 'hexagon', 'cylinder', 'parallelogram'])
export const hasTextForm = (kind) => TEXT_KINDS.has(kind)

/** The `round` a kind gets when picked: text's `[box]` is a rect with soft corners. */
export const roundFor = (kind) => (kind === 'rect' || kind === 'roundedRect' ? 'some' : 'none')

export const emptyGraph = (dir = 'down') => ({ dir, nodes: [], edges: [] })

// ── editing (all pure: each returns a new graph) ─────────────────────

/** A key no node has yet: n1, n2, … */
export function freshKey(g) {
  const used = new Set(g.nodes.map((n) => n.key))
  let i = g.nodes.length + 1
  while (used.has(`n${i}`)) i++
  return `n${i}`
}

export function addNode(g, { label = '', kind = 'rect', round = 'some' } = {}) {
  const key = freshKey(g)
  return { graph: { ...g, nodes: [...g.nodes, { key, label, kind, round }] }, key }
}

export function updateNode(g, key, patch) {
  return { ...g, nodes: g.nodes.map((n) => (n.key === key ? { ...n, ...patch } : n)) }
}

export function removeNode(g, key) {
  return { ...g, nodes: g.nodes.filter((n) => n.key !== key), edges: g.edges.filter((e) => e.from !== key && e.to !== key) }
}

/** Link a → b. A second identical link or a self-link is refused (returns g). */
export function connect(g, from, to, extra = {}) {
  if (from === to || !g.nodes.some((n) => n.key === from) || !g.nodes.some((n) => n.key === to)) return g
  if (g.edges.some((e) => e.from === from && e.to === to)) return g
  return { ...g, edges: [...g.edges, { from, to, label: null, head: true, dashed: false, ...extra }] }
}

/** A new node linked from `from` — the editor's "next step". */
export function addNext(g, from, opts = {}) {
  const src = g.nodes.find((n) => n.key === from)
  // After a decision or a start/end come steps (as Tab does on the board).
  const plain = !src || ['rhombus', 'terminator'].includes(src.kind) || (src.kind === 'roundedRect' && src.round === 'pill')
  const like = plain ? { kind: 'rect', round: 'some' } : { kind: src.kind, round: src.round }
  const { graph, key } = addNode(g, { ...like, ...opts })
  return { graph: connect(graph, from, key), key }
}

export function updateEdge(g, i, patch) {
  return { ...g, edges: g.edges.map((e, j) => (j === i ? { ...e, ...patch } : e)) }
}

export function removeEdge(g, i) {
  return { ...g, edges: g.edges.filter((_, j) => j !== i) }
}

/** Flip an edge's direction. */
export function reverseEdge(g, i) {
  const e = g.edges[i]
  if (!e || g.edges.some((x) => x.from === e.to && x.to === e.from)) return g
  return updateEdge(g, i, { from: e.to, to: e.from })
}

// ── link looks ───────────────────────────────────────────────────────
//
// What a link's text can say is on/off: an arrowhead or not (`head`), dashed
// or not (`dashed`). Everything else the floating bar can set — which head,
// a head at the start, the route, colour, width, dotted vs dashed, tapered —
// rides along in an optional `look`, kept by the editor and the board.

const LOOK_KEYS = ['routing', 'head', 'headStart', 'stroke', 'strokeWidth', 'lineStyle', 'body', 'avoid']

/** A board connector's payload → the look fields it sets. */
function lookOf(p) {
  const look = {}
  for (const k of LOOK_KEYS) if (p[k] != null && p[k] !== '') look[k] = p[k]
  return look
}

/** A link's effective look: its own settings over the defaults (`stroke` = the diagram's colour). */
export function linkLook(e, stroke) {
  const k = e.look || {}
  return {
    routing: k.body === 'tapered' ? 'straight' : (k.routing || 'elbow'),
    head: e.head ? (k.head && k.head !== 'none' ? k.head : 'arrow') : 'none',
    headStart: k.headStart || 'none',
    stroke: k.stroke || stroke,
    strokeWidth: k.strokeWidth || 2,
    lineStyle: e.dashed ? (k.lineStyle === 'dotted' ? 'dotted' : 'dashed') : 'solid',
    body: k.body === 'tapered' ? 'tapered' : null,
    avoid: !!k.avoid,
  }
}

/**
 * Restyle link `which` (its index) or every link ('all'). `patch` holds any of
 * routing, head, headStart, stroke, strokeWidth, lineStyle, body, avoid (null clears).
 */
export function styleLinks(g, which, patch) {
  return {
    ...g,
    edges: g.edges.map((e, i) => {
      if (which !== 'all' && which !== i) return e
      const out = { ...e }, look = { ...(e.look || {}) }
      for (const [k, v] of Object.entries(patch)) {
        if (k === 'head') out.head = v !== 'none'
        if (k === 'lineStyle') out.dashed = v !== 'solid'
        if (v == null) delete look[k]; else look[k] = v
      }
      // A tapered body is one straight, swelling arrow.
      if (look.body === 'tapered') look.routing = 'straight'
      out.look = look
      return out
    }),
  }
}

// ── text ⇄ graph ─────────────────────────────────────────────────────

const BRACKETS = {
  rhombus: ['{', '}'], ellipse: ['((', '))'], hexagon: ['{{', '}}'], cylinder: ['[(', ')]'], parallelogram: ['[/', '/]'],
}

function brackets(n) {
  if (n.kind === 'terminator') return ['([', '])']
  if (n.kind === 'roundedRect') return n.round === 'pill' ? ['([', '])'] : ['(', ')']
  if (n.kind === 'rect') return n.round === 'none' ? ['>', ']'] : ['[', ']']
  return BRACKETS[n.kind] || ['[', ']']
}

// A label is written between brackets and read back up to the first closer, so
// a closer inside it would cut it short; swap those characters for look-alikes.
const SAFE = { ']': '⟧', ')': '⟯', '}': '⦄', '|': '¦' }
const safe = (s, chars) => String(s ?? '').replace(/\n/g, ' ').replace(new RegExp(`[${chars.replace(/[\]\\]/g, '\\$&')}]`, 'g'), (c) => SAFE[c] || c).trim()

function arrow(e) {
  if (e.dashed) return e.head ? '-.->' : '-.-'
  return e.head ? '-->' : '---'
}

/** Graph → flowchart text that `parseFlow` reads back to the same graph. */
export function graphToText(g) {
  const lines = [`flowchart ${g.dir === 'right' ? 'LR' : 'TD'}`]
  for (const n of g.nodes) {
    const [o, c] = brackets(n)
    lines.push(`  ${n.key}${o}${safe(n.label, c) || '…'}${c}`)
  }
  for (const e of g.edges) {
    const label = e.label ? `|${safe(e.label, '|')}| ` : ''
    lines.push(`  ${e.from} ${arrow(e)}${label ? '' : ' '}${label}${e.to}`)
  }
  return lines.join('\n') + '\n'
}

/**
 * Flowchart text → graph, keeping the board links of `prev` where the text still
 * names the same thing: a node by its key, an edge by its two ends.
 */
export function textToGraph(text, prev = null) {
  const { graph, problems } = parseFlow(text)
  const g = { dir: graph.dir || prev?.dir || 'down', nodes: graph.nodes.map((n) => ({ ...n })), edges: graph.edges.map((e) => ({ ...e })) }
  if (prev) {
    const byKey = new Map(prev.nodes.map((n) => [n.key, n]))
    for (const n of g.nodes) {
      const old = byKey.get(n.key)
      if (!old) continue
      if (old.itemId) n.itemId = old.itemId
      if (old.drop) n.drop = old.drop
      // Written the same way as before means the same shape: the text has no
      // word for a cloud or a terminator, so their [box] / ([pill]) coming
      // back unchanged keeps them a cloud or a terminator.
      if (brackets(n).join() === brackets(old).join()) { n.kind = old.kind; n.round = old.round }
      if (n.label === '…' && !old.label) n.label = ''
    }
    // A link the text still has (same two ends) keeps its board id and its
    // look — the head type, route, colour… the text has no words for.
    const pool = [...prev.edges]
    for (const e of g.edges) {
      const i = pool.findIndex((p) => p.from === e.from && p.to === e.to)
      if (i < 0) continue
      if (pool[i].itemId) e.itemId = pool[i].itemId
      if (pool[i].look) e.look = pool[i].look
      pool.splice(i, 1)
    }
  }
  for (const n of g.nodes) if (n.label === '…') n.label = ''
  return { graph: g, problems }
}

// ── board items → graph ──────────────────────────────────────────────

/** The shapes in `items` a diagram is made of (no frames, lines or arrows-as-shapes). */
export const isDiagramShape = (i) => i?.type === 'shape' && !isFrame(i) && !isLineKind(i.payload?.kind)

function roundOf(s) {
  const r = s.payload?.radius || 0
  if (s.payload?.kind === 'roundedRect') return r >= s.h / 2 - 1 ? 'pill' : 'some'
  if (s.payload?.kind === 'rect') return r > 0 ? 'some' : 'none'
  return 'none'
}

/**
 * Selected board items → an editable graph. Keys run n1, n2… in reading order,
 * exactly as `itemsToFlow` (and the CLI's `describe`) number them, so a diagram
 * reads the same in the editor, on the clipboard, and to an AI.
 */
export function itemsToGraph(items) {
  const shapes = items.filter(isDiagramShape).sort((a, b) => Math.trunc(a.y / 40) - Math.trunc(b.y / 40) || a.x - b.x)
  const key = new Map(shapes.map((s, i) => [s.id, `n${i + 1}`]))
  const nodes = shapes.map((s) => ({
    key: key.get(s.id), label: String(s.payload?.text || '').replace(/\n/g, ' '),
    kind: s.payload?.kind || 'rect', round: roundOf(s), itemId: s.id,
    ...(s.payload?.flowDrop > 0 ? { drop: s.payload.flowDrop } : {}),
  }))
  const links = items.filter((i) => i.type === 'connector' && key.has(i.payload?.from?.itemId) && key.has(i.payload?.to?.itemId))
  const edges = links.map((c) => ({
    from: key.get(c.payload.from.itemId), to: key.get(c.payload.to.itemId),
    label: c.payload.label || null, head: (c.payload.head || 'arrow') !== 'none',
    dashed: ['dashed', 'dotted'].includes(c.payload.lineStyle) || (!c.payload.lineStyle && !!c.payload.dash), itemId: c.id,
    look: lookOf(c.payload),
  }))
  // Running sideways if most links leave and enter through the left/right sides.
  const sideways = links.filter((c) => 'ew'.includes(c.payload.from.side || 'x') && 'ew'.includes(c.payload.to.side || 'x')).length
  const dir = links.length && sideways * 2 > links.length ? 'right' : 'down'
  const origin = shapes.length ? { x: Math.min(...shapes.map((s) => s.x)), y: Math.min(...shapes.map((s) => s.y)) } : { x: 0, y: 0 }
  return { graph: { dir, nodes, edges }, origin }
}

// ── layout (the preview, and what Insert / Update places) ────────────

/**
 * Sizes and positions for every node, and each edge's sides — the same layered
 * layout as text-to-diagram and Tidy. A node still showing its board text
 * keeps its board size; anything new or retyped is sized from its label.
 */
export function layoutFor(g, { byId = new Map(), origin = { x: 0, y: 0 }, font = DEFAULT_STYLE.font } = {}) {
  const sized = g.nodes.map((n) => {
    const item = n.itemId && byId.get(n.itemId)
    if (item && String(item.payload?.text || '').replace(/\n/g, ' ') === n.label && item.payload?.kind === n.kind) {
      return { ...n, w: item.w, h: item.h, text: item.payload?.text || '' }
    }
    return { ...n, ...nodeSize(n.label || ' ', n.kind, font), text: n.label ? wrap(n.label, 22).join('\n') : '' }
  })
  const dir = g.dir || 'down'
  const drop = new Map(g.nodes.filter((n) => n.drop > 0).map((n) => [n.key, n.drop]))
  const fams = familiesOf(g)
  const sides = new Array(g.edges.length).fill(null)
  const turns = new Array(g.edges.length).fill(null)
  const nodes = []
  // Families sit side by side across the flow: in columns when it runs down,
  // in rows when it runs right. Each is laid out on its own, so no node ever
  // crosses into a neighbour's tree.
  let across = dir === 'down' ? origin.x : origin.y
  fams.forEach((keys, f) => {
    const set = new Set(keys)
    const sub = sized.filter((n) => set.has(n.key))
    const at = [], subEdges = []
    g.edges.forEach((e, i) => { if (set.has(e.from) && set.has(e.to)) { at.push(i); subEdges.push(e) } })
    const placed = layoutGraph(sub, subEdges, dir, dir === 'down' ? { x: across, y: origin.y } : { x: origin.x, y: across }, { drop })
    placed.sides.forEach((sd, j) => { sides[at[j]] = sd; turns[at[j]] = placed.turns[j] })
    for (const n of sub) {
      const level = placed.layers.get(n.key), natural = placed.natural.get(n.key)
      nodes.push({
        ...n, ...placed.pos.get(n.key), family: f, level,
        lowered: level - natural,
        // May it go lower / back up? Only a node with no children moves,
        // and never past the deepest level of its own family.
        canLower: placed.leaves.has(n.key) && level < placed.depth - 1,
        canRaise: level > natural,
        hasKids: !placed.leaves.has(n.key),
      })
    }
    const far = Math.max(...sub.map((n) => (dir === 'down' ? placed.pos.get(n.key).x + n.w : placed.pos.get(n.key).y + n.h)))
    across = far + GAP_FAMILY
  })
  const order = new Map(g.nodes.map((n, i) => [n.key, i]))
  nodes.sort((a, b) => order.get(a.key) - order.get(b.key))
  return { nodes, sides, turns, families: fams.length }
}

/** Where a link meets a (laid-out, unrotated) box on `side`. */
export const anchorOf = (n, side) => ({
  n: { x: n.x + n.w / 2, y: n.y }, s: { x: n.x + n.w / 2, y: n.y + n.h },
  e: { x: n.x + n.w, y: n.y + n.h / 2 }, w: { x: n.x, y: n.y + n.h / 2 },
}[side])

/**
 * The connector `bend` that sends a lowered node's link down its lane: turn
 * `turn` past the parent, cross to the child's column, then run straight in.
 * (A bend is stored as an offset from the midpoint of the two ends.)
 */
export function laneBend(a, b, sides, turn, dir) {
  if (turn == null || !sides) return null
  const p = anchorOf(a, sides[0]), q = anchorOf(b, sides[1])
  return dir === 'right'
    ? { dx: Math.round(p.x + turn - (p.x + q.x) / 2), dy: 0 }
    : { dx: 0, dy: Math.round(p.y + turn - (p.y + q.y) / 2) }
}

/** Space between families (groups with no link between them), so they read as separate. */
export const GAP_FAMILY = 144

/** The families of a graph — groups of linked nodes — in order of their first node. */
export function familiesOf(g) {
  const index = new Map(g.nodes.map((n, i) => [n.key, i]))
  const parent = g.nodes.map((_, i) => i)
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] } return i }
  for (const e of g.edges) {
    const a = index.get(e.from), b = index.get(e.to)
    if (a != null && b != null) parent[find(a)] = find(b)
  }
  const groups = new Map()
  g.nodes.forEach((n, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(n.key) })
  return [...groups.values()]
}

/** Move the family `key` belongs to one place earlier (-1) or later (+1). */
export function moveFamily(g, key, delta) {
  const fams = familiesOf(g)
  const i = fams.findIndex((f) => f.includes(key))
  const j = i + delta
  if (i < 0 || j < 0 || j >= fams.length) return g
  ;[fams[i], fams[j]] = [fams[j], fams[i]]
  const byKey = new Map(g.nodes.map((n) => [n.key, n]))
  return { ...g, nodes: fams.flat().map((k) => byKey.get(k)) }
}

/** Set how many levels below its natural place a childless node sits (0 = natural). */
export function setLowered(g, key, levels) {
  const drop = Math.max(0, levels)
  return updateNode(g, key, { drop: drop || undefined })
}

const radiusFor = (n, h) => (n.round === 'pill' ? Math.trunc(h / 2) : n.round === 'some' ? 10 : 0)

/**
 * What Insert (nothing linked yet) or Update (a graph opened from the board)
 * does to the board: items to add, items to patch, item ids to remove.
 *
 * - `scope` is what was opened: { shapeIds, connectorIds }.
 * - `items` is the whole board, so links from a removed box to boxes outside
 *   the selection go too, instead of dangling.
 */
export function planDiagram(g, { items = [], scope = null, origin, style = DEFAULT_STYLE, newId }) {
  const byId = new Map(items.map((i) => [i.id, i]))
  const laid = layoutFor(g, { byId, origin, font: style.font })
  const add = [], update = [], remove = []
  const idOf = new Map()

  for (const n of laid.nodes) {
    const item = n.itemId && byId.get(n.itemId)
    const box = { x: n.x, y: n.y, w: n.w, h: n.h }
    if (item) {
      idOf.set(n.key, item.id)
      const keepRadius = item.payload?.kind === n.kind && roundOf(item) === n.round
      const payload = { ...item.payload, kind: n.kind, text: n.text, radius: keepRadius ? item.payload?.radius : radiusFor(n, n.h) }
      // How far the editor lowered it, so it opens the same way next time.
      if (n.drop > 0) payload.flowDrop = n.drop; else delete payload.flowDrop
      update.push({ id: item.id, patch: { ...box, payload } })
    } else {
      const id = newId()
      idOf.set(n.key, id)
      add.push({
        id, type: 'shape', ...box, rotation: 0,
        payload: {
          kind: n.kind, fill: style.fill, stroke: style.stroke, strokeWidth: 2, radius: radiusFor(n, n.h),
          text: n.text, textAlign: 'center', textColor: style.text, fontSize: style.font,
          ...(n.drop > 0 ? { flowDrop: n.drop } : {}),
        },
      })
    }
  }

  const at = new Map(laid.nodes.map((n) => [n.key, n]))
  g.edges.forEach((e, i) => {
    const sides = laid.sides[i]
    if (!sides) return
    const item = e.itemId && byId.get(e.itemId)
    const L = linkLook(e, item?.payload?.stroke || style.stroke)
    // Only an elbow takes the lane; a straight or curved link goes its own way.
    const bend = L.routing === 'elbow' ? laneBend(at.get(e.from), at.get(e.to), sides, laid.turns[i], g.dir) : null
    const ends = { from: { itemId: idOf.get(e.from), side: sides[0] }, to: { itemId: idOf.get(e.to), side: sides[1] } }
    if (item) {
      const p = { ...item.payload, ...ends }
      // Re-laid-out, an old bend would pull the line somewhere strange;
      // a link to a lowered node gets the one that takes it down its lane.
      if (bend) p.bend = bend; else delete p.bend
      if (e.label) p.label = e.label; else delete p.label
      Object.assign(p, { routing: L.routing, head: L.head, stroke: L.stroke, strokeWidth: L.strokeWidth })
      if (L.headStart !== 'none') p.headStart = L.headStart; else delete p.headStart
      if (L.body) p.body = L.body; else delete p.body
      if (L.avoid) p.avoid = true; else delete p.avoid
      const was = ['dashed', 'dotted'].includes(p.lineStyle) ? p.lineStyle : (!p.lineStyle && p.dash ? 'dashed' : 'solid')
      // `dash` kept in step, as the floating bar does, for siddran-cli and older builds.
      if (L.lineStyle !== was) { p.lineStyle = L.lineStyle; p.dash = L.lineStyle !== 'solid' }
      update.push({ id: item.id, patch: { payload: p } })
    } else {
      add.push({
        id: newId(), type: 'connector', x: 0, y: 0, w: 0, h: 0, rotation: 0,
        payload: {
          ...ends, routing: L.routing, head: L.head, stroke: L.stroke, strokeWidth: L.strokeWidth,
          ...(e.label ? { label: e.label } : {}), ...(e.dashed ? { dash: true } : {}), ...(bend ? { bend } : {}),
          ...(L.lineStyle === 'dotted' ? { lineStyle: 'dotted' } : {}),
          ...(L.headStart !== 'none' ? { headStart: L.headStart } : {}), ...(L.body ? { body: L.body } : {}), ...(L.avoid ? { avoid: true } : {}),
        },
      })
    }
  })

  if (scope) {
    const keptShapes = new Set(g.nodes.map((n) => n.itemId).filter(Boolean))
    const keptLinks = new Set(g.edges.map((e) => e.itemId).filter(Boolean))
    const gone = new Set(scope.shapeIds.filter((id) => !keptShapes.has(id) && byId.has(id)))
    for (const id of gone) remove.push(id)
    for (const id of scope.connectorIds) if (!keptLinks.has(id) && byId.has(id)) remove.push(id)
    for (const it of items) {
      if (it.type === 'connector' && !remove.includes(it.id) && (gone.has(it.payload?.from?.itemId) || gone.has(it.payload?.to?.itemId))) remove.push(it.id)
    }
  }
  return { add, update, remove, shapeIds: laid.nodes.map((n) => idOf.get(n.key)) }
}
