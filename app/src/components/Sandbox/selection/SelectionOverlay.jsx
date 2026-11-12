import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
    getItemBounds, getSelectionBounds, getOrientedAnchors, boxCenter,
    boxUpVector, rotatePoint,
} from './itemBounds'
import { computeSnap, unionAABB } from './snapping'
import { itemHitTest } from './hitTest'
import { facingSide, connectorPoints, connectorMidpoint, SIDES } from '../connectors/geometry'
import { isFrame, frameChildren, frameTitleRect } from '../frames/frames'
import { isLineKind } from '../shapes/registry'
import { lineHandles, dragLineHandle, straightenLine } from './lineHandles'

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
// Connection dots: drawn DOT_OUT screen px outside each edge midpoint, with a
// generous invisible hit circle so they are easy to grab. SandboxCanvas keeps the
// hover alive across this whole reach (DOT_REACH_PX) — the old bug was the hover
// test ending at the shape's edge, which unmounted the dot as you reached it.
const DOT_OUT = 14
const DOT_R = 5
const DOT_HIT = 12
const DROP_PAD_PX = 16    // screen px around a target shape that still counts as "on" it

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

function SelectionOverlay({ canvas, selectedItems, items, updateItem, beginTransaction, endTransaction, onCreateConnector, onQuickAdd, onQuickAddAt }) {
    const rootRef = useRef(null)
    const dragRef = useRef(null)
    const connectorRef = useRef(null)   // active connector drag, separate from transform
    const [guides, setGuides] = useState([])  // [{type:'v'|'h', pos}] world coords
    // A transparent shield covers the viewport during a transform gesture so pointer
    // events over an embedded card (e.g. a PDF iframe) don't break the drag.
    const [gesturing, setGesturing] = useState(false)
    // While dragging a new/edited connector end: the shape it would attach to, so
    // its ports light up. Changes only when the target changes (not every move).
    const [dropTarget, setDropTarget] = useState(null)   // { id, side } | null
    const [hotDot, setHotDot] = useState(null)           // side under the pointer
    const rafRef = useRef(0)
    const lastMoveRef = useRef(null)

    const { viewport } = canvas
    // Connectors have no transform box — exclude them so a selected connector
    // shows no resize/rotate handles (it's highlighted in ConnectorLayer instead).
    // Locked items keep their selection outline but get no handles.
    const boxItems = selectedItems.filter(it => it.type !== 'connector')
    const locked = boxItems.some(it => it.payload?.locked)
    const hasSel = boxItems.length > 0
    const box = hasSel ? getSelectionBounds(boxItems) : null
    // The filled move-region is only interactive when a Konva graphic is selected
    // (those have no DOM node to drag). For card-only selections it stays
    // non-interactive so the card's own ×/links/checkbox and drag keep working.
    const moveInteractive = !locked && boxItems.some(it => it.type === 'stroke' || it.type === 'shape' || it.type === 'image')
    // A lone frame is grabbed by its border/title only, so clicks inside it
    // still reach the things placed on it.
    const frameOnly = boxItems.length > 0 && boxItems.every(isFrame)
    // A lone line/arrow shape is edited by its ends (and middle), not a box.
    const lineItem = (selectedItems.length === 1 && boxItems.length === 1 && boxItems[0].type === 'shape'
        && isLineKind(boxItems[0].payload?.kind) && !locked) ? boxItems[0] : null
    const lineH = lineItem ? lineHandles(lineItem) : null

    // Shape that should show the 4 connection dots: the hovered shape, else a
    // single selected shape.
    const connectable = (it) => it && it.type === 'shape' && !isFrame(it) && !isLineKind(it.payload?.kind)
    const dotItem = (() => {
        if (canvas.hoverId != null) {
            const h = items.find(it => it.id === canvas.hoverId)
            if (connectable(h)) return h
        }
        if (boxItems.length === 1 && connectable(boxItems[0]) && !locked) return boxItems[0]
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
        const wasPending = dragRef.current.pending
        dragRef.current = null
        setGuides([])
        // A press that never moved opened nothing (see applyMove) — nothing to close.
        if (!wasPending) { setGesturing(false); endTransaction() }
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
        // A gesture only really starts once the pointer has moved a few px: a
        // plain click (or the first half of a double-click) must not open an undo
        // step or put up the full-screen drag shield, which would swallow the
        // dblclick that opens text editing.
        if (d.pending) {
            if (Math.hypot(e.clientX - d.startClient.x, e.clientY - d.startClient.y) < 3) return
            d.pending = false
            beginTransaction()
            setGesturing(true)
        }
        const p = worldFromClient(e)

        if (d.mode === 'line') {
            let to = p
            // Shift: keep the dragged end at 0/45/90° from the other end.
            if (e.shiftKey && d.which !== 'mid') {
                const o = d.which === 'start' ? d.ends.end : d.ends.start
                const len = Math.hypot(p.x - o.x, p.y - o.y)
                const a = Math.round(Math.atan2(p.y - o.y, p.x - o.x) / (Math.PI / 4)) * (Math.PI / 4)
                to = { x: o.x + Math.cos(a) * len, y: o.y + Math.sin(a) * len }
            }
            updateItem(d.id, dragLineHandle(d.item, d.which, to))
            return
        }

        if (d.mode === 'bend') {
            updateItem(d.connId, { payload: { ...d.payload, bend: { dx: Math.round(p.x - d.mid.x), dy: Math.round(p.y - d.mid.y) } } })
            return
        }

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

    const startGesture = (e, init, list = boxItems) => {
        e.preventDefault()
        e.stopPropagation()
        const riders = (init.riders || []).map(it => ({ id: it.id, box: getItemBounds(it) }))
        dragRef.current = {
            ...init,
            snap: [...list.map(it => ({ id: it.id, box: getItemBounds(it) })), ...riders],
            startWorld: worldFromClient(e),
            startClient: { x: e.clientX, y: e.clientY },
            pending: true,
        }
        window.addEventListener('pointermove', onWindowMove)
        window.addEventListener('pointerup', onWindowUp)
    }

    // Move `list` (and, for frames, what sits on them).
    const startMove = (e, list) => {
        const moving = list.filter(it => it.type !== 'connector' && !it.payload?.locked)
        if (!moving.length) return false
        const selIds = new Set(moving.map(it => it.id))
        // A frame carries what sits on it. Decided now, at grab time, from where
        // things are — not stored — so there is no membership to keep in sync.
        const riders = []
        for (const f of moving.filter(isFrame)) {
            for (const c of frameChildren(f, items || [])) {
                if (!selIds.has(c.id) && !c.payload?.locked) { selIds.add(c.id); riders.push(c) }
            }
        }
        startGesture(e, {
            mode: 'move',
            baseAABB: unionAABB(moving),
            others: (items || []).filter(it => !selIds.has(it.id)),
            riders,
        }, moving)
        return true
    }
    const onMoveDown = (e) => { startMove(e, boxItems) }

    // Drag the middle of an arrow to bend it. Stored as an offset from the
    // midpoint of its two ends, so it follows the shapes it joins.
    const onBendDown = (conn, ends) => (e) => {
        startGesture(e, {
            mode: 'bend', connId: conn.id, payload: conn.payload || {},
            mid: { x: (ends.from.x + ends.to.x) / 2, y: (ends.from.y + ends.to.y) / 2 },
        }, [])
    }
    const onBendReset = (conn) => (e) => {
        e.stopPropagation()
        const { bend: _b, ...rest } = conn.payload || {}
        beginTransaction(); updateItem(conn.id, { payload: rest }); endTransaction()
    }

    // ---- connector drag — unified for CREATE (drag from a shape's dot) and EDIT
    // (drag an endpoint of a selected connector). One end is FIXED, the other
    // MOVES with the cursor; on drop the moving end links to the facing side of
    // the shape under the cursor, or becomes a free point on empty canvas. Not a
    // transaction — create is one addItem, edit is one history-wrapped update. ----
    const onConnectorUp = (e) => {
        const d = connectorRef.current
        if (!d) return
        window.removeEventListener('pointermove', onConnectorMove)
        window.removeEventListener('pointerup', onConnectorUp)
        connectorRef.current = null
        setDropTarget(null)
        if (canvas.activeConnectorRef) canvas.activeConnectorRef.current = null  // stop the preview loop
        const dist = Math.hypot(d.movingPoint.x - d.fixedPoint.x, d.movingPoint.y - d.fixedPoint.y)
        const clicked = !d.targetId && dist <= 6 / viewport.zoom
        if (d.mode === 'create' && clicked) {
            // A plain click on a dot: the next box that way, already connected (spec §9.7).
            onQuickAdd?.(d.fromId, d.fromSide)
        } else if (d.mode === 'create' && !d.targetId && !e?.altKey && onQuickAddAt) {
            // Released on empty canvas: a new box right there, joined to this one.
            // (Alt+release leaves a free-ended arrow instead.)
            onQuickAddAt(d.fromId, d.fromSide, { x: d.movingPoint.x, y: d.movingPoint.y })
        } else if (!clicked) {
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
            .filter(it => connectable(it) && it.id !== d.excludeId)
            .sort((a, b) => (b.z_index ?? 0) - (a.z_index ?? 0))
        // Generous: near the target's edge counts, so you needn't land inside it.
        const pad = DROP_PAD_PX / viewport.zoom
        let hit = null
        for (const it of targets) { if (itemHitTest(it, world.x, world.y, pad)) { hit = it; break } }
        if (hit) {
            // Over one of the target's ports → that side; else the side facing the fixed end.
            const anchors = getOrientedAnchors(getItemBounds(hit))
            const near = SIDES.find(sd => Math.hypot(anchors[sd].x - world.x, anchors[sd].y - world.y) <= (DOT_HIT + 4) / viewport.zoom)
            const side = near || facingSide(hit, d.fixedPoint)
            d.targetId = hit.id; d.targetSide = side
            d.movingPoint = anchors[side]
        } else {
            d.targetId = null; d.targetSide = null
            d.movingPoint = world
        }
        const key = d.targetId ? `${d.targetId}:${d.targetSide}` : null
        if (key !== d.dropKey) { d.dropKey = key; setDropTarget(d.targetId ? { id: d.targetId, side: d.targetSide } : null) }
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

    // CREATE: drag out from one of a shape's 4 connection dots (or from anywhere
    // in a dot's magnet radius — the canvas calls this through overlayApiRef).
    const startConnectorFrom = (e, item, side) => {
        if (!connectable(item) || item.payload?.locked) return false
        e.preventDefault()
        e.stopPropagation()
        const fromPoint = getOrientedAnchors(getItemBounds(item))[side]
        beginConnectorDrag({
            mode: 'create', fromId: item.id, fromSide: side, excludeId: item.id,
            fixedPoint: fromPoint, movingPoint: fromPoint, headIsMoving: true,
            targetId: null, targetSide: null, routing: 'elbow',
        })
        return true
    }
    const onConnectorDotDown = (side) => (e) => { if (dotItem) startConnectorFrom(e, dotItem, side) }

    // Gestures the canvas starts from its own pointerdown: press-and-drag an
    // unselected item, or begin an arrow from a magnetised dot. Republished every
    // render so they always close over the current items.
    if (canvas.overlayApiRef) {
        canvas.overlayApiRef.current = {
            beginMove: (e, ids) => {
                const set = new Set(ids)
                return startMove(e, (items || []).filter(it => set.has(it.id)))
            },
            beginConnectorFrom: (e, id, side) => startConnectorFrom(e, (items || []).find(it => it.id === id), side),
        }
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

    // Drag a line/arrow shape's end or middle. Each frame is computed from the
    // item as it was at the press (no compounding).
    const onLineHandleDown = (which) => (e) => {
        startGesture(e, { mode: 'line', which, id: lineItem.id, item: lineItem, ends: lineH }, [])
    }
    const onLineStraighten = (e) => {
        e.stopPropagation()
        beginTransaction(); updateItem(lineItem.id, straightenLine(lineItem)); endTransaction()
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

                {box && locked && (
                    <polygon points={outlinePts} fill="none" stroke="var(--text-muted)" strokeWidth={1.5} strokeDasharray="4 3" />
                )}
                {lineH && (() => {
                    const a = screenOf(lineH.start), b = screenOf(lineH.end)
                    const m = lineH.mid ? screenOf(lineH.mid) : null
                    const knob = (key, pt, which, title, filled) => (
                        <g key={key} style={{ pointerEvents: 'auto', cursor: which === 'mid' ? 'move' : 'grab' }}
                            onPointerDown={onLineHandleDown(which)}
                            onDoubleClick={which === 'mid' && lineH.curved ? onLineStraighten : undefined}>
                            <title>{title}</title>
                            <circle cx={pt.x} cy={pt.y} r={12} fill="transparent" />
                            <circle cx={pt.x} cy={pt.y} r={6} fill={filled ? 'var(--accent-warning)' : 'var(--bg-surface)'}
                                stroke="var(--accent-warning)" strokeWidth={2} />
                        </g>
                    )
                    return (
                        <g>
                            {knob('ls', a, 'start', 'Drag to move this end (Shift: straight angles)')}
                            {knob('le', b, 'end', 'Drag to move this end (Shift: straight angles)')}
                            {m && knob('lm', m, 'mid', lineH.curved ? 'Drag to bend · double-click to straighten' : 'Drag to bend', lineH.curved)}
                        </g>
                    )
                })()}

                {box && !locked && !lineItem && (
                    <>
                        {/* move region — interior of the selection box.
                            data-sb-move marks it as the shape body (not a true
                            handle) so a double-click here still opens text edit. */}
                        <polygon
                            data-sb-move="true"
                            points={outlinePts}
                            fill={moveInteractive && !frameOnly ? 'rgba(240,184,64,0.04)' : 'none'}
                            stroke="var(--accent-warning)"
                            strokeWidth={1.5}
                            style={{ pointerEvents: moveInteractive && !frameOnly ? 'auto' : 'none', cursor: 'move' }}
                            onPointerDown={moveInteractive && !frameOnly ? onMoveDown : undefined}
                        />
                        {/* a frame: grab its border band or its title */}
                        {frameOnly && (
                            <polygon data-sb-move="true" points={outlinePts} fill="none" stroke="transparent" strokeWidth={14}
                                style={{ pointerEvents: 'stroke', cursor: 'move' }} onPointerDown={onMoveDown} />
                        )}
                        {frameOnly && boxItems.map(f => {
                            const t = frameTitleRect(f, viewport.zoom)
                            const a = screenOf({ x: t.x, y: t.y })
                            return <rect key={`ft-${f.id}`} data-sb-move="true" x={a.x} y={a.y} width={t.w * viewport.zoom} height={t.h * viewport.zoom}
                                fill="transparent" style={{ pointerEvents: 'auto', cursor: 'move' }} onPointerDown={onMoveDown} />
                        })}
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
                {dotItem && !dropTarget && (() => {
                    const b = getItemBounds(dotItem)
                    const a = getOrientedAnchors(b)
                    const c = screenOf(boxCenter(b))
                    return SIDES.map(side => {
                        const base = screenOf(a[side])
                        const dx = base.x - c.x, dy = base.y - c.y
                        const len = Math.hypot(dx, dy) || 1
                        const cx = base.x + (dx / len) * DOT_OUT, cy = base.y + (dy / len) * DOT_OUT
                        const hot = hotDot === side || (canvas.hoverId === dotItem.id && canvas.hoverSide === side)
                        return (
                            <g key={`dot-${side}`} data-sb-handle="true"
                                style={{ pointerEvents: 'auto', cursor: 'crosshair' }}
                                onPointerEnter={() => setHotDot(side)}
                                onPointerLeave={() => setHotDot(h => (h === side ? null : h))}
                                onPointerDown={onConnectorDotDown(side)}>
                                <title>Drag to connect · click for a connected box</title>
                                {/* invisible, larger hit target */}
                                <circle cx={cx} cy={cy} r={DOT_HIT} fill="transparent" />
                                {/* magnet ring: the pointer is "caught" by this dot */}
                                {hot && <circle cx={cx} cy={cy} r={DOT_HIT} fill="rgba(240,184,64,0.18)" stroke="var(--accent-warning)" strokeWidth={1} />}
                                <circle cx={cx} cy={cy} r={hot ? DOT_R + 2 : DOT_R}
                                    fill="var(--accent-warning)" stroke="var(--bg-surface)" strokeWidth={1.5} />
                            </g>
                        )
                    })
                })()}

                {/* while dragging a connector end: the target's ports, the chosen one lit */}
                {dropTarget && (() => {
                    const t = (items || []).find(it => it.id === dropTarget.id)
                    if (!t) return null
                    const a = getOrientedAnchors(getItemBounds(t))
                    const o = ['nw', 'ne', 'se', 'sw'].map(k => { const p = screenOf(a[k]); return `${p.x},${p.y}` }).join(' ')
                    return (
                        <g>
                            <polygon points={o} fill="none" stroke="#5a9cf0" strokeWidth={1.5} />
                            {SIDES.map(side => {
                                const p = screenOf(a[side])
                                const on = side === dropTarget.side
                                return <circle key={`port-${side}`} cx={p.x} cy={p.y} r={on ? 7 : 4}
                                    fill={on ? '#5a9cf0' : 'var(--bg-surface)'} stroke="#5a9cf0" strokeWidth={1.5} />
                            })}
                        </g>
                    )
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

                {/* bend handle — the middle of the selected arrow; drag to bend,
                    double-click to straighten back to the automatic route */}
                {connEnds && selConnector && (() => {
                    const pts = connectorPoints(selConnector, new Map((items || []).map(i => [i.id, i])))
                    const mid = pts && connectorMidpoint(pts)
                    if (!mid) return null
                    const m = screenOf(mid)
                    const bent = !!selConnector.payload?.bend
                    return (
                        <g style={{ pointerEvents: 'auto', cursor: 'move' }}
                            onPointerDown={onBendDown(selConnector, connEnds)}
                            onDoubleClick={bent ? onBendReset(selConnector) : undefined}>
                            <title>{bent ? 'Drag to bend · double-click to reset' : 'Drag to bend this arrow'}</title>
                            <circle cx={m.x} cy={m.y} r={12} fill="transparent" />
                            <circle cx={m.x} cy={m.y} r={6} fill={bent ? 'var(--accent-warning)' : 'var(--bg-surface)'}
                                stroke="var(--accent-warning)" strokeWidth={2} />
                        </g>
                    )
                })()}

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
