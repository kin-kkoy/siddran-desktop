import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Stage } from 'react-konva'
import GraphicsLayer from './GraphicsLayer'
import ConnectorLayer from './ConnectorLayer'
import FrameLayer from './FrameLayer'
import ActiveLayer from './ActiveLayer'
import OverlayLayer from './OverlayLayer'
import { strokeOutline } from './strokeOutline'
import { SHAPE_TOOLS } from '../../../hooks/useSandboxCanvas'
import { isLineKind } from '../shapes/registry'
import { itemHitTest, marqueeIntersects, normalizeRect, itemAABB, pointInPolygon } from '../selection/hitTest'
import { connectorPoints, connectorHitTest } from '../connectors/geometry'
import { isFrame, frameHit, marqueeTakesFrame } from '../frames/frames'
import { isFormat } from '../formats/formats'
import { resolveHover } from '../selection/hover'
import { DRAWS_INK, presetGroupFor, strokeStyleFor } from '../ink/presets'

const GRID_MINOR = 24
// A shape that can take connector arrows (not a frame, a line, or a locked item).
const isConnectable = (it) => it?.type === 'shape' && !isFrame(it) && !isFormat(it) && !isLineKind(it.payload?.kind) && !it.payload?.locked
const GRID_MAJOR = 120
const GRAPHIC_TYPES = new Set(['stroke', 'shape', 'image'])

/**
 * The Sandbox canvas. Owns the Konva <Stage> (pan/zoom from viewport), native
 * Pointer Events (bound once, reading latest state via latestRef), and the tool
 * gesture branching:
 *   hand/space → pan · pen → stroke · rect/ellipse/line/arrow → shape ·
 *   eraser → hit-test delete · text → place a text box · pointer → click-select
 *   a graphic or drag a marquee.
 *
 * Cards (DOM) handle their own select/move/erase and stop propagation, so the
 * canvas pointer hit-test only covers Konva graphics. The transform overlay's
 * handles carry data-sb-handle and are likewise ignored here.
 */
// Cap the canvas render resolution. On scaled/HiDPI displays (Windows 125–150%,
// Retina 2×) the committed-graphics fill cost scales with pixelRatio² — capping
// trades a little crispness for a big paint reduction on weak hardware. ≤ this
// value it's a no-op. Lower toward 1 if panning a dense board still lags.
const MAX_PIXEL_RATIO = 1.5

const CULL_THRESHOLD = 120   // only viewport-cull graphics past this count
const CULL_MARGIN = 200      // world px kept beyond the viewport so nothing pops
const CULL_BUCKET = 200      // snap the cull rect to this grid so panning a little doesn't re-render
// Precision eraser radius in SCREEN px (spec §10.1: 8 px) — constant at any zoom.
export const PRECISION_ERASER_PX = 8
// While one of these is active, cards (text boxes, notes, tasks, PDFs) can't be
// grabbed or selected: the press goes through to the board, so you can draw,
// highlight, lasso or paint right over them. The plain eraser still deletes cards.
// The paint bucket's cursor: a white bucket on a dark outline (visible on any
// background), hotspot at the pouring lip, bottom-left.
const BUCKET_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linejoin="round" stroke-linecap="round">'
    + '<g stroke="#000" stroke-width="4"><path d="M12 3l8 8-7 7-8-8z"/><path d="M5 10c-2 3-3 7-1 10"/></g>'
    + '<g stroke="#fff" stroke-width="1.8"><path d="M12 3l8 8-7 7-8-8z"/><path d="M5 10c-2 3-3 7-1 10"/></g></svg>'
const BUCKET_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(BUCKET_SVG)}") 4 20, crosshair`
const CARD_PASS_THROUGH = new Set(['pen', 'highlighter', 'smart', 'precisionEraser', 'lasso', 'fill'])
// Shape, sticky and text tools pass through too, so you can draw them ON a
// card or widget (what lands on a widget attaches to it and is drawn on the
// top canvas). The frame tool doesn't: frames never go on widgets.
const passesCards = (tool) => CARD_PASS_THROUGH.has(tool) || tool === 'text' || (SHAPE_TOOLS.includes(tool) && tool !== 'frame')

function SandboxCanvas({
    canvas,
    items,                 // ALL items — for pointer/eraser/marquee hit-testing
    graphicItems,          // strokes + shapes + images, z-sorted (one Konva layer)
    connectorItems,        // connector items, z-sorted (own layer below shapes)
    frameItems = [],       // frames, z-sorted (own layer below connectors)
    editingFrameId,        // frame whose title is being edited → hide its painted title
    stageRef,              // forwarded to <Stage> so the page can export a PNG
    onStrokeCommit,
    onShapeCommit,
    onSelect,              // (id|null, additive)
    onMarqueeSelect,       // (ids[], additive)
    onErase,               // (id)
    onPrecisionErase,      // (worldCenter, worldRadius) — cut ink under the precision eraser
    onPrecisionEraseEnd,   // () — that gesture is over
    onSmartStroke,         // (strokePartial) — a smart-drawing stroke, to recognise
    onPaint,               // (itemId) — the paint bucket clicked this item
    onPlaceText,           // (worldPoint)
    onImageDrop,           // (file, worldPoint)
    onShapeDoubleClick,    // (itemId) — double-click a shape to edit text
    onEmptyDoubleClick,    // (world) — double-click empty canvas to make a box there
    editingShapeId,        // shape currently text-editing → hide its committed text
    clips,                 // Map(itemId → world rect): cropped to a frame/widget (selection/attach.js)
    topGraphicItems = [],  // graphics riding on a widget — drawn on the top canvas, above the widgets
    topConnectorItems = [],// links between two of those
    onWidgetIds,           // Set of their ids (selection/attach.js widgetBorne)
    topStageRef,           // the top canvas's <Stage> (PNG export composites it)
    frameCutLabels,        // Map(frameId → "2 cropped") for the frame titles
    beginTransaction,
    endTransaction,
    overlayChildren,
    selectionOverlay,
    contextToolbar,
}) {
    const containerRef = useRef(null)
    const [size, setSize] = useState({ width: 0, height: 0 })
    const drawingRef = useRef(null)   // { pointerId }
    const lastPanRef = useRef(null)   // screen-space last pointer
    const midPanRef = useRef(false)   // panning via middle mouse button (any tool)
    const panRafRef = useRef(0)       // rAF id coalescing pan moves to one/frame
    const panTargetRef = useRef(null) // latest screen pos awaiting the next frame
    const shapingRef = useRef(null)   // { pointerId }
    const marqueeRef = useRef(null)   // { startWorld, rect, additive, moved }
    const eraseRef = useRef(null)     // { pointerId }
    const lassoRef = useRef(null)     // { points:[[x,y],...], additive }
    const eraserRingRef = useRef(null) // DOM ring that follows the precision eraser
    // Touch bookkeeping — palm rejection + two-finger pan/pinch.
    const pointersRef = useRef(new Map())  // touch pointerId → {x,y} screen
    const penDownRef = useRef(null)         // active stylus pointerId, or null
    const pinchRef = useRef(null)           // { lastCentroid, lastDist } | null

    const latestRef = useRef(null)
    latestRef.current = {
        canvas, items, onWidgetIds, onStrokeCommit, onShapeCommit, onSelect, onMarqueeSelect,
        onErase, onPrecisionErase, onPrecisionEraseEnd, onSmartStroke, onPaint, onPlaceText, onImageDrop, onShapeDoubleClick, onEmptyDoubleClick, beginTransaction, endTransaction,
    }

    useLayoutEffect(() => {
        const el = containerRef.current
        if (!el) return
        const measure = () => {
            const r = el.getBoundingClientRect()
            setSize({ width: r.width, height: r.height })
        }
        measure()
        const ro = new ResizeObserver(measure)
        ro.observe(el)
        return () => ro.disconnect()
    }, [])

    // Wheel = zoom-to-cursor.
    useEffect(() => {
        const el = containerRef.current
        if (!el) return
        const onWheel = (e) => {
            // Over a scrollable card (e.g. a note preview) the wheel scrolls the card
            // instead of zooming the canvas — anywhere inside it, header included.
            const card = e.target?.closest?.('[data-sb-scrollcard="true"]')
            if (card) {
                const scroller = card.querySelector('[data-sb-scroll="true"]')
                if (scroller) { e.preventDefault(); scroller.scrollTop += e.deltaY; return }
            }
            e.preventDefault()
            const rect = el.getBoundingClientRect()
            const pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top }
            latestRef.current.canvas.zoomAt(pointer, e.deltaY)
        }
        el.addEventListener('wheel', onWheel, { passive: false })
        return () => el.removeEventListener('wheel', onWheel)
    }, [])

    // Drag-drop images from the OS.
    useEffect(() => {
        const el = containerRef.current
        if (!el) return
        const onDragOver = (e) => { e.preventDefault() }
        const onDrop = (e) => {
            e.preventDefault()
            const file = [...(e.dataTransfer?.files || [])].find(f => f.type.startsWith('image/'))
            if (!file) return
            const rect = el.getBoundingClientRect()
            const world = latestRef.current.canvas.worldFromScreen({ x: e.clientX - rect.left, y: e.clientY - rect.top })
            latestRef.current.onImageDrop?.(file, world)
        }
        el.addEventListener('dragover', onDragOver)
        el.addEventListener('drop', onDrop)
        return () => {
            el.removeEventListener('dragover', onDragOver)
            el.removeEventListener('drop', onDrop)
        }
    }, [])

    useEffect(() => {
        const el = containerRef.current
        if (!el) return

        const screenPointerWorld = (e) => {
            const rect = el.getBoundingClientRect()
            const sx = e.clientX - rect.left
            const sy = e.clientY - rect.top
            return { screen: { x: sx, y: sy }, world: latestRef.current.canvas.worldFromScreen({ x: sx, y: sy }) }
        }

        const topHitAt = (world) => {
            const all = latestRef.current.items
            const zoom = latestRef.current.canvas.viewport.zoom || 1
            // Format widgets are DOM windows that take their own presses (like cards).
            const sorted = all.filter(i => GRAPHIC_TYPES.has(i.type) && !isFrame(i) && !isFormat(i)).sort((a, b) => (b.z_index ?? 0) - (a.z_index ?? 0))
            for (const it of sorted) if (itemHitTest(it, world.x, world.y, 2)) return it
            // Connectors sit below shapes — test them only when no shape was hit.
            const connectors = all.filter(i => i.type === 'connector')
            if (connectors.length) {
                const byId = new Map(all.map(i => [i.id, i]))
                const tol = 6 / (latestRef.current.canvas.viewport.zoom || 1)
                const ordered = connectors.sort((a, b) => (b.z_index ?? 0) - (a.z_index ?? 0))
                for (const c of ordered) {
                    const pts = connectorPoints(c, byId)
                    if (pts && connectorHitTest(pts, world.x, world.y, tol)) return c
                }
            }
            // Frames paint beneath everything, so they are hit last — and only by
            // their title or border, leaving the interior free for a marquee.
            const frames = all.filter(isFrame).sort((a, b) => (b.z_index ?? 0) - (a.z_index ?? 0))
            for (const f of frames) if (frameHit(f, world.x, world.y, zoom)) return f
            return null
        }

        // Something drawn on a widget (top canvas) under `world`, or near enough
        // that its connection dot has caught the pointer.
        const overTop = (world) => {
            const { onWidgetIds: ids, items: all, canvas: cv } = latestRef.current
            if (!ids?.size) return false
            if (cv.hoverId != null && cv.hoverSide && ids.has(cv.hoverId)) return true
            return all.some(it => ids.has(it.id) && itemHitTest(it, world.x, world.y, 2))
        }

        const eraseAt = (world) => {
            const hit = topHitAt(world)
            if (hit) latestRef.current.onErase?.(hit.id)
        }
        // Precision eraser: cut along the path from the last position, in steps
        // of half the radius, so a fast drag leaves no un-erased gaps.
        const precisionEraseTo = (world) => {
            const st = eraseRef.current
            const r = PRECISION_ERASER_PX / (latestRef.current.canvas.viewport.zoom || 1)
            const from = st.last || world
            const steps = Math.max(1, Math.ceil(Math.hypot(world.x - from.x, world.y - from.y) / (r / 2)))
            for (let i = 1; i <= steps; i++) {
                const t = i / steps
                latestRef.current.onPrecisionErase?.({ x: from.x + (world.x - from.x) * t, y: from.y + (world.y - from.y) * t }, r)
            }
            st.last = world
        }
        const moveEraserRing = (screen) => {
            const ring = eraserRingRef.current
            if (!ring) return
            ring.style.left = `${Math.round(screen.x - PRECISION_ERASER_PX)}px`
            ring.style.top = `${Math.round(screen.y - PRECISION_ERASER_PX)}px`
            ring.style.display = 'block'
        }

        // Two-finger gesture math.
        const centroidOf = (pts) => ({
            x: (pts[0].x + pts[1].x) / 2,
            y: (pts[0].y + pts[1].y) / 2,
        })
        const distOf = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

        // Drop any single-finger op in progress without committing it — called
        // when a second finger lands and we switch to a pan/pinch gesture.
        const abortActiveGestures = () => {
            const { canvas, endTransaction } = latestRef.current
            if (eraseRef.current) {
                if (eraseRef.current.precise) latestRef.current.onPrecisionEraseEnd?.()
                eraseRef.current = null; endTransaction?.()
            }
            canvas.activeStrokeRef.current = null
            canvas.activeShapeRef.current = null
            drawingRef.current = null
            shapingRef.current = null
            if (marqueeRef.current) { marqueeRef.current = null; canvas.setMarquee(null) }
            if (lassoRef.current) { lassoRef.current = null; canvas.setLasso(null) }
            lastPanRef.current = null
            midPanRef.current = false
            if (panRafRef.current) { cancelAnimationFrame(panRafRef.current); panRafRef.current = 0 }
        }

        const onPointerDown = (e) => {
            const { canvas, onPlaceText } = latestRef.current
            // Middle mouse button → pan from anywhere, regardless of the active
            // tool (and over cards). preventDefault suppresses the OS autoscroll.
            //
            // Panning owns the press outright: stopPropagation keeps it from
            // reaching a card underneath (cards' React handlers run after this
            // native listener), which would otherwise start dragging the card
            // at the same time — or, with Space, instead.
            if (e.button === 1) {
                e.preventDefault()
                e.stopPropagation()
                lastPanRef.current = screenPointerWorld(e).screen
                midPanRef.current = true
                el.setPointerCapture?.(e.pointerId)
                return
            }
            if (e.button !== 0 && e.button !== undefined) return
            // Space-drag / the pan tool pan over cards too (handles excluded:
            // those are the selection's own grips).
            if ((canvas.tool === 'hand' || canvas.spacePanning) && e.pointerType !== 'touch' && !e.target?.closest?.('[data-sb-handle="true"]')) {
                e.stopPropagation()
                lastPanRef.current = screenPointerWorld(e).screen
                el.setPointerCapture?.(e.pointerId)
                return
            }
            const target = e.target
            const { screen, world } = screenPointerWorld(e)
            if (target && target !== el && target.closest('[data-sb-handle="true"]')) return
            if (target && target !== el && target.closest('[data-sb-card="true"]')) {
                // Over a card or widget: it takes the press — unless what's under
                // the pointer is something drawn ON a widget (the top canvas).
                if (!overTop(world)) return
                e.stopPropagation()
            }

            const tool = canvas.tool

            if (e.pointerType === 'pen') penDownRef.current = e.pointerId

            // ---- touch: palm rejection + two-finger pan/pinch ----
            if (e.pointerType === 'touch') {
                if (penDownRef.current != null) return  // palm — stylus owns the canvas
                pointersRef.current.set(e.pointerId, screen)
                if (pointersRef.current.size === 2) {
                    abortActiveGestures()
                    const pts = [...pointersRef.current.values()]
                    pinchRef.current = { lastCentroid: centroidOf(pts), lastDist: distOf(pts[0], pts[1]) }
                    return
                }
                if (pointersRef.current.size > 2) return
                // a lone finger falls through and behaves like a normal pointer
            }

            const wantsPan = tool === 'hand' || canvas.spacePanning

            if (wantsPan) {
                lastPanRef.current = screen
                el.setPointerCapture?.(e.pointerId)
                return
            }

            if (tool === 'lasso') {
                lassoRef.current = { points: [[world.x, world.y]], additive: e.shiftKey }
                canvas.setLasso([[world.x, world.y]])
                el.setPointerCapture?.(e.pointerId)
                return
            }

            if (DRAWS_INK.has(tool)) {
                const pressure = e.pressure && e.pressure > 0 ? e.pressure : 0.5
                const minDist = 2 / canvas.viewport.zoom
                // Tilt-aware width (stylus pen only): a flatter pen lays a broader
                // line. tiltX/tiltY are degrees from vertical (0–90).
                const tiltMag = Math.min(90, Math.hypot(e.tiltX || 0, e.tiltY || 0))
                const tiltMult = e.pointerType === 'pen' ? 1 + (tiltMag / 90) * 0.6 : 1
                const group = canvas.ink[presetGroupFor(tool)]
                const style = strokeStyleFor(tool, group.presets[group.active], { inputType: e.pointerType || 'mouse', tiltMult, minDist })
                canvas.activeStrokeRef.current = {
                    pointerId: e.pointerId,
                    points: [[world.x, world.y, pressure]],
                    minDistSq: minDist * minDist,
                    tool,
                    color: style.color,
                    highlighter: style.highlighter,
                    options: style.options,
                }
                el.setPointerCapture?.(e.pointerId)
                drawingRef.current = { pointerId: e.pointerId }
                canvas.activeStrokeRef.startLoop?.()
                return
            }

            if (SHAPE_TOOLS.includes(tool)) {
                canvas.activeShapeRef.current = {
                    kind: tool, x0: world.x, y0: world.y, x1: world.x, y1: world.y,
                    style: canvas.shapeStyle,
                }
                el.setPointerCapture?.(e.pointerId)
                shapingRef.current = { pointerId: e.pointerId }
                canvas.activeShapeRef.startLoop?.()
                return
            }

            if (tool === 'eraser' || tool === 'precisionEraser') {
                latestRef.current.beginTransaction?.()
                const precise = tool === 'precisionEraser'
                eraseRef.current = { pointerId: e.pointerId, precise, last: null }
                el.setPointerCapture?.(e.pointerId)
                if (precise) precisionEraseTo(world); else eraseAt(world)
                return
            }

            if (tool === 'text') {
                onPlaceText?.(world)
                return
            }

            if (tool === 'fill') {
                const hit = topHitAt(world)
                if (hit) latestRef.current.onPaint?.(hit.id)
                return
            }

            // pointer tool — near a shape's dot (magnetised): start an arrow from it.
            const api = canvas.overlayApiRef?.current
            if (canvas.hoverId != null && canvas.hoverSide && api?.beginConnectorFrom) {
                if (api.beginConnectorFrom(e, canvas.hoverId, canvas.hoverSide)) return
            }

            // …else select what's under the pointer and let the same press drag it
            // (no click-then-drag). Connectors stay click-to-select.
            const hit = topHitAt(world)
            if (hit) {
                const wasSelected = canvas.selectedIds.has(hit.id)
                latestRef.current.onSelect?.(hit.id, e.shiftKey)
                if (!e.shiftKey && hit.type !== 'connector' && !hit.payload?.locked && api?.beginMove) {
                    const all = latestRef.current.items
                    const gid = hit.payload?.groupId
                    const ids = wasSelected ? [...canvas.selectedIds]
                        : gid ? all.filter(i => i.payload?.groupId === gid).map(i => i.id) : [hit.id]
                    api.beginMove(e, ids)
                }
            } else {
                if (!e.shiftKey) latestRef.current.onSelect?.(null, false)
                marqueeRef.current = { startWorld: world, rect: null, additive: e.shiftKey }
                el.setPointerCapture?.(e.pointerId)
            }
        }

        const admitSample = (active, x, y, p) => {
            const last = active.points[active.points.length - 1]
            const dx = x - last[0]
            const dy = y - last[1]
            if (dx * dx + dy * dy >= active.minDistSq) active.points.push([x, y, p])
            else last[2] = p
        }

        const onPointerMove = (e) => {
            const { canvas } = latestRef.current

            // Safety net for a lost pointerup (released over an iframe / outside the
            // window, or swallowed by a native text selection): if a drag gesture is
            // still "active" but no mouse button is pressed, finalize it now so the
            // marquee/lasso/stroke can't get stuck following the cursor forever.
            if (e.buttons === 0 && (marqueeRef.current || lassoRef.current || drawingRef.current
                || shapingRef.current || eraseRef.current)) {
                onPointerUp(e)
                return
            }

            if (canvas.tool === 'precisionEraser' && e.pointerType !== 'touch') moveEraserRing(screenPointerWorld(e).screen)

            // ---- hover detection for connection dots (idle pointer tool) ----
            // Only when nothing is being dragged/drawn and no connector drag is
            // live, so the 4 side dots appear under the cursor without churn.
            if (e.pointerType !== 'touch' && canvas.tool === 'pointer'
                && !marqueeRef.current && !drawingRef.current && !shapingRef.current
                && !eraseRef.current && !lassoRef.current && !lastPanRef.current
                && !canvas.spacePanning && !canvas.activeConnectorRef?.current) {
                // Over a dot, a handle or the context bar: keep whatever is hovered.
                // The dots sit OUTSIDE the shape, so re-testing here would clear the
                // hover and unmount the very dot the pointer is reaching for.
                const t = e.target
                const onOverlay = !!(t && t !== el && t.closest?.('[data-sb-handle="true"]') && !t.closest?.('[data-sb-move="true"]'))
                const { world } = screenPointerWorld(e)
                const h = onOverlay ? null : topHitAt(world)
                const all = latestRef.current.items
                const current = canvas.hoverId != null ? all.find(i => i.id === canvas.hoverId) : null
                // Shapes that take arrows, topmost first — the magnet zone picks among them.
                const candidates = all.filter(isConnectable).sort((a, b) => (b.z_index ?? 0) - (a.z_index ?? 0))
                const r = resolveHover({
                    hitId: (h && isConnectable(h)) ? h.id : null,
                    // A non-connectable item on top (a card, a stroke) blocks the magnet below it.
                    candidates: h && !isConnectable(h) ? [] : candidates,
                    current, world, zoom: canvas.viewport.zoom, onOverlay,
                })
                if (r.id !== canvas.hoverId) canvas.setHoverId(r.id)
                if (!r.keepSide && r.side !== canvas.hoverSide) canvas.setHoverSide(r.side)
            }

            // ---- two-finger pan/pinch ----
            if (e.pointerType === 'touch' && pointersRef.current.has(e.pointerId)) {
                pointersRef.current.set(e.pointerId, screenPointerWorld(e).screen)
                if (pinchRef.current && pointersRef.current.size >= 2) {
                    const pts = [...pointersRef.current.values()]
                    const c = centroidOf(pts)
                    const d = distOf(pts[0], pts[1])
                    const prev = pinchRef.current
                    const factor = prev.lastDist > 0 ? d / prev.lastDist : 1
                    canvas.pinch(c, factor, c.x - prev.lastCentroid.x, c.y - prev.lastCentroid.y)
                    pinchRef.current = { lastCentroid: c, lastDist: d }
                    return
                }
            }

            if (lastPanRef.current && (midPanRef.current || canvas.tool === 'hand' || canvas.spacePanning)) {
                // Coalesce pan moves to one viewport update per frame — high-rate
                // mice/trackpads fire faster than the display refreshes, and each
                // pan repaints the whole board, so throttling cuts wasted repaints.
                const rect = el.getBoundingClientRect()
                panTargetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
                if (!panRafRef.current) {
                    panRafRef.current = requestAnimationFrame(() => {
                        panRafRef.current = 0
                        const t = panTargetRef.current
                        const last = lastPanRef.current
                        if (!t || !last) return
                        latestRef.current.canvas.panBy(t.x - last.x, t.y - last.y)
                        lastPanRef.current = t
                    })
                }
                return
            }

            // stroke
            const active = canvas.activeStrokeRef.current
            if (active && drawingRef.current?.pointerId === e.pointerId) {
                const samples = (typeof e.getCoalescedEvents === 'function') ? e.getCoalescedEvents() : null
                if (samples && samples.length > 0) {
                    for (const s of samples) {
                        const { world: w } = screenPointerWorld(s)
                        const p = s.pressure && s.pressure > 0 ? s.pressure : 0.5
                        admitSample(active, w.x, w.y, p)
                    }
                } else {
                    const { world } = screenPointerWorld(e)
                    const pressure = e.pressure && e.pressure > 0 ? e.pressure : 0.5
                    admitSample(active, world.x, world.y, pressure)
                }
                return
            }

            // shape
            if (shapingRef.current?.pointerId === e.pointerId && canvas.activeShapeRef.current) {
                const { world } = screenPointerWorld(e)
                let x1 = world.x, y1 = world.y
                if (e.shiftKey) {
                    const s = canvas.activeShapeRef.current
                    const dx = x1 - s.x0, dy = y1 - s.y0
                    if (isLineKind(s.kind) || s.kind === 'taperedArrow') {
                        // Lines/arrows: snap the DIRECTION to the nearest 45° and keep
                        // the length — so straight across, straight down, or a clean
                        // diagonal. (A square constraint only ever gave diagonals.)
                        const len = Math.hypot(dx, dy)
                        const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
                        x1 = s.x0 + Math.round(Math.cos(a) * len * 1000) / 1000
                        y1 = s.y0 + Math.round(Math.sin(a) * len * 1000) / 1000
                    } else {
                        // Shapes: a square / circle / regular polygon.
                        const m = Math.max(Math.abs(dx), Math.abs(dy))
                        x1 = s.x0 + Math.sign(dx || 1) * m
                        y1 = s.y0 + Math.sign(dy || 1) * m
                    }
                }
                canvas.activeShapeRef.current.x1 = x1
                canvas.activeShapeRef.current.y1 = y1
                return
            }

            // eraser drag
            if (eraseRef.current?.pointerId === e.pointerId) {
                const { world, screen } = screenPointerWorld(e)
                if (eraseRef.current.precise) { moveEraserRing(screen); precisionEraseTo(world) } else eraseAt(world)
                return
            }

            // marquee
            if (marqueeRef.current) {
                const { world } = screenPointerWorld(e)
                const s = marqueeRef.current.startWorld
                const rect = normalizeRect(s.x, s.y, world.x, world.y)
                marqueeRef.current.rect = rect
                marqueeRef.current.moved = true
                canvas.setMarquee(rect)
                return
            }

            // lasso
            if (lassoRef.current) {
                const { world } = screenPointerWorld(e)
                const pts = lassoRef.current.points
                const last = pts[pts.length - 1]
                const minD = 3 / canvas.viewport.zoom
                if (Math.hypot(world.x - last[0], world.y - last[1]) >= minD) {
                    pts.push([world.x, world.y])
                    canvas.setLasso(pts.slice())
                }
                return
            }
        }

        const onPointerUp = (e) => {
            const { canvas, onStrokeCommit, onShapeCommit, onMarqueeSelect, onSmartStroke } = latestRef.current

            if (e.pointerType === 'touch') {
                pointersRef.current.delete(e.pointerId)
                if (pointersRef.current.size < 2) pinchRef.current = null
            }
            if (penDownRef.current === e.pointerId) penDownRef.current = null

            if (lastPanRef.current) {
                lastPanRef.current = null
                midPanRef.current = false
                panTargetRef.current = null
                if (panRafRef.current) { cancelAnimationFrame(panRafRef.current); panRafRef.current = 0 }
                el.releasePointerCapture?.(e.pointerId)
                return
            }

            // stroke commit
            const active = canvas.activeStrokeRef.current
            if (active && drawingRef.current?.pointerId === e.pointerId) {
                const { world } = screenPointerWorld(e)
                const lastPt = active.points[active.points.length - 1]
                if (world.x !== lastPt[0] || world.y !== lastPt[1]) active.points.push([world.x, world.y, lastPt[2]])
                const flatOutline = strokeOutline(active.points, { ...active.options, last: true })
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
                for (let i = 0; i < flatOutline.length; i += 2) {
                    if (flatOutline[i] < minX) minX = flatOutline[i]
                    if (flatOutline[i + 1] < minY) minY = flatOutline[i + 1]
                    if (flatOutline[i] > maxX) maxX = flatOutline[i]
                    if (flatOutline[i + 1] > maxY) maxY = flatOutline[i + 1]
                }
                if (!isFinite(minX)) minX = 0
                if (!isFinite(minY)) minY = 0
                if (!isFinite(maxX)) maxX = minX
                if (!isFinite(maxY)) maxY = minY
                const localOutline = flatOutline.map((v, i) => v - (i % 2 === 0 ? minX : minY))
                const rawPoints = active.points.map(p => [p[0], p[1], p[2]])
                const partial = {
                    type: 'stroke', x: minX, y: minY, w: maxX - minX, h: maxY - minY, rotation: 0,
                    payload: {
                        flatOutline: localOutline, points: rawPoints, color: active.color,
                        options: active.options, baseW: maxX - minX, baseH: maxY - minY,
                        // Optional and absent on pen ink: older builds just draw it as a stroke.
                        ...(active.highlighter ? { highlighter: true } : null),
                    },
                }
                if (active.tool === 'smart' && onSmartStroke) onSmartStroke(partial)
                else onStrokeCommit?.(partial)
                canvas.activeStrokeRef.current = null
                drawingRef.current = null
                el.releasePointerCapture?.(e.pointerId)
                return
            }

            // shape commit
            if (shapingRef.current?.pointerId === e.pointerId) {
                const s = canvas.activeShapeRef.current
                shapingRef.current = null
                canvas.activeShapeRef.current = null
                el.releasePointerCapture?.(e.pointerId)
                if (s) {
                    const minX = Math.min(s.x0, s.x1), minY = Math.min(s.y0, s.y1)
                    const w = Math.abs(s.x1 - s.x0), h = Math.abs(s.y1 - s.y0)
                    const isLine = isLineKind(s.kind)
                    const big = isLine ? (w > 4 || h > 4) : (w > 3 && h > 3)
                    // A plain click with the sticky / frame tool places a default-sized one.
                    if (!big && (s.kind === 'sticky' || s.kind === 'frame')) {
                        const [dw, dh] = s.kind === 'sticky' ? [192, 192] : [640, 400]
                        const at = s.kind === 'sticky' ? { x: s.x0 - dw / 2, y: s.y0 - dh / 2 } : { x: s.x0, y: s.y0 }
                        onShapeCommit?.({ type: 'shape', x: Math.round(at.x), y: Math.round(at.y), w: dw, h: dh, rotation: 0, payload: { kind: s.kind } })
                    } else if (big) {
                        let payload
                        if (isLine) {
                            let pts
                            if (s.kind === 'elbowArrow') {
                                // Right-angle: horizontal then vertical
                                pts = [s.x0 - minX, s.y0 - minY, s.x1 - minX, s.y0 - minY, s.x1 - minX, s.y1 - minY]
                            } else if (s.kind === 'divider') {
                                // Horizontal only
                                pts = [s.x0 - minX, s.y0 - minY, s.x1 - minX, s.y0 - minY]
                            } else {
                                pts = [s.x0 - minX, s.y0 - minY, s.x1 - minX, s.y1 - minY]
                            }
                            payload = {
                                kind: s.kind, stroke: s.style.stroke, strokeWidth: s.style.strokeWidth,
                                points: pts,
                                baseW: Math.max(1, w), baseH: Math.max(1, h),
                            }
                        } else {
                            payload = {
                                kind: s.kind, fill: s.style.fill, stroke: s.style.stroke, strokeWidth: s.style.strokeWidth,
                                radius: s.style.radius || 0,
                            }
                        }
                        onShapeCommit?.({ type: 'shape', x: minX, y: minY, w: Math.max(1, w), h: Math.max(1, h), rotation: 0, payload })
                    }
                }
                return
            }

            // eraser end
            if (eraseRef.current?.pointerId === e.pointerId) {
                if (eraseRef.current.precise) latestRef.current.onPrecisionEraseEnd?.()
                eraseRef.current = null
                el.releasePointerCapture?.(e.pointerId)
                latestRef.current.endTransaction?.()
                return
            }

            // marquee commit
            if (marqueeRef.current) {
                const m = marqueeRef.current
                marqueeRef.current = null
                el.releasePointerCapture?.(e.pointerId)
                canvas.setMarquee(null)
                if (m.moved && m.rect) {
                    // Connectors have no box — selected by direct click, not marquee.
                    const ids = latestRef.current.items.filter(it => it.type !== 'connector'
                        && (isFrame(it) ? marqueeTakesFrame(it, m.rect) : marqueeIntersects(it, m.rect))).map(it => it.id)
                    onMarqueeSelect?.(ids, m.additive)
                }
                return
            }

            // lasso commit — select items whose centre falls inside the freehand loop
            if (lassoRef.current) {
                const { points, additive } = lassoRef.current
                lassoRef.current = null
                el.releasePointerCapture?.(e.pointerId)
                canvas.setLasso(null)
                if (points.length >= 3) {
                    const flat = []
                    for (const p of points) { flat.push(p[0], p[1]) }
                    const ids = latestRef.current.items.filter(it => {
                        if (it.type === 'connector') return false   // no box — click-select only
                        if (isFrame(it)) return false                // lasso takes contents, not the frame
                        const b = itemAABB(it)
                        return pointInPolygon(flat, b.x + b.w / 2, b.y + b.h / 2)
                    }).map(it => it.id)
                    onMarqueeSelect?.(ids, additive)
                }
                return
            }
        }

        // Double-click on a shape → fire onShapeDoubleClick for inline text editing.
        const onDblClick = (e) => {
            const { canvas: cv, onShapeDoubleClick: cb } = latestRef.current
            if (!cb) return
            // Double-click enters text-editing on a shape from any tool that
            // isn't an active drawing/gesture (pen/eraser/hand/lasso) — so the
            // user doesn't have to switch back to the pointer tool first.
            if (DRAWS_INK.has(cv.tool) || cv.tool === 'fill' || cv.tool === 'eraser' || cv.tool === 'precisionEraser' || cv.tool === 'hand' || cv.tool === 'lasso') return
            const target = e.target
            // The selection overlay's move region (data-sb-move) sits over the
            // shape body and is wrapped in a data-sb-handle root — let a
            // double-click there through so it still opens text editing.
            const onMoveRegion = target?.closest?.('[data-sb-move="true"]')
            const rect = el.getBoundingClientRect()
            const world = cv.worldFromScreen({ x: e.clientX - rect.left, y: e.clientY - rect.top })
            if (!onMoveRegion && target && target !== el && (
                (target.closest('[data-sb-card="true"]') && !overTop(world)) || target.closest('[data-sb-handle="true"]')
            )) return
            const hit = topHitAt(world)
            if (hit && hit.type === 'shape') cb(hit.id)
            // Nothing there (cards and handles returned above): make a box on the spot.
            // Pointer only: with the text or a shape tool a click already makes something.
            else if (!hit && cv.tool === 'pointer') latestRef.current.onEmptyDoubleClick?.(world)
        }

        // Clear the connection-dot hover when the pointer leaves the canvas.
        const onPointerLeave = () => {
            if (eraserRingRef.current) eraserRingRef.current.style.display = 'none'
            const cv = latestRef.current.canvas
            if (cv.hoverId != null && !cv.activeConnectorRef?.current) { cv.setHoverId(null); cv.setHoverSide(null) }
        }

        // Suppress the OS middle-click autoscroll (fires on mousedown, which
        // pointerdown.preventDefault doesn't cover) so the button just pans.
        const onMouseDownMid = (e) => { if (e.button === 1) e.preventDefault() }

        el.addEventListener('pointerdown', onPointerDown)
        el.addEventListener('pointermove', onPointerMove)
        el.addEventListener('pointerup', onPointerUp)
        el.addEventListener('pointercancel', onPointerUp)
        el.addEventListener('pointerleave', onPointerLeave)
        el.addEventListener('dblclick', onDblClick)
        el.addEventListener('mousedown', onMouseDownMid)
        return () => {
            el.removeEventListener('pointerdown', onPointerDown)
            el.removeEventListener('pointermove', onPointerMove)
            el.removeEventListener('pointerup', onPointerUp)
            el.removeEventListener('pointercancel', onPointerUp)
            el.removeEventListener('pointerleave', onPointerLeave)
            el.removeEventListener('dblclick', onDblClick)
            el.removeEventListener('mousedown', onMouseDownMid)
            if (panRafRef.current) { cancelAnimationFrame(panRafRef.current); panRafRef.current = 0 }
        }
    }, [])

    const tool = canvas.tool
    const cursor = (tool === 'pointer' && canvas.hoverSide) ? 'crosshair'
        : canvas.spacePanning || tool === 'hand'
        ? (lastPanRef.current ? 'grabbing' : 'grab')
        : tool === 'precisionEraser'
        ? 'none'
        : tool === 'fill'
        ? BUCKET_CURSOR
        : DRAWS_INK.has(tool) || tool === 'lasso' || SHAPE_TOOLS.includes(tool)
            ? 'crosshair'
            : tool === 'eraser'
                ? 'cell'
                : tool === 'text'
                    ? 'text'
                    : 'default'

    const { x: vx, y: vy, zoom } = canvas.viewport
    const minorPx = GRID_MINOR * zoom
    const majorPx = GRID_MAJOR * zoom
    const gridStyle = useMemo(() => ({
        backgroundImage: `
            radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1.4px),
            radial-gradient(circle, rgba(255,255,255,0.10) 1.4px, transparent 1.8px)
        `,
        backgroundSize: `${minorPx}px ${minorPx}px, ${majorPx}px ${majorPx}px`,
        backgroundPosition: `${vx}px ${vy}px, ${vx}px ${vy}px`,
    }), [vx, vy, minorPx, majorPx])

    // Viewport culling (perf): past CULL_THRESHOLD graphics, only paint those
    // whose AABB meets the visible world rect (+ margin). The rect is bucketed
    // so a small pan yields the SAME key string → the visibleGraphics memo holds
    // its reference and GraphicsLayer doesn't re-render every frame.
    const cullKey = useMemo(() => {
        if (graphicItems.length <= CULL_THRESHOLD || !size.width) return 'all'
        const wx = -vx / zoom, wy = -vy / zoom
        const ww = size.width / zoom, wh = size.height / zoom
        const snap = (v) => Math.floor(v / CULL_BUCKET) * CULL_BUCKET
        const x = snap(wx - CULL_MARGIN)
        const y = snap(wy - CULL_MARGIN)
        const w = snap(wx + ww + CULL_MARGIN) + CULL_BUCKET - x
        const h = snap(wy + wh + CULL_MARGIN) + CULL_BUCKET - y
        return `${x},${y},${w},${h}`
    }, [graphicItems.length, vx, vy, zoom, size.width, size.height])

    const visibleGraphics = useMemo(() => {
        if (cullKey === 'all') return graphicItems
        const [x, y, w, h] = cullKey.split(',').map(Number)
        const rect = { x, y, w, h }
        return graphicItems.filter(it => marqueeIntersects(it, rect))
    }, [graphicItems, cullKey])

    // Connectors resolve their endpoints from the live item boxes — a Map for O(1)
    // lookup. Rebuilds when items change; each connector is memoized on its
    // resolved geometry so only links whose endpoints moved actually re-render.
    const byId = useMemo(() => new Map(items.map(i => [i.id, i])), [items])

    return (
        <div
            ref={containerRef}
            style={{
                position: 'relative',
                width: '100%',
                height: '100%',
                cursor,
                touchAction: 'none',
                userSelect: 'none',
                WebkitUserSelect: 'none', // WebKitGTK ignores the unprefixed one
                overflow: 'hidden',
                backgroundColor: 'var(--bg-surface)',
                ...gridStyle,
            }}
        >
            <Stage
                ref={stageRef}
                width={size.width}
                height={size.height}
                x={canvas.viewport.x}
                y={canvas.viewport.y}
                scaleX={canvas.viewport.zoom}
                scaleY={canvas.viewport.zoom}
                pixelRatio={typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO) : 1}
            >
                <FrameLayer frameItems={frameItems} zoom={canvas.viewport.zoom} editingFrameId={editingFrameId} clips={clips} cutLabels={frameCutLabels} />
                <ConnectorLayer connectorItems={connectorItems} byId={byId} selectedIds={canvas.selectedIds} />
                <GraphicsLayer graphicItems={visibleGraphics} editingShapeId={editingShapeId} clips={clips} />
            </Stage>

            <OverlayLayer viewport={canvas.viewport} width={size.width} height={size.height} passThrough={passesCards(tool)}>
                {overlayChildren}
            </OverlayLayer>

            {/* The top canvas: above the cards and widgets. It draws what rides on
                a widget (or the widget's DOM would hide it) and the live previews
                of ink, shapes and links — so drawing over a widget shows. Same pan
                and zoom as the board; it takes no pointer events. */}
            <Stage
                ref={topStageRef}
                width={size.width}
                height={size.height}
                x={canvas.viewport.x}
                y={canvas.viewport.y}
                scaleX={canvas.viewport.zoom}
                scaleY={canvas.viewport.zoom}
                pixelRatio={typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO) : 1}
                listening={false}
                style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
            >
                {topConnectorItems.length > 0 && <ConnectorLayer connectorItems={topConnectorItems} byId={byId} selectedIds={canvas.selectedIds} />}
                {topGraphicItems.length > 0 && <GraphicsLayer graphicItems={topGraphicItems} editingShapeId={editingShapeId} clips={clips} />}
                <ActiveLayer
                    activeStrokeRef={canvas.activeStrokeRef}
                    activeShapeRef={canvas.activeShapeRef}
                    activeConnectorRef={canvas.activeConnectorRef}
                />
            </Stage>

            {selectionOverlay}

            {/* The precision eraser's footprint. Moved imperatively on pointermove
                (left/top in whole pixels, no transform), so no re-render per move. */}
            {tool === 'precisionEraser' && (
                <div ref={eraserRingRef} aria-hidden="true" style={{
                    position: 'absolute', display: 'none', pointerEvents: 'none', zIndex: 5,
                    width: PRECISION_ERASER_PX * 2, height: PRECISION_ERASER_PX * 2, boxSizing: 'border-box',
                    borderRadius: '50%', border: '1.5px solid var(--accent-warning)',
                    backgroundColor: 'rgba(240, 184, 64, 0.12)',
                }} />
            )}

            {contextToolbar}
        </div>
    )
}

export default SandboxCanvas
