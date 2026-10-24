// Flowchart text ⇄ Sandbox items, and the layered auto-layout behind "Tidy".
//
// A port of Siddran-CLI's crates/core/src/diagram.rs, which is what `siddran
// mcp` uses when an AI draws a diagram. Two implementations that must agree is
// a cost — the same one the CLI pays for recurrence — so the two keep identical
// constants and the tests here mirror the Rust tests case for case. Change the
// layout in one, change it in both.
//
// Syntax: the Mermaid flowchart subset people already know.
//
//     flowchart TD
//       A[Start] --> B{Logged in?}
//       B -->|yes| C(Dashboard)
//       B -- no --> D[/Login form/]

const GAP_LAYER = 72
const GAP_SIBLING = 48

export const DEFAULT_STYLE = { stroke: '#e2ddf5', text: '#e2ddf5', fill: 'transparent', font: 16 }

// ── parsing ─────────────────────────────────────────────────────────

// Bracket forms, longest opener first so `((` is not read as `(`.
const SHAPES = [
  ['([', '])', 'roundedRect', 'pill'],
  ['[(', ')]', 'cylinder', 'none'],
  ['((', '))', 'ellipse', 'none'],
  ['{{', '}}', 'hexagon', 'none'],
  ['[/', '/]', 'parallelogram', 'none'],
  ['[\\', '\\]', 'parallelogram', 'none'],
  ['[/', '\\]', 'parallelogram', 'none'],
  ['>', ']', 'rect', 'none'],
  ['[', ']', 'rect', 'some'],
  ['(', ')', 'roundedRect', 'some'],
  ['{', '}', 'rhombus', 'none'],
]

const SKIP = ['classdef ', 'class ', 'style ', 'linkstyle ', 'click ', 'subgraph', 'end', 'direction ']

export function parseFlow(text) {
  const g = { dir: null, nodes: [], edges: [] }
  const problems = []
  for (const raw of String(text || '').split('\n').flatMap((l) => l.split(';'))) {
    const line = raw.trim()
    if (!line || line.startsWith('%%') || line.startsWith('```')) continue
    const lower = line.toLowerCase()
    const head = lower.startsWith('flowchart') ? lower.slice(9) : lower.startsWith('graph') ? lower.slice(5) : null
    if (head != null) { g.dir = ['lr', 'rl'].includes(head.trim()) ? 'right' : 'down'; continue }
    if (SKIP.some((k) => lower === k.trim() || lower.startsWith(k))) continue
    // All or nothing per line: a line that fails halfway must not leave its
    // first node behind as a stray box.
    const trial = { dir: g.dir, nodes: g.nodes.map((n) => ({ ...n })), edges: [...g.edges] }
    try { statement(line, trial); g.nodes = trial.nodes; g.edges = trial.edges }
    catch (e) { problems.push(`${line}: ${e.message}`) }
  }
  if (!g.nodes.length) {
    throw new Error(problems.length ? `could not read any of it: ${problems.join('; ')}` : 'no nodes — write something like `A[Start] --> B[Next]`')
  }
  return { graph: g, problems }
}

function addNode(g, key, shape) {
  const n = g.nodes.find((x) => x.key === key)
  if (n) { if (shape) Object.assign(n, shape); return }
  g.nodes.push({ key, ...(shape || { label: key, kind: 'rect', round: 'some' }) })
}

function statement(line, g) {
  const c = { s: line, i: 0 }
  let left = nodeGroup(c, g)
  for (;;) {
    ws(c)
    if (c.i >= c.s.length) return
    const [label, head, dashed] = edgeOp(c)
    ws(c)
    const right = nodeGroup(c, g)
    for (const a of left) for (const b of right) g.edges.push({ from: a, to: b, label, head, dashed })
    left = right
  }
}

const rest = (c) => c.s.slice(c.i)
const ws = (c) => { while (c.s[c.i] === ' ' || c.s[c.i] === '\t') c.i++ }
const eat = (c, p) => { if (rest(c).startsWith(p)) { c.i += p.length; return true } return false }

function nodeGroup(c, g) {
  const keys = [nodeRef(c, g)]
  for (;;) {
    const save = c.i
    ws(c)
    if (eat(c, '&')) { ws(c); keys.push(nodeRef(c, g)) }
    else { c.i = save; return keys }
  }
}

const word = /[\p{L}\p{N}_]/u

function nodeRef(c, g) {
  ws(c)
  const start = c.i
  while (c.i < c.s.length) {
    const ch = c.s[c.i]
    // A hyphen joins words in a key (`log-in`) but starts an arrow (`-->`, `->`).
    const joins = ch === '-' && word.test(c.s[c.i + 1] || '')
    if (word.test(ch) || joins) c.i++
    else break
  }
  if (c.i === start) throw new Error(`expected a node at "${rest(c).slice(0, 12)}"`)
  const key = c.s.slice(start, c.i)
  addNode(g, key, nodeShape(c))
  return key
}

function nodeShape(c) {
  for (const [open, close, kind, round] of SHAPES) {
    if (!rest(c).startsWith(open)) continue
    const body = rest(c).slice(open.length)
    const end = body.indexOf(close)
    if (end < 0) continue   // not closed this way — another form with the same opener may fit
    const label = body.slice(0, end).trim().replace(/^"|"$/g, '')
    c.i += open.length + end + close.length
    return { label, kind, round }
  }
  const ch = c.s[c.i]
  if (ch === '[' || ch === '(' || ch === '{') throw new Error(`${ch} is never closed`)
  return null
}

const OPS = [['-.->', true, true], ['-.-', false, true], ['==>', true, false], ['===', false, false], ['-->', true, false],
  ['--x', true, false], ['--o', true, false], ['---', false, false], ['->', true, false], ['--', false, false]]

// Returns [label, has arrowhead, dashed].
function edgeOp(c) {
  const r = rest(c)
  // `-- label -->` / `-. label .->` / `== label ==>`: text inside the arrow.
  for (const [open, closes, dashed] of [['--', ['-->', '---'], false], ['-.', ['.->', '.-'], true], ['==', ['==>', '==='], false]]) {
    if (r.startsWith(open) && !['-->', '---', '-.-', '==>', '==='].some((x) => r.startsWith(x))) {
      const body = r.slice(open.length)
      for (const close of closes) {
        const end = body.indexOf(close)
        if (end >= 0 && body.slice(0, end).trim()) {
          c.i += open.length + end + close.length
          return [body.slice(0, end).trim(), close.endsWith('>'), dashed]
        }
      }
    }
  }
  for (const [op, head, dashed] of OPS) {
    if (!eat(c, op)) continue
    while (eat(c, '-') || eat(c, '=') || eat(c, '.')) { /* a longer arrow, same meaning */ }
    eat(c, '>')
    ws(c)
    let label = null
    if (eat(c, '|')) {
      const end = rest(c).indexOf('|')
      if (end < 0) throw new Error('edge label `|…` is never closed')
      label = rest(c).slice(0, end).trim().replace(/^"|"$/g, '') || null
      c.i += end + 1
    }
    return [label, head, dashed]
  }
  throw new Error(`expected an arrow like --> at "${r.slice(0, 12)}"`)
}

// ── sizing ──────────────────────────────────────────────────────────

/** Break a label into lines no wider than `max` characters, at spaces. */
export function wrap(label, max = 22) {
  const lines = []
  for (const para of String(label).split(/\\n|<br>|\n/)) {
    let cur = ''
    for (const w of para.split(/\s+/).filter(Boolean)) {
      if (cur && [...cur].length + 1 + [...w].length > max) { lines.push(cur); cur = '' }
      cur = cur ? `${cur} ${w}` : w
    }
    lines.push(cur)
  }
  return lines
}

/** Box size for a label in a given shape (a diamond's text sits in its middle half). */
export function nodeSize(label, kind, font = DEFAULT_STYLE.font) {
  const lines = wrap(label, 22)
  const longest = Math.max(1, ...lines.map((l) => [...l].length))
  const tw = Math.floor(longest * font * 11 / 20)
  const th = Math.floor(lines.length * font * 13 / 10)
  const [w, h] = {
    rhombus: [Math.floor(tw * 3 / 2) + 48, th * 2 + 32],
    ellipse: [Math.floor(tw * 5 / 4) + 40, th + 40],
    hexagon: [tw + 72, th + 36],
    parallelogram: [tw + 80, th + 32],
    cylinder: [tw + 48, th + 56],
  }[kind] || [tw + 48, th + 28]
  return { w: Math.max(w, 120), h: Math.max(h, 56), text: lines.join('\n') }
}

// ── layout ──────────────────────────────────────────────────────────

/**
 * Layered layout of `nodes` (each { key, w, h }) and `edges` ({ from, to }).
 * Returns key → { x, y } top-left, with the whole drawing's top-left at
 * `origin`, plus each edge's sides. Used for text-to-diagram and for Tidy.
 */
export function layoutGraph(nodes, edges, dir = 'down', origin = { x: 0, y: 0 }) {
  const n = nodes.length
  const index = new Map(nodes.map((nd, i) => [nd.key, i]))
  const E = edges.map((e) => [index.get(e.from), index.get(e.to)]).filter(([a, b]) => a != null && b != null)

  // 1. Cycles: an edge back to a node still on the DFS stack is a loop — drawn,
  //    but ignored for layering or the layers would never settle.
  const back = new Array(E.length).fill(false)
  const state = new Array(n).fill(0)
  const dfs = (v) => {
    state[v] = 1
    E.forEach(([a, b], ei) => {
      if (a !== v) return
      if (state[b] === 0) dfs(b)
      else if (state[b] === 1) back[ei] = true
    })
    state[v] = 2
  }
  for (let v = 0; v < n; v++) if (state[v] === 0) dfs(v)
  const fwd = E.filter((e, i) => !back[i] && e[0] !== e[1])

  // 2. Layers: longest path from a source.
  const layer = new Array(n).fill(0)
  for (let k = 0; k < n; k++) {
    let changed = false
    for (const [a, b] of fwd) if (layer[b] < layer[a] + 1) { layer[b] = layer[a] + 1; changed = true }
    if (!changed) break
  }
  const depth = Math.max(0, ...layer) + 1
  const rows = Array.from({ length: depth }, () => [])
  for (let v = 0; v < n; v++) rows[layer[v]].push(v)

  // 3. Order within a layer: barycentre of neighbours, a few sweeps each way.
  const posOf = () => { const p = new Array(n).fill(0); rows.forEach((r) => r.forEach((v, i) => { p[v] = i })); return p }
  for (let sweep = 0; sweep < 6; sweep++) {
    const down = sweep % 2 === 0
    const range = down ? [...Array(depth).keys()].slice(1) : [...Array(Math.max(0, depth - 1)).keys()].reverse()
    for (const l of range) {
      const p = posOf()
      const keyed = rows[l].map((v) => {
        const nb = fwd.filter(([a, b]) => (down ? b === v : a === v)).map(([a, b]) => p[down ? a : b])
        return [nb.length ? nb.reduce((s, x) => s + x, 0) / nb.length : p[v], v]
      })
      keyed.sort((x, y) => x[0] - y[0])
      rows[l] = keyed.map(([, v]) => v)
    }
  }

  // 4. Coordinates. "Along" is the flow axis, "across" the sibling axis.
  const along = (v) => (dir === 'down' ? nodes[v].h : nodes[v].w)
  const across = (v) => (dir === 'down' ? nodes[v].w : nodes[v].h)
  const cx = new Array(n).fill(0)
  rows.forEach((r, l) => {
    const want = r.map((v) => {
      const parents = fwd.filter(([, b]) => b === v).map(([a]) => cx[a])
      return l === 0 || !parents.length ? NaN : parents.reduce((s, x) => s + x, 0) / parents.length
    })
    const total = r.reduce((s, v) => s + across(v), 0) + GAP_SIBLING * Math.max(0, r.length - 1)
    let x = -total / 2
    const placed = []
    r.forEach((v, i) => {
      const half = across(v) / 2
      const target = Number.isNaN(want[i]) ? x + half : want[i]
      const min = placed.length ? placed[placed.length - 1][0] + placed[placed.length - 1][1] + GAP_SIBLING + half : -Infinity
      const c = Math.max(target, min)
      placed.push([c, half])
      x = c + half + GAP_SIBLING
    })
    // Pushing right only would drift the layer; recentre it on what it wanted.
    const diffs = placed.map((p, i) => want[i] - p[0]).filter((d) => !Number.isNaN(d))
    const shift = diffs.length ? diffs.reduce((s, d) => s + d, 0) / diffs.length : 0
    r.forEach((v, i) => { cx[v] = placed[i][0] + shift })
  })
  const layerAt = []
  let acc = 0
  rows.forEach((r, l) => { layerAt[l] = acc; acc += Math.max(0, ...r.map(along)) + GAP_LAYER })

  const rects = nodes.map((nd, v) => {
    const thick = Math.max(0, ...rows[layer[v]].map(along))
    const a = layerAt[layer[v]] + Math.trunc((thick - along(v)) / 2)
    const c = Math.round(cx[v]) - Math.trunc(across(v) / 2)
    return dir === 'down' ? { x: c, y: a } : { x: a, y: c }
  })
  const minX = Math.min(...rects.map((r) => r.x)), minY = Math.min(...rects.map((r) => r.y))
  const pos = new Map(nodes.map((nd, v) => [nd.key, { x: Math.round(rects[v].x + origin.x - minX), y: Math.round(rects[v].y + origin.y - minY) }]))

  const sides = edges.map((e) => {
    const a = index.get(e.from), b = index.get(e.to)
    if (a == null || b == null) return null
    const ei = E.findIndex(([x, y]) => x === a && y === b)
    return edgeSides(dir, layer[a], layer[b], cx[a], cx[b], ei >= 0 && back[ei])
  })
  return { pos, sides }
}

// Forward edges run with the flow; a loop back up leaves and re-enters on the
// outside edge so it does not cut back through the boxes between.
function edgeSides(dir, la, lb, ca, cb, isBack) {
  const [out, inn, outer, lo, hi] = dir === 'down' ? ['s', 'n', 'e', 'w', 'e'] : ['e', 'w', 's', 'n', 's']
  if (isBack || lb < la) return [outer, outer]
  if (lb === la) return cb >= ca ? [hi, lo] : [lo, hi]
  return [out, inn]
}

/** Parsed graph → Sandbox items (shapes, then connectors), at `origin`. */
export function flowToItems(graph, { origin = { x: 0, y: 0 }, style = DEFAULT_STYLE, newId } = {}) {
  const dir = graph.dir || 'down'
  const sized = graph.nodes.map((nd) => ({ ...nd, ...nodeSize(nd.label, nd.kind, style.font) }))
  const { pos, sides } = layoutGraph(sized, graph.edges, dir, origin)
  const ids = new Map(sized.map((nd) => [nd.key, newId()]))
  const shapes = sized.map((nd) => ({
    id: ids.get(nd.key), type: 'shape', ...pos.get(nd.key), w: nd.w, h: nd.h, rotation: 0,
    payload: {
      kind: nd.kind, fill: style.fill, stroke: style.stroke, strokeWidth: 2,
      radius: nd.round === 'pill' ? Math.trunc(nd.h / 2) : nd.round === 'some' ? 10 : 0,
      text: nd.text, textAlign: 'center', textColor: style.text, fontSize: style.font,
    },
  }))
  const connectors = graph.edges.map((e, i) => sides[i] && ({
    id: newId(), type: 'connector', x: 0, y: 0, w: 0, h: 0, rotation: 0,
    payload: {
      from: { itemId: ids.get(e.from), side: sides[i][0] }, to: { itemId: ids.get(e.to), side: sides[i][1] },
      routing: 'elbow', head: e.head ? 'arrow' : 'none', stroke: style.stroke, strokeWidth: 2,
      ...(e.label ? { label: e.label } : {}), ...(e.dashed ? { dash: true } : {}),
    },
  })).filter(Boolean)
  return { shapes, connectors }
}

/**
 * Re-lay-out existing shapes along the connectors between them ("Tidy").
 * Returns patches { id, x, y } plus connector side patches, keeping the group's
 * top-left where it was. Shapes keep their sizes.
 */
export function tidy(shapes, connectors, dir = 'down') {
  if (shapes.length < 2) return { moves: [], resides: [] }
  const ids = new Set(shapes.map((s) => s.id))
  const links = connectors.filter((c) => ids.has(c.payload?.from?.itemId) && ids.has(c.payload?.to?.itemId))
  const origin = { x: Math.min(...shapes.map((s) => s.x)), y: Math.min(...shapes.map((s) => s.y)) }
  const nodes = shapes.map((s) => ({ key: s.id, w: s.w, h: s.h }))
  const edges = links.map((c) => ({ from: c.payload.from.itemId, to: c.payload.to.itemId }))
  const { pos, sides } = layoutGraph(nodes, edges, dir, origin)
  return {
    moves: shapes.map((s) => ({ id: s.id, ...pos.get(s.id) })),
    resides: links.map((c, i) => ({ id: c.id, from: sides[i][0], to: sides[i][1] })),
  }
}

/** Items → flowchart text (what "Copy as text" puts on the clipboard). */
export function itemsToFlow(items) {
  const shapes = items.filter((i) => i.type === 'shape').sort((a, b) => Math.trunc(a.y / 40) - Math.trunc(b.y / 40) || a.x - b.x)
  const key = new Map(shapes.map((s, i) => [s.id, `n${i + 1}`]))
  const br = { rhombus: ['{', '}'], ellipse: ['((', '))'], roundedRect: ['(', ')'], hexagon: ['{{', '}}'], cylinder: ['[(', ')]'], parallelogram: ['[/', '/]'] }
  const lines = ['flowchart TD']
  for (const s of shapes) {
    const [o, c] = br[s.payload?.kind] || ['[', ']']
    lines.push(`  ${key.get(s.id)}${o}${String(s.payload?.text || '…').replace(/\n/g, ' ')}${c}`)
  }
  for (const cn of items.filter((i) => i.type === 'connector')) {
    const a = key.get(cn.payload?.from?.itemId), b = key.get(cn.payload?.to?.itemId)
    if (!a || !b) continue
    const arrow = cn.payload.head === 'none' ? '---' : '-->'
    lines.push(cn.payload.label ? `  ${a} ${arrow}|${cn.payload.label}| ${b}` : `  ${a} ${arrow} ${b}`)
  }
  return lines.join('\n') + '\n'
}
