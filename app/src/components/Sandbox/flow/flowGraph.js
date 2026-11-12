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
import { isLineKind } from '../shapes/registry'
import { isFrame } from '../frames/frames'

/** The node kinds the editor offers, in picker order. */
export const NODE_KINDS = [
  { id: 'box', kind: 'rect', round: 'some', label: 'Step' },
  { id: 'rounded', kind: 'roundedRect', round: 'some', label: 'Rounded step' },
  { id: 'terminal', kind: 'roundedRect', round: 'pill', label: 'Start / end' },
  { id: 'decision', kind: 'rhombus', round: 'none', label: 'Decision' },
  { id: 'data', kind: 'parallelogram', round: 'none', label: 'Data (input / output)' },
  { id: 'database', kind: 'cylinder', round: 'none', label: 'Database' },
  { id: 'circle', kind: 'ellipse', round: 'none', label: 'Circle' },
  { id: 'prep', kind: 'hexagon', round: 'none', label: 'Preparation' },
]

/** Which picker entry a node is, or null for a board shape the text can't name. */
export function kindOf(node) {
  if (node.kind === 'roundedRect') return NODE_KINDS.find((k) => k.id === (node.round === 'pill' ? 'terminal' : 'rounded'))
  if (node.kind === 'rect') return NODE_KINDS[0]
  return NODE_KINDS.find((k) => k.kind === node.kind) || null
}

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
  // After a decision come steps, not more questions (as Tab does on the board).
  const like = src && src.kind !== 'rhombus' ? { kind: src.kind, round: src.round } : { kind: 'rect', round: 'some' }
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

// ── text ⇄ graph ─────────────────────────────────────────────────────

const BRACKETS = {
  rhombus: ['{', '}'], ellipse: ['((', '))'], hexagon: ['{{', '}}'], cylinder: ['[(', ')]'], parallelogram: ['[/', '/]'],
}

function brackets(n) {
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
      // The text has no word for a board-only shape (a cloud, a sticky); a plain
      // box in the text for one of those means "unchanged", not "make it a box".
      if (!kindOf(old) && n.kind === 'rect' && n.round === 'some') { n.kind = old.kind; n.round = old.round }
      if (n.label === '…' && !old.label) n.label = ''
    }
    const pool = prev.edges.filter((e) => e.itemId)
    for (const e of g.edges) {
      const i = pool.findIndex((p) => p.from === e.from && p.to === e.to)
      if (i >= 0) { e.itemId = pool[i].itemId; pool.splice(i, 1) }
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
  }))
  const links = items.filter((i) => i.type === 'connector' && key.has(i.payload?.from?.itemId) && key.has(i.payload?.to?.itemId))
  const edges = links.map((c) => ({
    from: key.get(c.payload.from.itemId), to: key.get(c.payload.to.itemId),
    label: c.payload.label || null, head: (c.payload.head || 'arrow') !== 'none',
    dashed: ['dashed', 'dotted'].includes(c.payload.lineStyle) || (!c.payload.lineStyle && !!c.payload.dash), itemId: c.id,
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
  const { pos, sides } = layoutGraph(sized, g.edges, g.dir || 'down', origin)
  return { nodes: sized.map((n) => ({ ...n, ...pos.get(n.key) })), sides }
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
      update.push({ id: item.id, patch: { ...box, payload: { ...item.payload, kind: n.kind, text: n.text, radius: keepRadius ? item.payload?.radius : radiusFor(n, n.h) } } })
    } else {
      const id = newId()
      idOf.set(n.key, id)
      add.push({
        id, type: 'shape', ...box, rotation: 0,
        payload: {
          kind: n.kind, fill: style.fill, stroke: style.stroke, strokeWidth: 2, radius: radiusFor(n, n.h),
          text: n.text, textAlign: 'center', textColor: style.text, fontSize: style.font,
        },
      })
    }
  }

  g.edges.forEach((e, i) => {
    const sides = laid.sides[i]
    if (!sides) return
    const item = e.itemId && byId.get(e.itemId)
    const ends = { from: { itemId: idOf.get(e.from), side: sides[0] }, to: { itemId: idOf.get(e.to), side: sides[1] } }
    if (item) {
      const p = { ...item.payload, ...ends }
      // Re-laid-out, an old bend would pull the line somewhere strange.
      delete p.bend
      if (e.label) p.label = e.label; else delete p.label
      if (!e.head) p.head = 'none'
      else if (!p.head || p.head === 'none') p.head = 'arrow'
      const wasDashed = ['dashed', 'dotted'].includes(p.lineStyle) || (!p.lineStyle && !!p.dash)
      if (e.dashed !== wasDashed) { p.lineStyle = e.dashed ? 'dashed' : 'solid'; delete p.dash }
      update.push({ id: item.id, patch: { payload: p } })
    } else {
      add.push({
        id: newId(), type: 'connector', x: 0, y: 0, w: 0, h: 0, rotation: 0,
        payload: {
          ...ends, routing: 'elbow', head: e.head ? 'arrow' : 'none', stroke: style.stroke, strokeWidth: 2,
          ...(e.label ? { label: e.label } : {}), ...(e.dashed ? { dash: true } : {}),
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
