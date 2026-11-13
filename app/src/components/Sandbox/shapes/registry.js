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

/**
 * A cylinder / database drum.
 *
 * Canvas angles run clockwise on a y-DOWN axis, so PI/2 is the point BELOW the
 * centre and 3*PI/2 the point above it. The two halves of the top rim are
 * therefore easy to swap, and swapping them is what makes a cylinder look
 * chopped flat: the silhouette then follows the rim's near edge, which dips
 * INTO the body, instead of its far edge, which arches over the top.
 *
 * So: the outline goes over the top of the rim (PI → 2*PI, through 3*PI/2), down
 * the right side, under the base (0 → PI, through PI/2), and closePath brings
 * the left side back up. The rim's near edge is then drawn as its own subpath so
 * the top reads as an opening rather than a dome.
 */
function renderCylinder(ctx, w, h) {
    const ry = Math.min(h * 0.15, 24)
    // Outline: over the top of the rim…
    ctx.moveTo(0, ry)
    ctx.ellipse(w / 2, ry, w / 2, ry, 0, Math.PI, Math.PI * 2, false)
    // …down the right side…
    ctx.lineTo(w, h - ry)
    // …and under the base. closePath returns up the left side.
    ctx.ellipse(w / 2, h - ry, w / 2, ry, 0, 0, Math.PI, false)
    ctx.closePath()
    // The near edge of the rim, closing the ellipse you see at the top.
    ctx.moveTo(w, ry)
    ctx.ellipse(w / 2, ry, w / 2, ry, 0, 0, Math.PI, false)
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


// ── packs added for the whiteboard upgrade ─────────────────────────────────
// Every one uses only moveTo / lineTo / arcTo / ellipse / bezierCurveTo /
// quadraticCurveTo / closePath — the surface diagramSvg's PathRecorder replays
// into an SVG path, so these shapes show up in note diagrams too.

function rrect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2))
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + w - r, y)
    ctx.arcTo(x + w, y, x + w, y + r, r)
    ctx.lineTo(x + w, y + h - r)
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
    ctx.lineTo(x + r, y + h)
    ctx.arcTo(x, y + h, x, y + h - r, r)
    ctx.lineTo(x, y + r)
    ctx.arcTo(x, y, x + r, y, r)
    ctx.closePath()
}

function renderCircle(ctx, w, h) {
    const r = Math.min(w, h) / 2
    ctx.moveTo(w / 2 + r, h / 2)
    ctx.ellipse(w / 2, h / 2, r, r, 0, 0, Math.PI * 2, false)
    ctx.closePath()
}

function renderTrapezoid(ctx, w, h, radius) {
    const inset = w * 0.2
    polyPath(ctx, [inset, 0, w - inset, 0, w, h, 0, h], radius)
}

function renderOctagon(ctx, w, h, radius) {
    const ix = w * 0.29, iy = h * 0.29
    polyPath(ctx, [ix, 0, w - ix, 0, w, iy, w, h - iy, w - ix, h, ix, h, 0, h - iy, 0, iy], radius)
}

function renderDoubleArrow(ctx, w, h, radius) {
    const head = Math.min(w * 0.3, h * 0.5)
    const sy = h * 0.25
    polyPath(ctx, [
        0, h / 2, head, 0, head, sy, w - head, sy, w - head, 0, w, h / 2,
        w - head, h, w - head, h - sy, head, h - sy, head, h,
    ], radius)
}

function renderCross(ctx, w, h, radius) {
    const ax = w / 3, ay = h / 3
    polyPath(ctx, [ax, 0, w - ax, 0, w - ax, ay, w, ay, w, h - ay, w - ax, h - ay, w - ax, h, ax, h, ax, h - ay, 0, h - ay, 0, ay, ax, ay], radius)
}

function renderCloud(ctx, w, h) {
    // Five lobes round a flat-ish base, as cubic curves in a 100×60 design box.
    const X = (v) => (v / 100) * w, Y = (v) => (v / 60) * h
    ctx.moveTo(X(22), Y(54))
    ctx.bezierCurveTo(X(4), Y(54), X(2), Y(34), X(16), Y(30))
    ctx.bezierCurveTo(X(12), Y(14), X(32), Y(6), X(42), Y(16))
    ctx.bezierCurveTo(X(48), Y(2), X(72), Y(2), X(74), Y(18))
    ctx.bezierCurveTo(X(92), Y(14), X(102), Y(34), X(88), Y(42))
    ctx.bezierCurveTo(X(96), Y(54), X(82), Y(60), X(74), Y(54))
    ctx.closePath()
}

/** A page with a wavy bottom edge (flowchart "document"). */
function renderDocument(ctx, w, h) {
    const wave = h * 0.12
    ctx.moveTo(0, 0)
    ctx.lineTo(w, 0)
    ctx.lineTo(w, h - wave)
    ctx.bezierCurveTo(w * 0.75, h - wave * 2.6, w * 0.5, h + wave * 0.6, w * 0.25, h - wave * 0.4)
    ctx.quadraticCurveTo(w * 0.1, h - wave * 1.2, 0, h - wave)
    ctx.closePath()
}

function renderMultiDocument(ctx, w, h) {
    const o = Math.min(w, h) * 0.08
    // The two sheets behind are L-shaped strips (only their visible top/right
    // edges), so neither fill nor stroke crosses the front page.
    const strip = (k) => {
        const x0 = o * k, y0 = o * (2 - k), fw = w - o * 2
        ctx.moveTo(x0, y0 + o)
        ctx.lineTo(x0, y0)
        ctx.lineTo(x0 + fw, y0)
        ctx.lineTo(x0 + fw, h - o * (2 + k))
        ctx.lineTo(x0 + fw - o, h - o * (2 + k))
        ctx.lineTo(x0 + fw - o, y0 + o)
        ctx.closePath()
    }
    strip(2)
    strip(1)
    renderDocumentAt(ctx, 0, o * 2, w - o * 2, h - o * 2)
}
function renderDocumentAt(ctx, x, y, w, h) {
    const wave = h * 0.12
    ctx.moveTo(x, y)
    ctx.lineTo(x + w, y)
    ctx.lineTo(x + w, y + h - wave)
    ctx.bezierCurveTo(x + w * 0.75, y + h - wave * 2.6, x + w * 0.5, y + h + wave * 0.6, x + w * 0.25, y + h - wave * 0.4)
    ctx.quadraticCurveTo(x + w * 0.1, y + h - wave * 1.2, x, y + h - wave)
    ctx.closePath()
}

/** Stadium / pill — flowchart start & end. */
function renderTerminator(ctx, w, h) {
    rrect(ctx, 0, 0, w, h, Math.min(w, h) / 2)
}

function renderManualInput(ctx, w, h, radius) {
    polyPath(ctx, [0, h * 0.3, w, 0, w, h, 0, h], radius)
}

function renderPreparation(ctx, w, h, radius) {
    const i = Math.min(w * 0.18, h * 0.5)
    polyPath(ctx, [i, 0, w - i, 0, w, h / 2, w - i, h, i, h, 0, h / 2], radius)
}

/** D-shape: flat left, half-round right. */
function renderDelay(ctx, w, h) {
    const r = Math.min(h / 2, w / 2)
    ctx.moveTo(0, 0)
    ctx.lineTo(w - r, 0)
    ctx.arcTo(w, 0, w, h / 2, r)
    ctx.arcTo(w, h, w - r, h, r)
    ctx.lineTo(0, h)
    ctx.closePath()
}

function renderDisplay(ctx, w, h) {
    const i = w * 0.16
    ctx.moveTo(0, h / 2)
    ctx.lineTo(i, 0)
    ctx.lineTo(w - i, 0)
    ctx.quadraticCurveTo(w + i * 0.4, h / 2, w - i, h)
    ctx.lineTo(i, h)
    ctx.closePath()
}

function renderOffPage(ctx, w, h, radius) {
    polyPath(ctx, [0, 0, w, 0, w, h * 0.65, w / 2, h, 0, h * 0.65], radius)
}

/** Process box with double side bars (subroutine). */
function renderPredefined(ctx, w, h) {
    const i = Math.min(w * 0.1, 18)
    ctx.moveTo(0, 0); ctx.lineTo(w, 0); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath()
    ctx.moveTo(i, 0); ctx.lineTo(i, h)
    ctx.moveTo(w - i, 0); ctx.lineTo(w - i, h)
}

/** Stored data: curved left and right edges. */
function renderStoredData(ctx, w, h) {
    const c = w * 0.14
    ctx.moveTo(c, 0)
    ctx.lineTo(w, 0)
    ctx.quadraticCurveTo(w - c * 2, h / 2, w, h)
    ctx.lineTo(c, h)
    ctx.quadraticCurveTo(-c, h / 2, c, 0)
    ctx.closePath()
}

function renderManualOperation(ctx, w, h, radius) {
    const i = w * 0.18
    polyPath(ctx, [0, 0, w, 0, w - i, h, i, h], radius)
}

function renderMerge(ctx, w, h, radius) {
    polyPath(ctx, [0, 0, w, 0, w / 2, h], radius)
}

/** Punched card: a rectangle with the top-left corner cut. */
function renderCard(ctx, w, h, radius) {
    const c = Math.min(w, h) * 0.25
    polyPath(ctx, [c, 0, w, 0, w, h, 0, h, 0, c], radius)
}

function renderThoughtBubble(ctx, w, h) {
    const bh = h * 0.78
    ctx.moveTo(w / 2 + w / 2, bh / 2)
    ctx.ellipse(w / 2, bh / 2, w / 2, bh / 2, 0, 0, Math.PI * 2, false)
    ctx.closePath()
    const r1 = Math.min(w, h) * 0.07, r2 = r1 * 0.6
    ctx.moveTo(w * 0.28 + r1, bh + r1 * 0.6)
    ctx.ellipse(w * 0.28, bh + r1 * 0.6, r1, r1, 0, 0, Math.PI * 2, false)
    ctx.closePath()
    ctx.moveTo(w * 0.18 + r2, h - r2)
    ctx.ellipse(w * 0.18, h - r2, r2, r2, 0, 0, Math.PI * 2, false)
    ctx.closePath()
}

/** Rounded callout with a tail at the bottom-left. */
function renderRoundedCallout(ctx, w, h) {
    const tail = Math.min(h * 0.22, 26)
    const bh = h - tail
    const r = Math.min(bh / 2.2, w / 5, 22)
    ctx.moveTo(r, 0)
    ctx.lineTo(w - r, 0)
    ctx.arcTo(w, 0, w, r, r)
    ctx.lineTo(w, bh - r)
    ctx.arcTo(w, bh, w - r, bh, r)
    ctx.lineTo(w * 0.32, bh)
    ctx.lineTo(w * 0.12, h)
    ctx.lineTo(w * 0.18, bh)
    ctx.lineTo(r, bh)
    ctx.arcTo(0, bh, 0, bh - r, r)
    ctx.lineTo(0, r)
    ctx.arcTo(0, 0, r, 0, r)
    ctx.closePath()
}

/** Ribbon banner with notched ends. */
function renderBanner(ctx, w, h, radius) {
    const n = Math.min(w * 0.08, h * 0.4)
    polyPath(ctx, [0, 0, w, 0, w - n, h / 2, w, h, 0, h, n, h / 2], radius)
}

/** Luggage tag / label pointing left. */
function renderTag(ctx, w, h, radius) {
    const p = Math.min(w * 0.2, h * 0.5)
    polyPath(ctx, [p, 0, w, 0, w, h, p, h, 0, h / 2], radius)
}

/** Sticky note: a near-square with a 2 px corner (spec §7.3). */
function renderSticky(ctx, w, h) {
    rrect(ctx, 0, 0, w, h, 2)
}

// ── shape registry ───────────────────────────────────────────────────────────

export const SHAPES = {
    // basic
    rect:          { label: 'Rectangle',     key: 'r',  group: 'basic', ratio: null, isLine: false, render: null },
    roundedRect:   { label: 'Rounded rect',  key: null, group: 'basic', ratio: null, isLine: false, render: null },
    ellipse:       { label: 'Ellipse',       key: 'o',  group: 'basic', ratio: null, isLine: false, render: null },
    circle:        { label: 'Circle',        key: null, group: 'basic', ratio: 1,    isLine: false, render: renderCircle },
    triangle:      { label: 'Triangle',      key: null, group: 'basic', ratio: null, isLine: false, render: renderTriangle },
    rhombus:       { label: 'Diamond',       key: null, group: 'basic', ratio: null, isLine: false, render: renderRhombus },
    parallelogram: { label: 'Parallelogram', key: null, group: 'basic', ratio: null, isLine: false, render: renderParallelogram },
    trapezoid:     { label: 'Trapezoid',     key: null, group: 'basic', ratio: null, isLine: false, render: renderTrapezoid },
    pentagon:      { label: 'Pentagon',      key: null, group: 'basic', ratio: null, isLine: false, render: renderPentagon },
    hexagon:       { label: 'Hexagon',       key: null, group: 'basic', ratio: null, isLine: false, render: renderHexagon },
    octagon:       { label: 'Octagon',       key: null, group: 'basic', ratio: 1,    isLine: false, render: renderOctagon },
    star:          { label: 'Star',          key: null, group: 'basic', ratio: 1,    isLine: false, render: renderStar },
    blockArrow:    { label: 'Block arrow',   key: null, group: 'basic', ratio: null, isLine: false, render: renderBlockArrow },
    doubleArrow:   { label: 'Double arrow',  key: null, group: 'basic', ratio: null, isLine: false, render: renderDoubleArrow },
    cross:         { label: 'Cross',         key: null, group: 'basic', ratio: 1,    isLine: false, render: renderCross },
    cloud:         { label: 'Cloud',         key: null, group: 'basic', ratio: null, isLine: false, render: renderCloud },
    cylinder:      { label: 'Cylinder',      key: null, group: 'basic', ratio: 0.6,  isLine: false, render: renderCylinder },
    document:      { label: 'Document',      key: null, group: 'basic', ratio: null, isLine: false, render: renderDocument },
    // flowchart (process / decision / data are rect / rhombus / parallelogram)
    terminator:        { label: 'Start / end',       key: null, group: 'flowchart', ratio: null, isLine: false, render: renderTerminator },
    predefinedProcess: { label: 'Subroutine',        key: null, group: 'flowchart', ratio: null, isLine: false, render: renderPredefined },
    manualInput:       { label: 'Manual input',      key: null, group: 'flowchart', ratio: null, isLine: false, render: renderManualInput },
    manualOperation:   { label: 'Manual operation',  key: null, group: 'flowchart', ratio: null, isLine: false, render: renderManualOperation },
    preparation:       { label: 'Preparation',       key: null, group: 'flowchart', ratio: null, isLine: false, render: renderPreparation },
    delay:             { label: 'Delay',             key: null, group: 'flowchart', ratio: null, isLine: false, render: renderDelay },
    display:           { label: 'Display',           key: null, group: 'flowchart', ratio: null, isLine: false, render: renderDisplay },
    storedData:        { label: 'Stored data',       key: null, group: 'flowchart', ratio: null, isLine: false, render: renderStoredData },
    multiDocument:     { label: 'Documents',         key: null, group: 'flowchart', ratio: null, isLine: false, render: renderMultiDocument },
    offPageConnector:  { label: 'Off-page link',     key: null, group: 'flowchart', ratio: 1,    isLine: false, render: renderOffPage },
    merge:             { label: 'Merge',             key: null, group: 'flowchart', ratio: null, isLine: false, render: renderMerge },
    card:              { label: 'Card',              key: null, group: 'flowchart', ratio: null, isLine: false, render: renderCard },
    // callouts
    speechBubble:   { label: 'Speech bubble',   key: null, group: 'callout', ratio: null, isLine: false, render: renderSpeechBubble },
    roundedCallout: { label: 'Rounded callout', key: null, group: 'callout', ratio: null, isLine: false, render: renderRoundedCallout },
    thoughtBubble:  { label: 'Thought bubble',  key: null, group: 'callout', ratio: null, isLine: false, render: renderThoughtBubble },
    banner:         { label: 'Banner',          key: null, group: 'callout', ratio: null, isLine: false, render: renderBanner },
    tag:            { label: 'Tag',             key: null, group: 'callout', ratio: null, isLine: false, render: renderTag },
    // sticky note — a shape so it gets text editing, connectors and undo for free
    sticky:         { label: 'Sticky note',     key: 'n',  group: 'sticky',  ratio: 1,    isLine: false, render: renderSticky },
    // frame — drawn by FrameLayer, beneath everything; no outline path of its own
    frame:          { label: 'Frame',           key: 'f',  group: 'frame',   ratio: null, isLine: false, render: null },
    // lines
    line:          { label: 'Line',          key: 'l',  group: 'line',  ratio: null, isLine: true,  render: null },
    arrow:         { label: 'Arrow',         key: 'a',  group: 'line',  ratio: null, isLine: true,  render: null },
    elbowArrow:    { label: 'Elbow arrow',   key: null, group: 'line',  ratio: null, isLine: true,  render: null },
    divider:       { label: 'Divider',       key: null, group: 'line',  ratio: null, isLine: true,  render: null },
    taperedArrow:  { label: 'Tapered arrow', key: null, group: 'line',  ratio: null, isLine: true,  render: null },
}

/** Picker sections, in display order. */
export const SHAPE_GROUPS = [
    { id: 'basic', label: 'Basic' },
    { id: 'flowchart', label: 'Flowchart' },
    { id: 'callout', label: 'Callouts' },
    { id: 'line', label: 'Lines' },
]
export const shapesInGroup = (group) => Object.keys(SHAPES).filter(k => SHAPES[k].group === group)

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
export const ALL_SHAPES = Object.keys(SHAPES).filter(k => SHAPES[k].group !== 'sticky' && SHAPES[k].group !== 'frame')
