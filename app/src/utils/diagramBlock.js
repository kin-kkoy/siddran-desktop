// The on-disk form of a diagram embedded in a note: a fenced block whose info
// string is `siddran-diagram` and whose body is JSON.
//
//     ```siddran-diagram
//     {"v":1,"items":[ … ]}
//     ```
//
// A fence rather than a separate file or a reference to a Sandbox board, so the
// note stays ONE self-contained file — copy, move or back up the `.md` and the
// diagram travels with it, and nothing can be orphaned by deleting a board.
// The editor renders the block as a picture, so the JSON is not normally seen.
//
// Items are stored in the SAME shape the Sandbox uses
// (`{ id, type, x, y, w, h, rotation, z_index, payload }`) rather than a
// prettier private schema. The overlay editor is the real Sandbox canvas, so any
// translation layer would have to be maintained in both directions forever and
// would be one more place for the two to disagree.
//
// Everything here is defensive. A note is a text file the user may hand-edit or
// sync, so a malformed payload has to degrade to "show the raw block" — never
// throw, and never render a half-parsed diagram that silently drops content.

import logger from './logger'

export const DIAGRAM_LANG = 'siddran-diagram'
export const DIAGRAM_VERSION = 1

// Only these item types mean anything in a note diagram. The decision was the
// flowchart subset: shapes, the connectors between them, and the text inside a
// shape. Freehand strokes, images and cards stay a reason to open a real
// Sandbox, and anything else in a payload is dropped rather than half-drawn.
export const DIAGRAM_TYPES = new Set(['shape', 'connector'])

const num = (v, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

// One endpoint of a connector: either bound to an item's side, or a free point.
function normalizeEndpoint(end) {
  if (!end || typeof end !== 'object') return null
  if (end.itemId != null) {
    const side = end.side
    return { itemId: String(end.itemId), side: (side === 'n' || side === 'e' || side === 's' || side === 'w') ? side : 'n' }
  }
  if (end.point && typeof end.point === 'object') {
    return { point: { x: num(end.point.x), y: num(end.point.y) } }
  }
  return null
}

function normalizeItem(raw, index) {
  if (!raw || typeof raw !== 'object') return null
  if (!DIAGRAM_TYPES.has(raw.type)) return null

  // Ids matter: connectors reference shapes by id, so a missing one has to be
  // filled in deterministically rather than randomly, or the same file would
  // parse to different links on different machines.
  const id = raw.id != null ? String(raw.id) : `d${index}`

  const base = {
    id,
    type: raw.type,
    x: num(raw.x),
    y: num(raw.y),
    w: Math.max(1, num(raw.w, 1)),
    h: Math.max(1, num(raw.h, 1)),
    rotation: num(raw.rotation),
    z_index: num(raw.z_index, index),
  }

  const p = raw.payload && typeof raw.payload === 'object' ? raw.payload : {}

  if (raw.type === 'connector') {
    const from = normalizeEndpoint(p.from)
    const to = normalizeEndpoint(p.to)
    // A connector with an unresolvable end is not a connector.
    if (!from || !to) return null
    return {
      ...base,
      payload: {
        from,
        to,
        routing: p.routing === 'straight' ? 'straight' : 'elbow',
        stroke: typeof p.stroke === 'string' ? p.stroke : '#e2ddf5',
        strokeWidth: Math.max(1, num(p.strokeWidth, 2)),
        head: p.head === 'none' ? 'none' : 'arrow',
      },
    }
  }

  // shape
  return {
    ...base,
    payload: {
      kind: typeof p.kind === 'string' ? p.kind : 'rect',
      fill: typeof p.fill === 'string' ? p.fill : 'transparent',
      stroke: typeof p.stroke === 'string' ? p.stroke : '#e2ddf5',
      strokeWidth: Math.max(0, num(p.strokeWidth, 2)),
      radius: Math.max(0, num(p.radius)),
      // Text is the one field that carries user prose. It is never interpolated
      // into markup anywhere — see diagramSvg.js, which sets it with DOM text
      // nodes — but it is still normalised to a string here so nothing
      // downstream has to guess.
      text: p.text == null ? '' : String(p.text),
      textAlign: p.textAlign === 'left' || p.textAlign === 'right' ? p.textAlign : 'center',
      textColor: typeof p.textColor === 'string' ? p.textColor : '#ffffff',
      fontSize: Math.max(1, num(p.fontSize, 14)),
    },
  }
}

/**
 * Parse a fence body. Returns { v, items } or null when the payload is not a
 * usable diagram — the caller shows the raw block in that case rather than an
 * empty box, the same way tableRender.js does for a malformed table.
 */
export function parseDiagram(source) {
  const text = String(source ?? '').trim()
  if (!text) return { v: DIAGRAM_VERSION, items: [] }   // an empty block is a new, blank diagram
  let raw
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) return null

  const items = []
  for (let i = 0; i < raw.items.length; i++) {
    const item = normalizeItem(raw.items[i], i)
    if (item) items.push(item)
  }

  // Drop connectors whose endpoints point at shapes that are not in this block.
  // Sandbox drops them per-frame (connectorPoints returns null); here the file is
  // the source of truth, so a dangling link is dead weight in every future read.
  const ids = new Set(items.filter(it => it.type === 'shape').map(it => it.id))
  const kept = items.filter(it => {
    if (it.type !== 'connector') return true
    const { from, to } = it.payload
    if (from.itemId != null && !ids.has(from.itemId)) return false
    if (to.itemId != null && !ids.has(to.itemId)) return false
    return true
  })

  return { v: num(raw.v, DIAGRAM_VERSION), items: kept }
}

/**
 * Serialize back to the fence body. Stable key order so re-saving a diagram that
 * did not change produces a byte-identical block — otherwise every open would
 * dirty the note and the 1.5 s autosave would rewrite the file for nothing.
 */
export function serializeDiagram(doc) {
  const items = (doc?.items || []).map(it => ({
    id: it.id,
    type: it.type,
    x: round(it.x),
    y: round(it.y),
    w: round(it.w),
    h: round(it.h),
    ...(it.rotation ? { rotation: round(it.rotation) } : {}),
    z_index: it.z_index,
    payload: it.payload,
  }))
  return JSON.stringify({ v: DIAGRAM_VERSION, items })
}

// Sub-pixel coordinates are noise in a file a human might read, and they make
// otherwise-identical saves differ. Two decimals is far finer than anything
// visible at note scale.
function round(n) {
  const v = num(n)
  return Math.round(v * 100) / 100
}

/** Wrap a serialized body in its fence, ready to splice into a note. */
export function diagramFence(doc) {
  return '```' + DIAGRAM_LANG + '\n' + serializeDiagram(doc) + '\n```'
}

/** An empty diagram, for "insert a diagram here". */
export function emptyDiagram() {
  return { v: DIAGRAM_VERSION, items: [] }
}

/**
 * World-space bounding box of a diagram's shapes, or null when it has none.
 * Connectors are not included: their geometry is derived from the shapes they
 * join, so they can never extend past them by more than the arrowhead.
 */
export function diagramBounds(items) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const it of items || []) {
    if (it.type !== 'shape') continue
    if (it.x < minX) minX = it.x
    if (it.y < minY) minY = it.y
    if (it.x + it.w > maxX) maxX = it.x + it.w
    if (it.y + it.h > maxY) maxY = it.y + it.h
  }
  if (!Number.isFinite(minX)) return null
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/** Log a payload we could not use, once, without breaking the render. */
export function reportBadDiagram(source, err) {
  logger.warn('Unreadable siddran-diagram block; showing source', { length: String(source ?? '').length, err })
}
