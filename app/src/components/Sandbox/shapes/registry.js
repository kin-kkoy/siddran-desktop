/**
 * Shape registry — the single source of truth for every shape kind the Sandbox
 * supports. Each entry describes how to render a shape normalised to a (w × h)
 * bounding box.  Line-type shapes (`isLine: true`) keep their Konva-primitive
 * fast-paths (Arrow / Line) and don't use `render`; filled shapes draw a closed
 * canvas2d path via `<Shape sceneFunc>`.
 *
 * Exported helpers:
 *   SHAPE_TOOLS  — all tool-selectable kinds (derived from keys)
 *   SHAPE_KEYS   — { keyChar: kind } map for keyboard shortcuts
 *   isLineKind   — true when the kind is a line-type shape
 *   renderShape  — calls the registry render fn for a given kind
 */

// ── helpers ──────────────────────────────────────────────────────────────────

/** Draw a polygon from a flat [x,y,...] array, optionally rounding corners. */
function polyPath(ctx, pts, radius) {
    const n = pts.length / 2
    if (n < 2) return
    if (!radius || radius <= 0) {
        ctx.moveTo(pts[0], pts[1])
        for (let i = 1; i < n; i++) ctx.lineTo(pts[i * 2], pts[i * 2 + 1])
        ctx.closePath()
        return
    }
    // Rounded: walk each corner with arcTo.
    for (let i = 0; i < n; i++) {
        const ax = pts[((i - 1 + n) % n) * 2],     ay = pts[((i - 1 + n) % n) * 2 + 1]
        const bx = pts[i * 2],                       by = pts[i * 2 + 1]
        const cx = pts[((i + 1) % n) * 2],           cy = pts[((i + 1) % n) * 2 + 1]
        if (i === 0) {
            const mx = (ax + bx) / 2, my = (ay + by) / 2
            ctx.moveTo(mx, my)
        }
        ctx.arcTo(bx, by, cx, cy, radius)
    }
    ctx.closePath()
}

/** Regular n-gon inscribed in an ellipse (w × h), rotated so a vertex points up. */
function regularPolygon(ctx, w, h, n, radius) {
    const pts = []
    const cx = w / 2, cy = h / 2
    const rx = w / 2, ry = h / 2
    const offset = -Math.PI / 2 // vertex at top
    for (let i = 0; i < n; i++) {
        const a = offset + (2 * Math.PI * i) / n
        pts.push(cx + rx * Math.cos(a), cy + ry * Math.sin(a))
    }
    polyPath(ctx, pts, radius)
}

// ── render functions (ctx, w, h, radius) ─────────────────────────────────────
// Each draws a closed path at origin (0,0) sized to (w,h).  The caller wraps
// it in beginPath / fillStrokeShape.

function renderTriangle(ctx, w, h, radius) {
    polyPath(ctx, [w / 2, 0, w, h, 0, h], radius)
}

function renderRhombus(ctx, w, h, radius) {
    polyPath(ctx, [w / 2, 0, w, h / 2, w / 2, h, 0, h / 2], radius)
}

function renderPentagon(ctx, w, h, radius) {
    regularPolygon(ctx, w, h, 5, radius)
}

function renderHexagon(ctx, w, h, radius) {
    regularPolygon(ctx, w, h, 6, radius)
}

function renderStar(ctx, w, h, radius) {
    const cx = w / 2, cy = h / 2
    const outer = Math.min(w, h) / 2
    const inner = outer * 0.38
    const pts = []
    const offset = -Math.PI / 2
    for (let i = 0; i < 10; i++) {
        const a = offset + (Math.PI * i) / 5
        const r = i % 2 === 0 ? outer : inner
        // Scale to fill the bounding box (star is square; stretch into w×h)
        pts.push(cx + r * Math.cos(a) * (w / Math.min(w, h)),
                 cy + r * Math.sin(a) * (h / Math.min(w, h)))
    }
    polyPath(ctx, pts, radius)
}

function renderSpeechBubble(ctx, w, h) {
    const tailH = Math.min(h * 0.18, 20)
    const bodyH = h - tailH
    const r = Math.min(12, bodyH / 4, w / 4)
    // Rounded-rect body
    ctx.moveTo(r, 0)
    ctx.lineTo(w - r, 0)
    ctx.arcTo(w, 0, w, r, r)
    ctx.lineTo(w, bodyH - r)
    ctx.arcTo(w, bodyH, w - r, bodyH, r)
    // Bottom edge with tail
    ctx.lineTo(w * 0.35, bodyH)
    ctx.lineTo(w * 0.18, h)
    ctx.lineTo(w * 0.22, bodyH)
    ctx.lineTo(r, bodyH)
    ctx.arcTo(0, bodyH, 0, bodyH - r, r)
    ctx.lineTo(0, r)
    ctx.arcTo(0, 0, r, 0, r)
    ctx.closePath()
}

function renderCylinder(ctx, w, h) {
    const ry = Math.min(h * 0.15, 24)
    // Top ellipse
    ctx.moveTo(0, ry)
    ctx.ellipse(w / 2, ry, w / 2, ry, 0, Math.PI, 0, true)
    // Right side
    ctx.lineTo(w, h - ry)
    // Bottom ellipse
    ctx.ellipse(w / 2, h - ry, w / 2, ry, 0, 0, Math.PI, false)
    // Left side
    ctx.closePath()
    // Top cap (visible ellipse)
    ctx.moveTo(0, ry)
    ctx.ellipse(w / 2, ry, w / 2, ry, 0, Math.PI, Math.PI * 2, true)
}

function renderParallelogram(ctx, w, h, radius) {
    const inset = w * 0.2
    polyPath(ctx, [inset, 0, w, 0, w - inset, h, 0, h], radius)
}

function renderBlockArrow(ctx, w, h, radius) {
    const headW = Math.min(w * 0.4, h * 0.5)
    const shaftY = h * 0.25
    polyPath(ctx, [
        0, shaftY,
        w - headW, shaftY,
        w - headW, 0,
        w, h / 2,
        w - headW, h,
        w - headW, h - shaftY,
        0, h - shaftY,
    ], radius)
}

// ── shape registry ───────────────────────────────────────────────────────────

export const SHAPES = {
    rect:          { label: 'Rectangle',     key: 'r',  group: 'basic', ratio: null, isLine: false, render: null },
    roundedRect:   { label: 'Rounded rect',  key: null, group: 'basic', ratio: null, isLine: false, render: null },
    ellipse:       { label: 'Ellipse',       key: 'o',  group: 'basic', ratio: null, isLine: false, render: null },
    triangle:      { label: 'Triangle',      key: null, group: 'basic', ratio: null, isLine: false, render: renderTriangle },
    rhombus:       { label: 'Diamond',       key: null, group: 'basic', ratio: null, isLine: false, render: renderRhombus },
    pentagon:      { label: 'Pentagon',       key: null, group: 'basic', ratio: null, isLine: false, render: renderPentagon },
    hexagon:       { label: 'Hexagon',       key: null, group: 'basic', ratio: null, isLine: false, render: renderHexagon },
    star:          { label: 'Star',          key: null, group: 'basic', ratio: 1,    isLine: false, render: renderStar },
    speechBubble:  { label: 'Speech bubble', key: null, group: 'basic', ratio: null, isLine: false, render: renderSpeechBubble },
    cylinder:      { label: 'Cylinder',      key: null, group: 'basic', ratio: 0.6,  isLine: false, render: renderCylinder },
    parallelogram: { label: 'Parallelogram', key: null, group: 'basic', ratio: null, isLine: false, render: renderParallelogram },
    line:          { label: 'Line',          key: 'l',  group: 'line',  ratio: null, isLine: true,  render: null },
    arrow:         { label: 'Arrow',         key: 'a',  group: 'line',  ratio: null, isLine: true,  render: null },
    elbowArrow:    { label: 'Elbow arrow',   key: null, group: 'line',  ratio: null, isLine: true,  render: null },
    blockArrow:    { label: 'Block arrow',   key: null, group: 'basic', ratio: null, isLine: false, render: renderBlockArrow },
    divider:       { label: 'Divider',       key: null, group: 'line',  ratio: null, isLine: true,  render: null },
}

// ── derived exports ──────────────────────────────────────────────────────────

/** All tool-selectable shape kinds. */
export const SHAPE_TOOLS = Object.keys(SHAPES)

/**
 * Keyboard shortcut map: { char → kind }. Only shapes that have a `key`.
 * NOTE: per-shape keys are no longer wired to tool-switching — the shape picker
 * opens with `S` and shapes are chosen by click. This export is kept for
 * compatibility; the `key` fields are now effectively decorative.
 */
export const SHAPE_KEYS = Object.fromEntries(
    Object.entries(SHAPES).filter(([, s]) => s.key).map(([kind, s]) => [s.key, kind])
)

/** True when the kind is a line-type shape (rendered via Konva <Line>/<Arrow>). */
export function isLineKind(kind) {
    return SHAPES[kind]?.isLine ?? false
}

/**
 * Call the registry render function for a shape kind.
 * Returns false if the kind has no render fn (it uses a Konva fast-path).
 */
export function renderShape(ctx, kind, w, h, radius) {
    const fn = SHAPES[kind]?.render
    if (!fn) return false
    fn(ctx, w, h, radius || 0)
    return true
}

/**
 * Quick-access shapes shown in the first level of the picker flyout.
 * Order matters — this is the visual order in the menu.
 */
export const QUICK_SHAPES = ['rect', 'ellipse', 'line', 'arrow']

/**
 * All shapes shown in the "More shapes" grid, in display order.
 */
export const ALL_SHAPES = Object.keys(SHAPES)
