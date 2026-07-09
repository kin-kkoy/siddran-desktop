import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
    getItemBounds, getSelectionBounds, getOrientedAnchors, boxCenter,
    boxUpVector, rotatePoint,
} from './itemBounds'
import { computeSnap, unionAABB } from './snapping'
import { itemHitTest } from './hitTest'
import { facingSide, connectorPoints, SIDES } from '../connectors/geometry'

/**
 * The single transform overlay — one DOM/SVG surface drawn above BOTH the Konva
 * stage and the DOM card layer. It reads the selected items' world boxes and
 * draws a marquee, selection outlines, 8 resize handles, and a rotate handle.
 *
 * It lives inside SandboxCanvas's container so screen coords line up with
 * canvas.worldFromScreen/screenFromWorld. Handles carry data-sb-handle so the
 * canvas pointer handler ignores them.
 *
 * No-compounding rule: a gesture snapshots every selected item's box at
 * pointerdown and computes the ABSOLUTE new box from snapshot × current drag
 * each frame — never from the previous frame. All mutations go through the
 * history-wrapped updateItem inside one transaction (beginTransaction →
 * endTransaction) so a whole drag is one undo step.
 */

const DEG = Math.PI / 180
const HANDLE = 9          // screen px
const ROTATE_GAP = 26     // screen px above the top edge
const SNAP_PX = 6         // screen-px magnet radius for snapping
const SNAP_GRID = 24      // world units between grid snap lines (matches GRID_MINOR)

// Opposite anchor for each resize handle, and which axes it scales.
const HANDLES = {
    nw: { opp: 'se', sx: true, sy: true, cursor: 'nwse-resize' },
    ne: { opp: 'sw', sx: true, sy: true, cursor: 'nesw-resize' },
    se: { opp: 'nw', sx: true, sy: true, cursor: 'nwse-resize' },
    sw: { opp: 'ne', sx: true, sy: true, cursor: 'nesw-resize' },
    n: { opp: 's', sx: false, sy: true, cursor: 'ns-resize' },
    s: { opp: 'n', sx: false, sy: true, cursor: 'ns-resize' },
    e: { opp: 'w', sx: true, sy: false, cursor: 'ew-resize' },
    w: { opp: 'e', sx: true, sy: false, cursor: 'ew-resize' },
}

const clampScale = (s) => (Math.abs(s) < 0.05 ? (s < 0 ? -0.05 : 0.05) : s)

function SelectionOverlay({ canvas, selectedItems, items, updateItem, beginTransaction, endTransaction, onCreateConnector }) {
    const rootRef = useRef(null)
    const dragRef = useRef(null)
    const connectorRef = useRef(null)   // active connector drag, separate from transform
    const [guides, setGuides] = useState([])  // [{type:'v'|'h', pos}] world coords
    // A transparent shield covers the viewport during a transform gesture so pointer
    // events over an embedded card (e.g. a PDF iframe) don't break the drag.
    const [gesturing, setGesturing] = useState(false)
    const rafRef = useRef(0)
    const lastMoveRef = useRef(null)

    const { viewport } = canvas
    // Connectors have no transform box — exclude them so a selected connector
    // shows no resize/rotate handles (it's highlighted in ConnectorLayer instead).
    const boxItems = selectedItems.filter(it => it.type !== 'connector')
    const hasSel = boxItems.length > 0
    const box = hasSel ? getSelectionBounds(boxItems) : null
    // The filled move-region is only interactive when a Konva graphic is selected
    // (those have no DOM node to drag). For card-only selections it stays
    // non-interactive so the card's own ×/links/checkbox and drag keep working.
    const moveInteractive = boxItems.some(it => it.type === 'stroke' || it.type === 'shape' || it.type === 'image')

    // Shape that should show the 4 connection dots: the hovered shape, else a
    // single selected shape.
    const dotItem = (() => {
        if (canvas.hoverId != null) {
            const h = items.find(it => it.id === canvas.hoverId)
            if (h && h.type === 'shape') return h
        }
        if (boxItems.length === 1 && boxItems[0].type === 'shape') return boxItems[0]
        return null
    })()

    // Selected single connector → its two resolved endpoints get drag handles so
    // the user can re-route an end to another shape/side or detach it (free end).
    const selConnector = (selectedItems.length === 1 && selectedItems[0].type === 'connector') ? selectedItems[0] : null
    const connEnds = (() => {
        if (!selConnector) return null
        const byId = new Map((items || []).map(i => [i.id, i]))
        const pts = connectorPoints(selConnector, byId)
        if (!pts || pts.length < 4) return null
        return { from: { x: pts[0], y: pts[1] }, to: { x: pts[pts.length - 2], y: pts[pts.length - 1] } }
    })()

    const screenOf = (wp) => canvas.screenFromWorld(wp)

    const worldFromClient = (e) => {
        const rect = rootRef.current.getBoundingClientRect()
        return canvas.worldFromScreen({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    }

    // ---- gesture lifecycle ----
    const endGesture = () => {
        if (!dragRef.current) return
        if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0 }
        lastMoveRef.current = null
        window.removeEventListener('pointermove', onWindowMove)
        window.removeEventListener('pointerup', onWindowUp)
        dragRef.current = null
        setGuides([])
        setGesturing(false)
        endTransaction()
    }

    const onWindowUp = () => { flushMove(); endGesture() }

    // rAF-coalesce transform updates: a high-rate pointer (or a heavy item like a
    // PDF iframe) would otherwise fire many updates per frame, each re-rendering +
    // relaying-out. We keep only the latest event and apply it once per frame.
    const flushMove = () => {
        if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0 }
        if (lastMoveRef.current) { const e = lastMoveRef.current; lastMoveRef.current = null; applyMove(e) }
    }
    const onWindowMove = (e) => {
        lastMoveRef.current = e
        if (rafRef.current) return
        rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; flushMove() })
    }

    const applyMove = (e) => {
        const d = dragRef.current
        if (!d) return
        const p = worldFromClient(e)

        if (d.mode === 'move') {
            let dx = p.x - d.startWorld.x
            let dy = p.y - d.startWorld.y
            if (canvas.snapEnabled && d.baseAABB) {
                const moving = { x: d.baseAABB.x + dx, y: d.baseAABB.y + dy, w: d.baseAABB.w, h: d.baseAABB.h }
                const snap = computeSnap(moving, d.others, SNAP_GRID, SNAP_PX / viewport.zoom)
                dx += snap.dx
                dy += snap.dy
                setGuides(snap.guides)
            }
            for (const s of d.snap) updateItem(s.id, { x: s.box.x + dx, y: s.box.y + dy })
            return
        }

        if (d.mode === 'rotate') {
            let deg = Math.atan2(p.y - d.center.y, p.x - d.center.x) / DEG
                - Math.atan2(d.startWorld.y - d.center.y, d.startWorld.x - d.center.x) / DEG
            if (e.shiftKey) deg = Math.round(deg / 15) * 15
            for (const s of d.snap) {
                const c = boxCenter(s.box)
                const nc = rotatePoint(c.x, c.y, d.center.x, d.center.y, deg)
                updateItem(s.id, {
                    x: nc.x - s.box.w / 2,
                    y: nc.y - s.box.h / 2,
                    rotation: (s.box.rotation || 0) + deg,
                })
            }
            return
        }

        // resize — work in a frame rotated by -θ about the fixed anchor A.
        const θ = d.groupRotation
        const A = d.anchorWorld
        const pLocal = rotatePoint(p.x, p.y, A.x, A.y, -θ)
        const h0Local = rotatePoint(d.handleWorld.x, d.handleWorld.y, A.x, A.y, -θ)
        const aLocal = A // pivot maps to itself
        let sx = d.scaleX ? clampScale((pLocal.x - aLocal.x) / (h0Local.x - aLocal.x || 1e-6)) : 1
        let sy = d.scaleY ? clampScale((pLocal.y - aLocal.y) / (h0Local.y - aLocal.y || 1e-6)) : 1

        for (const s of d.snap) {
            const c0 = boxCenter(s.box)
            const c0Local = rotatePoint(c0.x, c0.y, A.x, A.y, -θ)
            const ncLocalX = aLocal.x + (c0Local.x - aLocal.x) * sx
            const ncLocalY = aLocal.y + (c0Local.y - aLocal.y) * sy
            const nc = rotatePoint(ncLocalX, ncLocalY, A.x, A.y, θ)
            const nw = Math.max(2, Math.abs(s.box.w * sx))
            const nh = Math.max(2, Math.abs(s.box.h * sy))
            updateItem(s.id, { x: nc.x - nw / 2, y: nc.y - nh / 2, w: nw, h: nh })
        }
    }

    const snapshot = () => boxItems.map(it => ({ id: it.id, box: getItemBounds(it) }))

    const startGesture = (e, init) => {
        e.preventDefault()
        e.stopPropagation()
        beginTransaction()
        dragRef.current = { ...init, snap: snapshot(), startWorld: worldFromClient(e) }
        setGesturing(true)
        window.addEventListener('pointermove', onWindowMove)
        window.addEventListener('pointerup', onWindowUp)
    }

    const onMoveDown = (e) => {
        const selIds = new Set(boxItems.map(it => it.id))
        startGesture(e, {
            mode: 'move',
            baseAABB: unionAABB(boxItems),
            others: (items || []).filter(it => !selIds.has(it.id)),
        })
    }

    // ---- connector drag — unified for CREATE (drag from a shape's dot) and EDIT
    // (drag an endpoint of a selected connector). One end is FIXED, the other
    // MOVES with the cursor; on drop the moving end links to the facing side of
    // the shape under the cursor, or becomes a free point on empty canvas. Not a
    // transaction — create is one addItem, edit is one history-wrapped update. ----
    const onConnectorUp = () => {
        const d = connectorRef.current
        if (!d) return
        window.removeEventListener('pointermove', onConnectorMove)
        window.removeEventListener('pointerup', onConnectorUp)
        connectorRef.current = null
        if (canvas.activeConnectorRef) canvas.activeConnectorRef.current = null  // stop the preview loop
        const dist = Math.hypot(d.movingPoint.x - d.fixedPoint.x, d.movingPoint.y - d.fixedPoint.y)
        if (d.targetId || dist > 6 / viewport.zoom) {   // ignore an accidental click
            const movingEnd = d.targetId
                ? { itemId: d.targetId, side: d.targetSide }
                : { point: { x: d.movingPoint.x, y: d.movingPoint.y } }
            if (d.mode === 'create') {
                onCreateConnector?.({ from: { itemId: d.fromId, side: d.fromSide }, to: movingEnd })
            } else {
                const conn = (items || []).find(it => it.id === d.editId)
                if (conn) updateItem(d.editId, { payload: { ...conn.payload, [d.editWhich]: movingEnd } })
            }
        }
        canvas.setHoverId(null)
    }

    const onConnectorMove = (e) => {
        const d = connectorRef.current
        if (!d) return
        const world = worldFromClient(e)
        // Topmost shape under the cursor (exclude the source on create).
        const targets = (items || [])
            .filter(it => it.type === 'shape' && it.id !== d.excludeId)
            .sort((a, b) => (b.z_index ?? 0) - (a.z_index ?? 0))
        let hit = null
        for (const it of targets) { if (itemHitTest(it, world.x, world.y, 2)) { hit = it; break } }
        if (hit) {
            const side = facingSide(hit, d.fixedPoint)   // face the fixed end → looks correct
            d.targetId = hit.id; d.targetSide = side
            d.movingPoint = getOrientedAnchors(getItemBounds(hit))[side]
        } else {
            d.targetId = null; d.targetSide = null
            d.movingPoint = world
        }
        if (canvas.activeConnectorRef) {
            const fromPoint = d.headIsMoving ? d.fixedPoint : d.movingPoint
            const toPoint = d.headIsMoving ? d.movingPoint : d.fixedPoint
            canvas.activeConnectorRef.current = { fromPoint, toPoint, routing: d.routing }
        }
    }

    const beginConnectorDrag = (init) => {
        connectorRef.current = init
        if (canvas.activeConnectorRef) {
            const fromPoint = init.headIsMoving ? init.fixedPoint : init.movingPoint
            const toPoint = init.headIsMoving ? init.movingPoint : init.fixedPoint
            canvas.activeConnectorRef.current = { fromPoint, toPoint, routing: init.routing }
            canvas.activeConnectorRef.startLoop?.()
        }
        window.addEventListener('pointermove', onConnectorMove)
        window.addEventListener('pointerup', onConnectorUp)
    }

    // CREATE: drag out from one of a shape's 4 connection dots.
    const onConnectorDotDown = (side) => (e) => {
        if (!dotItem) return
        e.preventDefault()
        e.stopPropagation()
        const fromPoint = getOrientedAnchors(getItemBounds(dotItem))[side]
        beginConnectorDrag({
            mode: 'create', fromId: dotItem.id, fromSide: side, excludeId: dotItem.id,
            fixedPoint: fromPoint, movingPoint: fromPoint, headIsMoving: true,
            targetId: null, targetSide: null, routing: 'elbow',
        })
    }

    // EDIT: drag an endpoint of the selected connector to re-route or detach it.
    const onEndpointDown = (which, ends, conn) => (e) => {
        e.preventDefault()
        e.stopPropagation()
        const fixedPoint = which === 'from' ? ends.to : ends.from
        const movingPoint = which === 'from' ? ends.from : ends.to
        beginConnectorDrag({
            mode: 'edit', editId: conn.id, editWhich: which, excludeId: null,
            fixedPoint, movingPoint, headIsMoving: which === 'to',
            targetId: null, targetSide: null, routing: conn.payload?.routing || 'elbow',
        })
    }

    const onRotateDown = (e) => startGesture(e, { mode: 'rotate', center: boxCenter(box) })

    const onResizeDown = (key) => (e) => {
        const anchors = getOrientedAnchors(box)
        startGesture(e, {
            mode: 'resize',
            anchorWorld: anchors[HANDLES[key].opp],
            handleWorld: anchors[key],
            groupRotation: box.rotation || 0,
            scaleX: HANDLES[key].sx,
            scaleY: HANDLES[key].sy,
        })
    }

    // ---- render ----
    const marquee = canvas.marquee
        ? (() => {
            const a = screenOf({ x: canvas.marquee.x, y: canvas.marquee.y })
            return { left: a.x, top: a.y, w: canvas.marquee.w * viewport.zoom, h: canvas.marquee.h * viewport.zoom }
        })()
        : null

    let anchorsScreen = null
    let rotateScreen = null
    let outlinePts = ''
    if (box) {
        const a = getOrientedAnchors(box)
        anchorsScreen = {}
        for (const k in a) anchorsScreen[k] = screenOf(a[k])
        const up = boxUpVector(box)
        const nWorld = a.n
        rotateScreen = screenOf({ x: nWorld.x + up.x * (ROTATE_GAP / viewport.zoom), y: nWorld.y + up.y * (ROTATE_GAP / viewport.zoom) })
        outlinePts = ['nw', 'ne', 'se', 'sw'].map(k => `${anchorsScreen[k].x},${anchorsScreen[k].y}`).join(' ')
    }

    return (
        <div
            ref={rootRef}
            data-sb-handle="true"
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }}
        >
            {gesturing && createPortal(
                <div style={{ position: 'fixed', inset: 0, zIndex: 9998, cursor: 'grabbing' }} />,
                document.body,
            )}
            <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
                {/* per-item outlines (subtle), only for multi-select */}
                {box && selectedItems.length > 1 && selectedItems.map(it => {
                    const a = getOrientedAnchors(getItemBounds(it))
                    const pts = ['nw', 'ne', 'se', 'sw'].map(k => { const s = screenOf(a[k]); return `${s.x},${s.y}` }).join(' ')
                    return <polygon key={it.id} points={pts} fill="none" stroke="var(--accent-warning)" strokeWidth={1} opacity={0.4} />
                })}

                {box && (
                    <>
                        {/* move region — interior of the selection box.
                            data-sb-move marks it as the shape body (not a true
                            handle) so a double-click here still opens text edit. */}
                        <polygon
                            data-sb-move="true"
                            points={outlinePts}
                            fill={moveInteractive ? 'rgba(240,184,64,0.04)' : 'none'}
                            stroke="var(--accent-warning)"
                            strokeWidth={1.5}
                            style={{ pointerEvents: moveInteractive ? 'auto' : 'none', cursor: 'move' }}
                            onPointerDown={moveInteractive ? onMoveDown : undefined}
                        />
                        {/* rotate stalk + knob */}
                        <line x1={anchorsScreen.n.x} y1={anchorsScreen.n.y} x2={rotateScreen.x} y2={rotateScreen.y}
                            stroke="var(--accent-warning)" strokeWidth={1} />
                        <circle cx={rotateScreen.x} cy={rotateScreen.y} r={6}
                            fill="var(--bg-surface)" stroke="var(--accent-warning)" strokeWidth={1.5}
                            style={{ pointerEvents: 'auto', cursor: 'grab' }}
                            onPointerDown={onRotateDown} />
                        {/* resize handles */}
                        {Object.keys(HANDLES).map(k => {
                            const s = anchorsScreen[k]
                            return (
                                <rect key={k}
                                    x={s.x - HANDLE / 2} y={s.y - HANDLE / 2}
                                    width={HANDLE} height={HANDLE} rx={2}
                                    fill="var(--bg-surface)" stroke="var(--accent-warning)" strokeWidth={1.5}
                                    style={{ pointerEvents: 'auto', cursor: HANDLES[k].cursor }}
                                    onPointerDown={onResizeDown(k)} />
                            )
                        })}
                    </>
                )}

                {/* connection dots — 4 side anchors of the hovered/selected shape,
                    nudged just outside the edge so they don't clash with the
                    side resize handles. Drag a dot to link to another shape. */}
                {dotItem && (() => {
                    const b = getItemBounds(dotItem)
                    const a = getOrientedAnchors(b)
                    const c = screenOf(boxCenter(b))
                    const OUT = 14
                    return SIDES.map(side => {
                        const base = screenOf(a[side])
                        const dx = base.x - c.x, dy = base.y - c.y
                        const len = Math.hypot(dx, dy) || 1
                        return (
                            <circle key={`dot-${side}`}
                                cx={base.x + (dx / len) * OUT} cy={base.y + (dy / len) * OUT} r={5}
                                fill="var(--accent-warning)" stroke="var(--bg-surface)" strokeWidth={1.5}
                                style={{ pointerEvents: 'auto', cursor: 'crosshair' }}
                                onPointerDown={onConnectorDotDown(side)} />
                        )
                    })
                })()}

                {/* connector endpoint handles — drag to re-route or detach an end */}
                {connEnds && ['from', 'to'].map(which => {
                    const s = screenOf(connEnds[which])
                    return (
                        <circle key={`ep-${which}`} cx={s.x} cy={s.y} r={6}
                            fill="var(--bg-surface)" stroke="var(--accent-warning)" strokeWidth={2}
                            style={{ pointerEvents: 'auto', cursor: 'grab' }}
                            onPointerDown={onEndpointDown(which, connEnds, selConnector)} />
                    )
                })}

                {marquee && (
                    <rect x={marquee.left} y={marquee.top} width={marquee.w} height={marquee.h}
                        fill="rgba(240,184,64,0.08)" stroke="var(--accent-warning)" strokeWidth={1} strokeDasharray="4 3" />
                )}

                {/* lasso freehand selection path */}
                {canvas.lasso && canvas.lasso.length >= 2 && (
                    <polygon
                        points={canvas.lasso.map(p => { const s = screenOf({ x: p[0], y: p[1] }); return `${s.x},${s.y}` }).join(' ')}
                        fill="rgba(240,184,64,0.08)" stroke="var(--accent-warning)" strokeWidth={1} strokeDasharray="4 3"
                    />
                )}

                {/* snap guides — dashed lines through the matched edge/centre */}
                {guides.map((g, i) => g.type === 'v'
                    ? <line key={i} x1={screenOf({ x: g.pos, y: 0 }).x} x2={screenOf({ x: g.pos, y: 0 }).x}
                        y1="0" y2="100%" stroke="#5a9cf0" strokeWidth={1} strokeDasharray="3 3" />
                    : <line key={i} y1={screenOf({ x: 0, y: g.pos }).y} y2={screenOf({ x: 0, y: g.pos }).y}
                        x1="0" x2="100%" stroke="#5a9cf0" strokeWidth={1} strokeDasharray="3 3" />
                )}
            </svg>
        </div>
    )
}

export default SelectionOverlay
