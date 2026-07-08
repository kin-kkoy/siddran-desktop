import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Stage } from 'react-konva'
import GraphicsLayer from './GraphicsLayer'
import ConnectorLayer from './ConnectorLayer'
import ActiveLayer from './ActiveLayer'
import OverlayLayer from './OverlayLayer'
import { strokeOutline } from './strokeOutline'
import { SHAPE_TOOLS } from '../../../hooks/useSandboxCanvas'
import { isLineKind } from '../shapes/registry'
import { itemHitTest, marqueeIntersects, normalizeRect, itemAABB, pointInPolygon } from '../selection/hitTest'
import { connectorPoints, connectorHitTest } from '../connectors/geometry'

const GRID_MINOR = 24
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
// The smoothing slider (0–1) maps onto perfect-freehand `streamline`, but its
// top end must stay BELOW 1.0 — at streamline 1.0 the low-pass never converges,
// so the stroke chases the cursor forever (laggy even when you hold still).
const MAX_STREAMLINE = 0.8

// Cap the canvas render resolution. On scaled/HiDPI displays (Windows 125–150%,
// Retina 2×) the committed-graphics fill cost scales with pixelRatio² — capping
// trades a little crispness for a big paint reduction on weak hardware. ≤ this
// value it's a no-op. Lower toward 1 if panning a dense board still lags.
const MAX_PIXEL_RATIO = 1.5

const CULL_THRESHOLD = 120   // only viewport-cull graphics past this count
const CULL_MARGIN = 200      // world px kept beyond the viewport so nothing pops
const CULL_BUCKET = 200      // snap the cull rect to this grid so panning a little doesn't re-render

function SandboxCanvas({
    canvas,
    items,                 // ALL items — for pointer/eraser/marquee hit-testing
    graphicItems,          // strokes + shapes + images, z-sorted (one Konva layer)
    connectorItems,        // connector items, z-sorted (own layer below shapes)
    stageRef,              // forwarded to <Stage> so the page can export a PNG
    onStrokeCommit,
    onShapeCommit,
    onSelect,              // (id|null, additive)
    onMarqueeSelect,       // (ids[], additive)
    onErase,               // (id)
    onPlaceText,           // (worldPoint)
    onImageDrop,           // (file, worldPoint)
    onShapeDoubleClick,    // (itemId) — double-click a shape to edit text
    editingShapeId,        // shape currently text-editing → hide its committed text
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
    // Touch bookkeeping — palm rejection + two-finger pan/pinch.
    const pointersRef = useRef(new Map())  // touch pointerId → {x,y} screen
    const penDownRef = useRef(null)         // active stylus pointerId, or null
    const pinchRef = useRef(null)           // { lastCentroid, lastDist } | null

    const latestRef = useRef(null)
    latestRef.current = {
        canvas, items, onStrokeCommit, onShapeCommit, onSelect, onMarqueeSelect,
        onErase, onPlaceText, onImageDrop, onShapeDoubleClick, beginTransaction, endTransaction,
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
            const sorted = all.filter(i => GRAPHIC_TYPES.has(i.type)).sort((a, b) => (b.z_index ?? 0) - (a.z_index ?? 0))
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
            return null
        }

        const eraseAt = (world) => {
            const hit = topHitAt(world)
            if (hit) latestRef.current.onErase?.(hit.id)
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
            if (eraseRef.current) { eraseRef.current = null; endTransaction?.() }
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
            if (e.button === 1) {
                e.preventDefault()
                lastPanRef.current = screenPointerWorld(e).screen
                midPanRef.current = true
                el.setPointerCapture?.(e.pointerId)
                return
            }
            if (e.button !== 0 && e.button !== undefined) return
            const target = e.target
            if (target && target !== el && (
                target.closest('[data-sb-card="true"]') || target.closest('[data-sb-handle="true"]')
            )) return

            const { screen, world } = screenPointerWorld(e)
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

            if (tool === 'pen') {
                const pressure = e.pressure && e.pressure > 0 ? e.pressure : 0.5
                const minDist = 2 / canvas.viewport.zoom
                // Tilt-aware width (stylus only): a flatter pen lays a broader
                // line. tiltX/tiltY are degrees from vertical (0–90).
                const tiltMag = Math.min(90, Math.hypot(e.tiltX || 0, e.tiltY || 0))
                const tiltMult = e.pointerType === 'pen' ? 1 + (tiltMag / 90) * 0.6 : 1
                canvas.activeStrokeRef.current = {
                    pointerId: e.pointerId,
                    points: [[world.x, world.y, pressure]],
                    minDistSq: minDist * minDist,
                    color: canvas.strokeColor,
                    options: {
                        size: canvas.brush.size * tiltMult,
                        streamline: (canvas.brush.smoothing ?? 0.6) * MAX_STREAMLINE,
                        inputType: e.pointerType || 'mouse',
                        minDist,
                    },
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

            if (tool === 'eraser') {
                latestRef.current.beginTransaction?.()
                eraseRef.current = { pointerId: e.pointerId }
                el.setPointerCapture?.(e.pointerId)
                eraseAt(world)
                return
            }

            if (tool === 'text') {
                onPlaceText?.(world)
                return
            }

            // pointer tool — select a graphic, or start a marquee.
            const hit = topHitAt(world)
            if (hit) {
                latestRef.current.onSelect?.(hit.id, e.shiftKey)
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

            // ---- hover detection for connection dots (idle pointer tool) ----
            // Only when nothing is being dragged/drawn and no connector drag is
            // live, so the 4 side dots appear under the cursor without churn.
            if (e.pointerType !== 'touch' && canvas.tool === 'pointer'
                && !marqueeRef.current && !drawingRef.current && !shapingRef.current
                && !eraseRef.current && !lassoRef.current && !lastPanRef.current
                && !canvas.spacePanning && !canvas.activeConnectorRef?.current) {
                const { world } = screenPointerWorld(e)
                const h = topHitAt(world)
                const hid = (h && h.type === 'shape') ? h.id : null
                if (hid !== canvas.hoverId) canvas.setHoverId(hid)
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
                    // constrain to square / 45° for shapes & lines
                    const s = canvas.activeShapeRef.current
                    const dx = x1 - s.x0, dy = y1 - s.y0
                    const m = Math.max(Math.abs(dx), Math.abs(dy))
                    x1 = s.x0 + Math.sign(dx || 1) * m
                    y1 = s.y0 + Math.sign(dy || 1) * m
                }
                canvas.activeShapeRef.current.x1 = x1
                canvas.activeShapeRef.current.y1 = y1
                return
            }

            // eraser drag
            if (eraseRef.current?.pointerId === e.pointerId) {
                const { world } = screenPointerWorld(e)
                eraseAt(world)
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
            const { canvas, onStrokeCommit, onShapeCommit, onMarqueeSelect } = latestRef.current

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
                onStrokeCommit?.({
                    type: 'stroke', x: minX, y: minY, w: maxX - minX, h: maxY - minY, rotation: 0,
                    payload: {
                        flatOutline: localOutline, points: rawPoints, color: active.color,
                        options: active.options, baseW: maxX - minX, baseH: maxY - minY,
                    },
                })
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
                    if (big) {
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
                    const ids = latestRef.current.items.filter(it => it.type !== 'connector' && marqueeIntersects(it, m.rect)).map(it => it.id)
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
            if (cv.tool === 'pen' || cv.tool === 'eraser' || cv.tool === 'hand' || cv.tool === 'lasso') return
            const target = e.target
            // The selection overlay's move region (data-sb-move) sits over the
            // shape body and is wrapped in a data-sb-handle root — let a
            // double-click there through so it still opens text editing.
            const onMoveRegion = target?.closest?.('[data-sb-move="true"]')
            if (!onMoveRegion && target && target !== el && (
                target.closest('[data-sb-card="true"]') || target.closest('[data-sb-handle="true"]')
            )) return
            const rect = el.getBoundingClientRect()
            const world = cv.worldFromScreen({ x: e.clientX - rect.left, y: e.clientY - rect.top })
            const hit = topHitAt(world)
            if (hit && hit.type === 'shape') cb(hit.id)
        }

        // Clear the connection-dot hover when the pointer leaves the canvas.
        const onPointerLeave = () => {
            const cv = latestRef.current.canvas
            if (cv.hoverId != null && !cv.activeConnectorRef?.current) cv.setHoverId(null)
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
    const cursor = canvas.spacePanning || tool === 'hand'
        ? (lastPanRef.current ? 'grabbing' : 'grab')
        : tool === 'pen' || tool === 'lasso' || SHAPE_TOOLS.includes(tool)
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
                <ConnectorLayer connectorItems={connectorItems} byId={byId} selectedIds={canvas.selectedIds} />
                <GraphicsLayer graphicItems={visibleGraphics} editingShapeId={editingShapeId} />
                <ActiveLayer
                    activeStrokeRef={canvas.activeStrokeRef}
                    activeShapeRef={canvas.activeShapeRef}
                    activeConnectorRef={canvas.activeConnectorRef}
                />
            </Stage>

            <OverlayLayer viewport={canvas.viewport} width={size.width} height={size.height}>
                {overlayChildren}
            </OverlayLayer>

            {selectionOverlay}

            {contextToolbar}
        </div>
    )
}

export default SandboxCanvas
