// Render a diagram's items to SVG.
//
// Why SVG and not Konva, when the Sandbox is Konva: this same picture has to
// appear in three places — the editor's live preview, the reading view, and a
// PDF export. The reading view renders notes through `dangerouslySetInnerHTML`
// (ReadingView.jsx), and that file already warns that any React re-render
// re-applies the innerHTML and wipes DOM mutations made underneath it. Mounting
// canvas roots into that subtree fights the architecture; an <svg> element in
// the HTML does not, and comes along in the PDF for free.
//
// The geometry is NOT written twice. `shapes/registry.js` draws every non-
// primitive shape by calling moveTo / lineTo / arcTo / ellipse / closePath on a
// canvas2d context — so we hand it a context that records those calls and emits
// an SVG path instead. One shape vocabulary, two backends, and a shape added to
// the Sandbox shows up here without being re-implemented.
//
// Curves are flattened to short line segments rather than converted to SVG arc
// commands. The exact conversion (tangent points for arcTo, endpoint
// parameterisation for ellipse) is a well-known pile of trigonometry whose only
// payoff would be a slightly smaller `d` string; at the size a diagram appears
// in a note the difference is invisible, and flattening is far harder to get
// subtly wrong.

import { renderShape, isLineKind } from '../components/Sandbox/shapes/registry'
import { connectorPoints } from '../components/Sandbox/connectors/geometry'
import { diagramBounds } from './diagramBlock'

const SEGMENTS_PER_QUARTER = 4   // flattening resolution for arcs

const fmt = (n) => {
  const v = Math.round(n * 100) / 100
  return Object.is(v, -0) ? '0' : String(v)
}

/**
 * A canvas2d-shaped recorder. Implements exactly the surface the registry's
 * render functions use; anything else they might reach for is a deliberate
 * omission that should fail loudly in tests rather than silently draw nothing.
 */
class PathRecorder {
  constructor() {
    this.parts = []
    this.cx = 0
    this.cy = 0
    this.started = false
  }

  moveTo(x, y) {
    this.parts.push(`M${fmt(x)} ${fmt(y)}`)
    this.cx = x; this.cy = y; this.started = true
  }

  lineTo(x, y) {
    if (!this.started) return this.moveTo(x, y)
    this.parts.push(`L${fmt(x)} ${fmt(y)}`)
    this.cx = x; this.cy = y
  }

  closePath() {
    if (this.started) this.parts.push('Z')
  }

  // Canvas arcTo: an arc of radius r tangent to both the line from the current
  // point to (x1,y1) and the line from (x1,y1) to (x2,y2).
  arcTo(x1, y1, x2, y2, r) {
    const p0 = { x: this.cx, y: this.cy }
    const p1 = { x: x1, y: y1 }
    const p2 = { x: x2, y: y2 }

    const v1 = { x: p0.x - p1.x, y: p0.y - p1.y }
    const v2 = { x: p2.x - p1.x, y: p2.y - p1.y }
    const l1 = Math.hypot(v1.x, v1.y)
    const l2 = Math.hypot(v2.x, v2.y)
    if (!r || l1 === 0 || l2 === 0) return this.lineTo(x1, y1)

    const u1 = { x: v1.x / l1, y: v1.y / l1 }
    const u2 = { x: v2.x / l2, y: v2.y / l2 }
    const cos = Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y))
    const angle = Math.acos(cos)
    // Collinear: no corner to round.
    if (angle < 1e-6 || Math.abs(Math.PI - angle) < 1e-6) return this.lineTo(x1, y1)

    // Distance from the corner to each tangent point, shrunk if either leg is
    // too short — the same clamp the canvas does.
    let tan = r / Math.tan(angle / 2)
    let radius = r
    const maxTan = Math.min(l1, l2)
    if (tan > maxTan) {
      tan = maxTan
      radius = tan * Math.tan(angle / 2)
    }

    const t1 = { x: p1.x + u1.x * tan, y: p1.y + u1.y * tan }
    const t2 = { x: p1.x + u2.x * tan, y: p1.y + u2.y * tan }

    // Centre lies along the bisector, at distance radius / sin(angle/2).
    const bis = { x: u1.x + u2.x, y: u1.y + u2.y }
    const bl = Math.hypot(bis.x, bis.y)
    if (bl === 0) return this.lineTo(x1, y1)
    const dist = radius / Math.sin(angle / 2)
    const c = { x: p1.x + (bis.x / bl) * dist, y: p1.y + (bis.y / bl) * dist }

    this.lineTo(t1.x, t1.y)

    let a0 = Math.atan2(t1.y - c.y, t1.x - c.x)
    let a1 = Math.atan2(t2.y - c.y, t2.x - c.x)
    let sweep = a1 - a0
    // Take the short way round: a corner fillet is never more than half a turn.
    while (sweep > Math.PI) sweep -= 2 * Math.PI
    while (sweep < -Math.PI) sweep += 2 * Math.PI

    this._flattenArc(c, radius, radius, a0, sweep)
  }

  // Canvas ellipse(cx, cy, rx, ry, rotation, start, end, counterclockwise).
  // Only used by the cylinder shape, and only axis-aligned.
  ellipse(cx, cy, rx, ry, rotation, start, end, counterclockwise = false) {
    let sweep = end - start
    if (counterclockwise) {
      while (sweep > 0) sweep -= 2 * Math.PI
      if (sweep < -2 * Math.PI) sweep = -2 * Math.PI
    } else {
      while (sweep < 0) sweep += 2 * Math.PI
      if (sweep > 2 * Math.PI) sweep = 2 * Math.PI
    }
    const first = this._pointOnEllipse({ x: cx, y: cy }, rx, ry, rotation, start)
    // Canvas draws a line from the current point to the arc's start.
    if (this.started) this.lineTo(first.x, first.y)
    else this.moveTo(first.x, first.y)
    this._flattenArc({ x: cx, y: cy }, rx, ry, start, sweep, rotation)
  }

  _pointOnEllipse(c, rx, ry, rotation, angle) {
    const x = rx * Math.cos(angle)
    const y = ry * Math.sin(angle)
    if (!rotation) return { x: c.x + x, y: c.y + y }
    const cosR = Math.cos(rotation), sinR = Math.sin(rotation)
    return { x: c.x + x * cosR - y * sinR, y: c.y + x * sinR + y * cosR }
  }

  _flattenArc(c, rx, ry, start, sweep, rotation = 0) {
    const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 2) * SEGMENTS_PER_QUARTER))
    for (let i = 1; i <= steps; i++) {
      const a = start + (sweep * i) / steps
      const p = this._pointOnEllipse(c, rx, ry, rotation, a)
      this.lineTo(p.x, p.y)
    }
  }

  toPath() {
    return this.parts.join(' ')
  }
}

/**
 * SVG path data for a shape kind normalised to a w×h box at the origin, or null
 * when the kind is drawn by an SVG primitive instead (see shapeElement).
 */
export function shapePath(kind, w, h, radius = 0) {
  const rec = new PathRecorder()
  if (!renderShape(rec, kind, w, h, radius)) return null
  return rec.toPath()
}

// ── SVG construction ─────────────────────────────────────────────────────────
//
// Built with DOM calls, never string concatenation. Shape text is user prose out
// of a note; `textContent` on a real node cannot become markup, which is the
// same guarantee tableRender.js documents for table cells.

const SVG_NS = 'http://www.w3.org/2000/svg'

const el = (name, attrs = {}) => {
  const node = document.createElementNS(SVG_NS, name)
  for (const [k, v] of Object.entries(attrs)) {
    if (v != null) node.setAttribute(k, String(v))
  }
  return node
}

function shapeElement(item) {
  const p = item.payload
  const { w, h } = item
  const common = {
    fill: p.fill || 'none',
    stroke: p.stroke,
    'stroke-width': p.strokeWidth,
    'stroke-linejoin': 'round',
    'stroke-linecap': 'round',
  }

  if (p.kind === 'rect' || p.kind === 'roundedRect') {
    return el('rect', { ...common, x: 0, y: 0, width: w, height: h, rx: p.kind === 'roundedRect' ? Math.max(p.radius || 8, 0) : (p.radius || null) })
  }
  if (p.kind === 'ellipse') {
    return el('ellipse', { ...common, cx: w / 2, cy: h / 2, rx: w / 2, ry: h / 2 })
  }
  if (isLineKind(p.kind)) {
    // A bare line/arrow drawn as a shape (not a connector) is a diagonal of its
    // box — the same thing the Konva fast-path draws.
    return el('line', { ...common, x1: 0, y1: 0, x2: w, y2: h, fill: 'none' })
  }
  const d = shapePath(p.kind, w, h, p.radius)
  if (!d) return null
  return el('path', { ...common, d })
}

// Text inside a shape, centred vertically and wrapped on existing newlines only.
// Word-wrapping would need font metrics we do not have outside a canvas, and a
// wrong guess is worse than a long line the author can break themselves.
function textElement(item) {
  const p = item.payload
  if (!p.text) return null
  const lines = String(p.text).split('\n')
  const size = p.fontSize || 14
  const lineH = size * 1.25
  const anchor = p.textAlign === 'left' ? 'start' : p.textAlign === 'right' ? 'end' : 'middle'
  const x = p.textAlign === 'left' ? 6 : p.textAlign === 'right' ? item.w - 6 : item.w / 2
  const startY = item.h / 2 - ((lines.length - 1) * lineH) / 2

  const text = el('text', {
    x, y: startY,
    fill: p.textColor,
    'font-size': size,
    'text-anchor': anchor,
    'dominant-baseline': 'central',
    'font-family': 'var(--font-body, sans-serif)',
  })
  lines.forEach((line, i) => {
    const tspan = el('tspan', { x, y: startY + i * lineH })
    tspan.textContent = line          // never innerHTML — this is note prose
    text.appendChild(tspan)
  })
  return text
}

function connectorElement(item, byId, markerFor) {
  const pts = connectorPoints(item, byId)
  if (!pts) return null
  const p = item.payload
  const points = []
  for (let i = 0; i < pts.length; i += 2) points.push(`${fmt(pts[i])},${fmt(pts[i + 1])}`)
  return el('polyline', {
    points: points.join(' '),
    fill: 'none',
    stroke: p.stroke,
    'stroke-width': p.strokeWidth,
    'stroke-linejoin': 'round',
    'stroke-linecap': 'round',
    'marker-end': p.head === 'none' ? null : `url(#${markerFor(p.stroke)})`,
  })
}

let markerSeq = 0

/**
 * Build an <svg> element for a diagram. Returns null when there is nothing to
 * draw, so the caller can show a placeholder rather than an empty frame.
 *
 * The viewBox is the content's own bounding box plus padding, and the element
 * is sized in CSS with a max-width — so a diagram scales with the note column
 * instead of forcing it wide.
 */
export function diagramToSvg(items, opts = {}) {
  const { padding = 16, maxHeight = 420, title = 'Diagram' } = opts
  const bounds = diagramBounds(items)
  if (!bounds) return null

  const x = bounds.x - padding
  const y = bounds.y - padding
  const w = bounds.w + padding * 2
  const h = bounds.h + padding * 2

  const svg = el('svg', {
    xmlns: SVG_NS,
    viewBox: `${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)}`,
    role: 'img',
    'aria-label': title,
    preserveAspectRatio: 'xMidYMid meet',
  })
  // Intrinsic size in CSS pixels, capped so a tall diagram cannot push the rest
  // of the note off screen.
  svg.style.width = '100%'
  svg.style.maxWidth = `${Math.ceil(w)}px`
  svg.style.maxHeight = `${maxHeight}px`
  svg.style.height = 'auto'
  svg.style.display = 'block'

  // One marker per stroke colour, made on demand. `fill: context-stroke` would
  // express this in one marker, but it is SVG2 and WebKit ignores it — the
  // arrowheads come out black regardless of the line they end. The seq counter
  // keeps ids unique across several diagrams on one page.
  const defs = el('defs')
  svg.appendChild(defs)
  const markerIds = new Map()
  const markerFor = (stroke) => {
    const colour = stroke || '#e2ddf5'
    const existing = markerIds.get(colour)
    if (existing) return existing
    const id = `siddran-arrow-${++markerSeq}`
    const marker = el('marker', {
      id, viewBox: '0 0 10 10', refX: 9, refY: 5,
      markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse',
    })
    marker.appendChild(el('path', { d: 'M0 0 L10 5 L0 10 z', fill: colour }))
    defs.appendChild(marker)
    markerIds.set(colour, id)
    return id
  }

  const byId = new Map(items.map(it => [it.id, it]))
  const ordered = items.slice().sort((a, b) => (a.z_index ?? 0) - (b.z_index ?? 0))

  // Connectors first, so links sit behind the boxes they join — the same
  // layering the Sandbox uses (ConnectorLayer below GraphicsLayer).
  for (const item of ordered) {
    if (item.type !== 'connector') continue
    const node = connectorElement(item, byId, markerFor)
    if (node) svg.appendChild(node)
  }

  for (const item of ordered) {
    if (item.type !== 'shape') continue
    const group = el('g', {
      transform: item.rotation
        ? `translate(${fmt(item.x)} ${fmt(item.y)}) rotate(${fmt(item.rotation)} ${fmt(item.w / 2)} ${fmt(item.h / 2)})`
        : `translate(${fmt(item.x)} ${fmt(item.y)})`,
    })
    const shape = shapeElement(item)
    if (shape) group.appendChild(shape)
    const text = textElement(item)
    if (text) group.appendChild(text)
    svg.appendChild(group)
  }

  return svg
}

/** The same thing as a string, for the reading view's HTML pipeline. */
export function diagramToSvgString(items, opts) {
  const svg = diagramToSvg(items, opts)
  return svg ? svg.outerHTML : null
}
