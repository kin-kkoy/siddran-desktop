import { useCallback } from 'react'
import { newSandboxItemId } from './useSandbox'
import { facingSide } from '../components/Sandbox/connectors/geometry'
import { tidy, itemsToFlow, nodeSize } from '../components/Sandbox/flow/flowText'
import { itemsToGraph, planDiagram, isDiagramShape } from '../components/Sandbox/flow/flowGraph'
import { unionAABB } from '../components/Sandbox/selection/snapping'
import { toast } from '../utils/toast'

// Building a flowchart without a pen, or without much mouse at all.
//
// The slow part of diagramming by hand is not drawing a box — it is drawing the
// box, positioning it under the last one, then dragging an arrow between them,
// forty times. So the core move here is "next": from a selected box, Tab makes
// the following step already placed, already connected, already in text-edit.
// A whole process can be typed: text, Tab, text, Tab.
//
// Every action is one undo step.

const GAP = 72
const OPPOSITE = { n: 's', s: 'n', e: 'w', w: 'e' }

// Is a w×h box at (x, y) clear of everything already on the board?
function clear(items, x, y, w, h, ignore) {
    return !items.some((it) => it.type !== 'connector' && it.id !== ignore &&
        x < it.x + (it.w || 0) + 16 && it.x < x + w + 16 && y < it.y + (it.h || 0) + 16 && it.y < y + h + 16)
}

// The spot `dir` of `from`, slid sideways (right first, then left, further each
// time) until nothing is in the way — so the third branch of a decision lands
// beside the second instead of on top of it.
function placeNext(items, from, dir, w, h) {
    const cx = from.x + from.w / 2, cy = from.y + from.h / 2
    const base = {
        s: { x: cx - w / 2, y: from.y + from.h + GAP },
        n: { x: cx - w / 2, y: from.y - GAP - h },
        e: { x: from.x + from.w + GAP, y: cy - h / 2 },
        w: { x: from.x - GAP - w, y: cy - h / 2 },
    }[dir]
    const vertical = dir === 's' || dir === 'n'
    const step = vertical ? w + 40 : h + 32
    for (let k = 0; k < 40; k++) {
        const off = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * step
        const x = Math.round(base.x + (vertical ? off : 0)), y = Math.round(base.y + (vertical ? 0 : off))
        if (clear(items, x, y, w, h)) return { x, y }
    }
    return { x: Math.round(base.x), y: Math.round(base.y) }
}

export function useFlowActions({ items, act, beginTransaction, endTransaction, canvas, nextZ, bump, setEditingShapeId, viewportCenter }) {
    const connectorPayload = useCallback((fromId, fromSide, toId, toSide, extra = {}) => ({
        from: { itemId: fromId, side: fromSide }, to: { itemId: toId, side: toSide },
        routing: 'elbow', head: 'arrow', stroke: canvas.strokeColor, strokeWidth: 2, ...extra,
    }), [canvas.strokeColor])

    // A fresh box in the board's current style.
    const boxPayload = useCallback((kind, text = '') => ({
        kind, fill: canvas.shapeStyle.fill, stroke: canvas.shapeStyle.stroke, strokeWidth: canvas.shapeStyle.strokeWidth || 2,
        radius: kind === 'roundedRect' ? 10 : 0, text, textAlign: 'center', textColor: canvas.shapeStyle.stroke, fontSize: 16,
    }), [canvas.shapeStyle])

    /** Tab / Alt+Arrow: the next step `dir` of box `fromId`, connected, in text-edit. */
    const createNext = useCallback((fromId, dir = 's') => {
        const from = items.find((i) => i.id === fromId)
        if (!from || from.type !== 'shape') return null
        // Same look as where it came from — except after a decision, whose
        // branches are steps, not more questions.
        const kind = from.payload?.kind === 'rhombus' ? 'roundedRect' : (from.payload?.kind || 'roundedRect')
        const w = from.payload?.kind === 'rhombus' ? 160 : from.w
        const h = from.payload?.kind === 'rhombus' ? 64 : from.h
        const at = placeNext(items, from, dir, w, h)
        const id = newSandboxItemId()
        const z = nextZ()
        beginTransaction()
        act.addItem({ id, type: 'shape', ...at, w, h, rotation: 0, z_index: z, payload: { ...from.payload, kind, radius: kind === 'roundedRect' ? 10 : (from.payload?.radius || 0), text: '', locked: undefined, groupId: undefined } })
        act.addItem({ type: 'connector', x: 0, y: 0, w: 0, h: 0, rotation: 0, z_index: z + 1, payload: connectorPayload(fromId, dir, id, OPPOSITE[dir]) })
        endTransaction()
        canvas.selectOnly(id)
        setEditingShapeId(id)
        bump()
        return id
    }, [items, act, beginTransaction, endTransaction, canvas, nextZ, bump, setEditingShapeId, connectorPayload])

    /**
     * A connector dragged from box `fromId` and released on empty canvas: a box
     * like the source, centred on the drop point, joined on the side facing back.
     */
    const createConnectedAt = useCallback((fromId, fromSide, world) => {
        const from = items.find((i) => i.id === fromId)
        if (!from || from.type !== 'shape') return null
        const decision = from.payload?.kind === 'rhombus'
        const kind = decision ? 'roundedRect' : (from.payload?.kind || 'roundedRect')
        const w = decision ? 160 : from.w, h = decision ? 64 : from.h
        const id = newSandboxItemId()
        const box = { id, type: 'shape', x: Math.round(world.x - w / 2), y: Math.round(world.y - h / 2), w, h, rotation: 0 }
        const centre = { x: from.x + from.w / 2, y: from.y + from.h / 2 }
        const z = nextZ()
        beginTransaction()
        act.addItem({ ...box, z_index: z, payload: { ...from.payload, kind, radius: kind === 'roundedRect' ? 10 : (from.payload?.radius || 0), text: '', locked: undefined, groupId: undefined } })
        act.addItem({ type: 'connector', x: 0, y: 0, w: 0, h: 0, rotation: 0, z_index: z + 1, payload: connectorPayload(fromId, fromSide, id, facingSide(box, centre)) })
        endTransaction()
        canvas.selectOnly(id)
        setEditingShapeId(id)
        bump()
        return id
    }, [items, act, beginTransaction, endTransaction, canvas, nextZ, bump, setEditingShapeId, connectorPayload])

    /** Shift+Tab: another child of this box's parent, beside it (the next branch). */
    const createSibling = useCallback((id) => {
        const into = items.find((i) => i.type === 'connector' && i.payload?.to?.itemId === id)
        if (!into?.payload?.from?.itemId) return createNext(id, 'e')
        return createNext(into.payload.from.itemId, into.payload.from.side || 's')
    }, [items, createNext])

    /** Double-click on empty canvas: a box right there, ready to type in. */
    const createAt = useCallback((world) => {
        const { w, h } = nodeSize('', 'roundedRect')
        const id = newSandboxItemId()
        act.addItem({ id, type: 'shape', x: Math.round(world.x - w / 2), y: Math.round(world.y - h / 2), w, h, rotation: 0, z_index: nextZ(), payload: boxPayload('roundedRect') })
        canvas.setTool('pointer')
        canvas.selectOnly(id)
        setEditingShapeId(id)
        bump()
        return id
    }, [act, nextZ, boxPayload, canvas, setEditingShapeId, bump])

    /** C with two boxes selected: an arrow from the first picked to the second. */
    const connectSelected = useCallback(() => {
        const sel = [...canvas.selectedIds].map((id) => items.find((i) => i.id === id)).filter((i) => i && i.type !== 'connector')
        if (sel.length !== 2) { toast.warning('Select two boxes to connect them'); return }
        const [a, b] = sel
        const centre = (i) => ({ x: i.x + (i.w || 0) / 2, y: i.y + (i.h || 0) / 2 })
        act.addItem({ type: 'connector', x: 0, y: 0, w: 0, h: 0, rotation: 0, z_index: nextZ(), payload: connectorPayload(a.id, facingSide(a, centre(b)), b.id, facingSide(b, centre(a))) })
        canvas.selectOnly(b.id)
        bump()
    }, [canvas, items, act, nextZ, connectorPayload, bump])

    /** Tidy: lay the selected boxes (or the whole board) out along their arrows. */
    const tidySelection = useCallback((dir = 'down') => {
        const picked = items.filter((i) => i.type === 'shape' && canvas.selectedIds.has(i.id))
        const shapes = picked.length >= 2 ? picked : items.filter((i) => i.type === 'shape')
        if (shapes.length < 2) { toast.warning('Nothing to tidy yet — add a few connected boxes'); return }
        const { moves, resides } = tidy(shapes, items.filter((i) => i.type === 'connector'), dir)
        beginTransaction()
        for (const m of moves) act.updateItem(m.id, { x: m.x, y: m.y })
        for (const r of resides) {
            const c = items.find((i) => i.id === r.id)
            if (c) act.updateItem(r.id, { payload: { ...c.payload, from: { ...c.payload.from, side: r.from }, to: { ...c.payload.to, side: r.to } } })
        }
        endTransaction()
        bump()
    }, [items, canvas.selectedIds, act, beginTransaction, endTransaction, bump])

    /**
     * The selected diagram, ready for the node editor: its graph, where it sits,
     * and which items it is made of (so Update knows what it may change).
     * Null when nothing diagram-like is selected. Locked boxes stay out of it.
     */
    const diagramSource = useCallback(() => {
        const shapes = items.filter((i) => canvas.selectedIds.has(i.id) && isDiagramShape(i) && !i.payload?.locked)
        if (!shapes.length) return null
        const ids = new Set(shapes.map((i) => i.id))
        const links = items.filter((i) => i.type === 'connector' && ids.has(i.payload?.from?.itemId) && ids.has(i.payload?.to?.itemId))
        const { graph, origin } = itemsToGraph([...shapes, ...links])
        return { graph, origin, scope: { shapeIds: shapes.map((i) => i.id), connectorIds: links.map((i) => i.id) } }
    }, [items, canvas.selectedIds])

    /**
     * A graph from the Diagram pop-up onto the board, as one undo step. New
     * (`source` null): laid out beside what is there. Opened from the board:
     * re-laid-out where it was, changing those items in place.
     */
    const applyDiagram = useCallback((graph, source = null) => {
        if (!graph?.nodes?.length) return false
        let origin = source?.origin
        if (!origin) {
            const b = unionAABB(items.filter((i) => i.type !== 'connector'))
            const c = viewportCenter()
            origin = b && b.w > 0 ? { x: Math.round(b.x + b.w + 160), y: Math.round(b.y) } : { x: Math.round(c.x - 200), y: Math.round(c.y - 200) }
        }
        const style = { stroke: canvas.shapeStyle.stroke, text: canvas.shapeStyle.stroke, fill: canvas.shapeStyle.fill, font: 16 }
        const plan = planDiagram(graph, { items, scope: source?.scope, origin, style, newId: newSandboxItemId })
        let z = nextZ()
        beginTransaction()
        for (const id of plan.remove) act.removeItem(id)
        for (const u of plan.update) act.updateItem(u.id, u.patch)
        for (const it of plan.add) act.addItem({ ...it, z_index: z++ })
        endTransaction()
        canvas.setSelection(new Set(plan.shapeIds))
        bump()
        return true
    }, [items, viewportCenter, canvas, nextZ, act, beginTransaction, endTransaction, bump])

    /** The selection (or whole board) as flowchart text — paste it to an AI, or into a note. */
    const copyAsText = useCallback(async () => {
        const sel = items.filter((i) => canvas.selectedIds.has(i.id))
        const scope = sel.some((i) => i.type === 'shape') ? [...sel, ...items.filter((i) => i.type === 'connector')] : items
        const text = itemsToFlow(scope)
        try { await navigator.clipboard.writeText(text); toast.success('Copied the diagram as text') }
        catch { toast.error('Could not reach the clipboard') }
    }, [items, canvas.selectedIds])

    return { createNext, createSibling, createAt, createConnectedAt, connectSelected, tidySelection, diagramSource, applyDiagram, copyAsText }
}
