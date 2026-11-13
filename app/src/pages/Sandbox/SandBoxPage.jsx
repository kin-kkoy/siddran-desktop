import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ExpandSidebarButton from '../../components/Layout/Sidebar/ExpandSidebarButton'
import styles from './SandBoxPage.module.css'
import { useSandboxes } from '../../hooks/useSandboxes'
import { useSandbox } from '../../hooks/useSandbox'
import { useSandboxCanvas } from '../../hooks/useSandboxCanvas'
import { useSandboxHistory } from '../../hooks/useSandboxHistory'
import SandboxCanvas from '../../components/Sandbox/Canvas/SandboxCanvas'
import SandboxToolbar from '../../components/Sandbox/Toolbar/SandboxToolbar'
import DrawFlyout from '../../components/Sandbox/Toolbar/DrawFlyout'
import AttachedNoteCard from '../../components/Sandbox/Cards/AttachedNoteCard'
import AttachedTaskCard from '../../components/Sandbox/Cards/AttachedTaskCard'
import TextBoxCard from '../../components/Sandbox/Cards/TextBoxCard'
import SandboxPdfCard from '../../components/Sandbox/Cards/SandboxPdfCard'
import NavArrows from '../../components/Common/NavArrows'
import { attachPdfViaPicker } from '../../desktop/media'
import NoteAttachPicker from '../../components/Sandbox/Cards/NoteAttachPicker'
import TaskAttachPicker from '../../components/Sandbox/Cards/TaskAttachPicker'
import SelectionOverlay from '../../components/Sandbox/selection/SelectionOverlay'
import ContextToolbar from '../../components/Sandbox/selection/ContextToolbar'
import ShapeTextEditor from '../../components/Sandbox/selection/ShapeTextEditor'
import { sortByZ, reorder } from '../../components/Sandbox/selection/zorder'
import { alignPatches } from '../../components/Sandbox/selection/align'
import { unionAABB } from '../../components/Sandbox/selection/snapping'
import { exportStagePNG } from '../../components/Sandbox/Canvas/exportImage'
import ShortcutsModal from '../../components/Sandbox/Toolbar/ShortcutsModal'
import DiagramModal from '../../components/Sandbox/flow/DiagramModal'
import TemplatesModal from '../../components/Sandbox/templates/TemplatesModal'
import FrameTitleEditor from '../../components/Sandbox/frames/FrameTitleEditor'
import { isFrame, framePayload, nextFrameTitle } from '../../components/Sandbox/frames/frames'
import { isFormat, formatPayload, nextFormatTitle, FORMAT_SIZE } from '../../components/Sandbox/formats/formats'
import FormatWidget, { FormatFocus } from '../../components/Sandbox/formats/FormatWidget'
import { attachPatches, stampPatches, boardClips, cutLabel, widgetBorne } from '../../components/Sandbox/selection/attach'
import { getSnapshot as boardItemsNow } from '../../hooks/sandboxItemsStore'
import { STICKY_DEFAULT, stepFontSize } from '../../components/Sandbox/text/textStyle'
import { newSandboxItemId } from '../../hooks/useSandbox'
import { isInkTool } from '../../components/Sandbox/ink/presets'
import { paintPayload } from '../../components/Sandbox/ink/paint'
import { eraseFromStroke } from '../../components/Sandbox/ink/precisionErase'
import { recognizeStroke, shapeFromRecognition } from '../../components/Sandbox/ink/recognize'
import { highlighterZ } from '../../components/Sandbox/ink/highlighterZ'
import { strokeOutline } from '../../components/Sandbox/Canvas/strokeOutline'
import { useFlowActions } from '../../hooks/useFlowActions'
import { SHAPE_TOOLS } from '../../components/Sandbox/shapes/registry'
import { useSandboxView } from '../../contexts/SandboxViewContext'
import { useApi } from '../../contexts/ApiContext'
import { uploadImageFile } from '../../utils/imageUpload'
import { toast } from '../../utils/toast'

const CARD_TYPES = new Set(['note', 'task', 'text', 'pdf'])

const isEditable = (el) => {
    if (!el) return false
    const tag = el.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

// Per-shape keys were dropped — `S` opens the shape picker and the shape is
// chosen with the mouse/pen instead.
const TOOL_KEYS = { v: 'pointer', g: 'lasso', p: 'pen', e: 'eraser', t: 'text', h: 'hand', n: 'sticky', f: 'frame' }
// Pressing a tool's key while on that tool flips to its sibling (spec §10.1:
// "P again"); pressing it on the sibling comes back.
const TOOL_TOGGLES = { pointer: 'hand', pen: 'highlighter', eraser: 'precisionEraser' }
const PAN_HINT = 'PAN · SPACE-DRAG · MIDDLE-DRAG · TWO FINGERS · V TWICE'

// What "copy style" carries (Ctrl+Alt+C / Ctrl+Alt+V) — looks, never content.
const STYLE_KEYS = ['fill', 'stroke', 'strokeWidth', 'lineStyle', 'dash', 'radius', 'textColor', 'color', 'fontSize',
    'fontFamily', 'bold', 'italic', 'underline', 'strike', 'textAlign', 'verticalAlign', 'lineHeight', 'bg',
    'head', 'headStart', 'routing']
const CONNECTOR_STYLE = new Set(['stroke', 'strokeWidth', 'lineStyle', 'dash', 'head', 'headStart', 'routing'])

// The tool a board opens with is the one you last used — a pen user lands on the
// pen, everyone else on Select. Defaulting to the pen made a mouse user's first
// click a scribble.
const TOOL_KEY = 'siddran_sandbox_tool'
const ARROW_DIRS = { ArrowDown: 's', ArrowUp: 'n', ArrowRight: 'e', ArrowLeft: 'w' }
function rememberedTool() {
    try { return localStorage.getItem(TOOL_KEY) || 'pointer' } catch { return 'pointer' }
}

// Load an image File into an <img> so we can read its natural size.
function loadImageFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
            const img = new window.Image()
            img.onload = () => resolve({ img, dataURL: reader.result })
            img.onerror = reject
            img.src = reader.result
        }
        reader.onerror = reject
        reader.readAsDataURL(file)
    })
}
// Read natural dims and produce a Blob to upload to R2. Large images are downscaled
// to a JPEG blob (keeps R2 objects small); small ones upload as-is.
async function prepareImageBlob(file, maxStore = 1280) {
    const { img } = await loadImageFile(file)
    const nW = img.naturalWidth, nH = img.naturalHeight
    if (Math.max(nW, nH) <= maxStore) {
        return { blob: file, naturalW: nW, naturalH: nH }
    }
    const scale = maxStore / Math.max(nW, nH)
    const cw = Math.round(nW * scale), ch = Math.round(nH * scale)
    const c = document.createElement('canvas')
    c.width = cw; c.height = ch
    c.getContext('2d').drawImage(img, 0, 0, cw, ch)
    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.85))
    return { blob: blob || file, naturalW: nW, naturalH: nH }
}

// A shape the shapes menu draws (not a sticky or frame, which have their own buttons).
const isPlainShapeTool = (t) => SHAPE_TOOLS.includes(t) && t !== 'sticky' && t !== 'frame'

function SandBoxPage({ notes, tasks = [], toggleTaskCompletion, mode = 'full', sandboxIdOverride }) {
    const { id: paramId } = useParams()
    const sandboxId = sandboxIdOverride ?? paramId
    const navigate = useNavigate()
    const view = useSandboxView()
    const { authFetch, API } = useApi()

    const { sandboxes, rename, touch } = useSandboxes()
    const sandbox = sandboxes.find(s => s.id === sandboxId)
    const base = useSandbox(sandboxId)
    const { items } = base
    const history = useSandboxHistory(base)
    const { do: act, undo, redo, canUndo, canRedo, beginTransaction, endTransaction } = history
    const canvas = useSandboxCanvas(mode === 'half' ? 'pointer' : rememberedTool())
    useEffect(() => {
        if (mode === 'half') return
        try { localStorage.setItem(TOOL_KEY, canvas.tool) } catch { /* private window — just not remembered */ }
    }, [canvas.tool, mode])

    const [notePickerOpen, setNotePickerOpen] = useState(false)
    const [taskPickerOpen, setTaskPickerOpen] = useState(false)
    const [titleDraft, setTitleDraft] = useState(sandbox?.title ?? '')
    const [shortcutsOpen, setShortcutsOpen] = useState(false)
    // The dock's menus — shapes, media, paint bucket — and the drawing flyout
    // share one slot: opening one closes the others (the flyout hides while a
    // menu is up).
    const [openMenu, setOpenMenu] = useState(null)   // 'shapes' | 'insert' | 'paint' | null
    const [editingShapeId, setEditingShapeId] = useState(null)
    // The Diagram pop-up: null when closed, else { source } — null for a new
    // diagram, or the selected one (flow.diagramSource) to edit in place.
    const [diagram, setDiagram] = useState(null)
    const [templatesOpen, setTemplatesOpen] = useState(false)
    const [editingFrameId, setEditingFrameId] = useState(null)
    const [textEditReq, setTextEditReq] = useState(null)   // { id, n } — asks a text card to enter edit mode
    const [focusFormatId, setFocusFormatId] = useState(null)       // a Format widget shown full screen
    const [renamingFormatId, setRenamingFormatId] = useState(null) // a Format widget whose title is being edited
    const styleClipRef = useRef(null)
    const fileRef = useRef(null)
    const stageRef = useRef(null)
    const topStageRef = useRef(null)   // the top canvas (above the widgets)

    useEffect(() => { setTitleDraft(sandbox?.title ?? '') }, [sandbox?.id, sandbox?.title])

    useEffect(() => {
        if (sandboxId) {
            try { localStorage.setItem('cinder_last_sandbox', sandboxId) } catch { /* ignore */ }
            view.setActiveSandboxId?.(sandboxId)
        }
    }, [sandboxId, view])

    const bump = useCallback(() => { if (sandboxId) touch(sandboxId) }, [sandboxId, touch])
    const nextZ = useCallback(() => items.reduce((m, it) => Math.max(m, it.z_index ?? 0), 0) + 1, [items])
    // Add a card (or widget): if it lands on a widget it attaches straight away
    // (or the frame it's inside — selection/attach.js) — one undo step for both.
    const addCard = useCallback((partial) => {
        beginTransaction()
        const created = act.addItem(partial)
        for (const p of attachPatches([created.id], boardItemsNow(sandboxId))) act.updateItem(p.id, { payload: p.payload })
        endTransaction()
        return created
    }, [act, beginTransaction, endTransaction, sandboxId])

    // Item buckets, z-sorted for paint order. Strokes + shapes + images share
    // ONE Konva layer so z-order works across all graphic types.
    // Format widgets are shapes in the file but DOM windows on screen, drawn
    // with the cards (above the Konva layers).
    // Graphics riding on a widget go on the top canvas, above the widgets
    // (selection/attach.js widgetBorne); so do links between two of them.
    const onWidget = useMemo(() => widgetBorne(items), [items])
    const graphicItems = useMemo(() => sortByZ(items.filter(i => !CARD_TYPES.has(i.type) && i.type !== 'connector' && !isFrame(i) && !isFormat(i) && !onWidget.has(i.id))), [items, onWidget])
    const topGraphicItems = useMemo(() => sortByZ(items.filter(i => onWidget.has(i.id))), [items, onWidget])

    const frameItems = useMemo(() => sortByZ(items.filter(isFrame)), [items])
    const [connectorItems, topConnectorItems] = useMemo(() => {
        const onTop = (c) => onWidget.has(c.payload?.from?.itemId) && onWidget.has(c.payload?.to?.itemId)
        const links = sortByZ(items.filter(i => i.type === 'connector'))
        return [links.filter(c => !onTop(c)), links.filter(onTop)]
    }, [items, onWidget])
    const cardItems = useMemo(() => sortByZ(items.filter(i => CARD_TYPES.has(i.type) || isFormat(i))), [items])
    const selectedItems = useMemo(() => items.filter(i => canvas.selectedIds.has(i.id)), [items, canvas.selectedIds])

    // ---- commits ----
    const onStrokeCommit = useCallback((partial) => {
        // A highlight slides beneath the ink it crosses (ink/highlighterZ.js).
        const z = partial.payload?.highlighter
            ? highlighterZ({ x: partial.x, y: partial.y, w: partial.w, h: partial.h }, items, nextZ())
            : nextZ()
        // Drawn on a widget (or in a frame): attached as it lands.
        const created = addCard({ ...partial, z_index: z })
        bump()
        return created
    }, [addCard, items, nextZ, bump])

    // Smart drawing: the ink lands first (one undo step), then — if it reads as a
    // shape — it is swapped for the clean shape (a second step). So Ctrl+Z
    // after a recognition gives back exactly the ink you drew (spec R10.9).
    const onSmartStroke = useCallback((partial) => {
        const ink = onStrokeCommit(partial)
        const p = partial.payload
        const rec = recognizeStroke(p.points, { minSize: 16 / (canvas.viewport.zoom || 1) })
        if (!rec) { toast.success('Kept as drawing — not a shape I recognise'); return }
        const width = Math.max(2, Math.min(8, Math.round((p.options?.size ?? 6) / 2)))
        const shape = shapeFromRecognition(rec, { stroke: p.color, strokeWidth: width, fill: 'transparent' },
            { points: p.points, options: p.options, color: p.color })
        // The clean shape stays wherever the ink was attached.
        const att = ink.payload?.attachedTo
        beginTransaction()
        act.removeItem(ink.id)
        act.addItem({ ...shape, z_index: ink.z_index, ...(att ? { payload: { ...shape.payload, attachedTo: att } } : null) })
        endTransaction()
        bump()
    }, [onStrokeCommit, canvas.viewport.zoom, act, beginTransaction, endTransaction, bump])

    // "Back to drawing": a recognised shape becomes its ink again, fitted to
    // wherever the shape is now.
    const revertToInk = useCallback((id) => {
        const it = items.find(i => i.id === id)
        const src = it?.payload?.sourceInk
        if (!src?.points?.length || it.payload?.locked) return
        const flat = strokeOutline(src.points, { ...src.options, last: true })
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        for (let i = 0; i < flat.length; i += 2) {
            minX = Math.min(minX, flat[i]); maxX = Math.max(maxX, flat[i])
            minY = Math.min(minY, flat[i + 1]); maxY = Math.max(maxY, flat[i + 1])
        }
        const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY)
        // Grow the shape's box by the ink's own thickness so the line sits where the outline was.
        const pad = (src.options?.size ?? 6) / 2
        beginTransaction()
        act.removeItem(id)
        act.addItem({
            type: 'stroke', x: it.x - pad, y: it.y - pad, w: Math.max(1, it.w + pad * 2), h: Math.max(1, it.h + pad * 2), rotation: it.rotation || 0, z_index: it.z_index,
            payload: {
                flatOutline: flat.map((v, i) => v - (i % 2 === 0 ? minX : minY)), points: src.points,
                color: src.color, options: src.options, baseW: bw, baseH: bh,
                ...(it.payload.groupId ? { groupId: it.payload.groupId } : null),
                ...(it.payload.attachedTo ? { attachedTo: it.payload.attachedTo } : null),
            },
        })
        endTransaction()
        canvas.clearSelection()
        bump()
    }, [items, act, beginTransaction, endTransaction, canvas, bump])

    // Precision eraser. Several cuts can land between two renders, so the
    // gesture keeps its own view of which strokes it has already replaced.
    const precisionRef = useRef(null)
    const itemsRef = useRef(items)
    itemsRef.current = items
    const onPrecisionErase = useCallback((c, r) => {
        const live = precisionRef.current ?? (precisionRef.current = { removed: new Set(), added: new Map() })
        const byId = new Map()
        for (const it of itemsRef.current) if (it.type === 'stroke' && !live.removed.has(it.id)) byId.set(it.id, it)
        for (const [id, it] of live.added) if (!live.removed.has(id)) byId.set(id, it)
        let changed = false
        for (const it of byId.values()) {
            const pieces = eraseFromStroke(it, c, r)
            if (!pieces) continue
            act.removeItem(it.id)
            live.removed.add(it.id)
            live.added.delete(it.id)
            for (const piece of pieces) {
                const created = act.addItem(piece)
                live.added.set(created.id, created)
            }
            changed = true
        }
        if (changed) bump()
    }, [act, bump])
    const onPrecisionEraseEnd = useCallback(() => { precisionRef.current = null }, [])
    const onShapeCommit = useCallback((partial) => {
        const kind = partial.payload?.kind
        if (kind === 'frame') {
            // Frames go to the bottom of the stack, behind what they hold.
            const minZ = items.reduce((m, it) => Math.min(m, it.z_index ?? 0), 0)
            const created = act.addItem({ ...partial, z_index: minZ - 1, payload: framePayload(nextFrameTitle(items)) })
            canvas.setTool('pointer')
            canvas.selectOnly(created.id)
            bump()
            return
        }
        if (kind === 'sticky') {
            const created = addCard({ ...partial, z_index: nextZ(), payload: { kind: 'sticky', fill: STICKY_DEFAULT, text: '', textAlign: 'center' } })
            canvas.setTool('pointer')
            canvas.selectOnly(created.id)
            setEditingShapeId(created.id)
            bump()
            return
        }
        addCard({ ...partial, z_index: nextZ() }); bump()
    }, [act, addCard, nextZ, bump, items, canvas])
    const onCreateConnector = useCallback((payload) => {
        act.addItem({
            type: 'connector', x: 0, y: 0, w: 0, h: 0, rotation: 0, z_index: nextZ(),
            payload: { routing: 'elbow', head: 'arrow', stroke: canvas.strokeColor, strokeWidth: 2, ...payload },
        })
        bump()
    }, [act, nextZ, canvas, bump])

    // ---- selection ----
    const onSelect = useCallback((id, additive) => {
        if (id == null) { canvas.clearSelection(); setEditingShapeId(null); return }
        // A grouped item selects its whole group (spec §4.10).
        const gid = items.find(i => i.id === id)?.payload?.groupId
        const members = gid ? items.filter(i => i.payload?.groupId === gid).map(i => i.id) : [id]
        if (additive) {
            const next = new Set(canvas.selectedIds)
            const on = next.has(id)
            members.forEach(m => (on ? next.delete(m) : next.add(m)))
            canvas.setSelection(next)
        } else if (members.length > 1) canvas.setSelection(new Set(members))
        else canvas.selectOnly(id)
        setEditingShapeId(null)
        setEditingFrameId(null)
    }, [canvas, items])
    const onMarqueeSelect = useCallback((ids, additive) => {
        if (additive) canvas.setSelection(new Set([...canvas.selectedIds, ...ids]))
        else canvas.setSelection(ids)
    }, [canvas])

    // Connectors referencing any of `idSet` (so deleting a shape also removes its
    // links). Excludes connectors already in `idSet`.
    const connectorsAttachedTo = useCallback((idSet) => items.filter(it =>
        it.type === 'connector' && !idSet.has(it.id)
        && (idSet.has(it.payload?.from?.itemId) || idSet.has(it.payload?.to?.itemId))
    ).map(it => it.id), [items])

    const onErase = useCallback((id) => {
        const orphans = connectorsAttachedTo(new Set([id]))
        if (orphans.length) {
            beginTransaction()
            act.removeItem(id)
            orphans.forEach(cid => act.removeItem(cid))
            endTransaction()
        } else {
            act.removeItem(id)
        }
        bump()
    }, [connectorsAttachedTo, act, beginTransaction, endTransaction, bump])

    const deleteSelection = useCallback(() => {
        const ids = [...canvas.selectedIds].filter(id => !items.find(i => i.id === id)?.payload?.locked)
        if (ids.length === 0) return
        const orphans = connectorsAttachedTo(new Set(ids))
        beginTransaction()
        ids.forEach(id => act.removeItem(id))
        orphans.forEach(cid => act.removeItem(cid))
        endTransaction()
        canvas.clearSelection()
        bump()
    }, [canvas, items, connectorsAttachedTo, act, beginTransaction, endTransaction, bump])

    const onZOrder = useCallback((op) => {
        const patches = reorder(items, canvas.selectedIds, op)
        if (patches.length === 0) return
        beginTransaction()
        patches.forEach(p => act.updateItem(p.id, { z_index: p.z_index }))
        endTransaction()
        bump()
    }, [items, canvas.selectedIds, act, beginTransaction, endTransaction, bump])

    const onAlign = useCallback((op) => {
        // Connectors have no box (geometry derives from endpoints) — exclude them
        // so they don't skew the alignment math.
        const sel = items.filter(i => canvas.selectedIds.has(i.id) && i.type !== 'connector')
        const patches = alignPatches(sel, op)
        if (patches.length === 0) return
        beginTransaction()
        patches.forEach(p => act.updateItem(p.id, p))
        endTransaction()
        bump()
    }, [items, canvas.selectedIds, act, beginTransaction, endTransaction, bump])

    const onExport = useCallback(() => {
        const res = exportStagePNG(stageRef.current, [...frameItems, ...graphicItems, ...topGraphicItems], sandbox?.title, null, topStageRef.current)
        if (!res.ok) toast.error(res.reason === 'empty' ? 'Nothing to export yet.' : 'Export failed.')
        else toast.success('Exported PNG (cards not included)')
    }, [frameItems, graphicItems, topGraphicItems, sandbox?.title])

    // Export one frame — exactly its rectangle (spec §11.9).
    const onExportFrame = useCallback((id) => {
        const f = items.find(i => i.id === id)
        if (!f) return
        const res = exportStagePNG(stageRef.current, [f], `${sandbox?.title || 'sandbox'} - ${f.payload?.title || 'Frame'}`, { x: f.x, y: f.y, w: f.w, h: f.h }, topStageRef.current)
        if (!res.ok) toast.error('Export failed.')
        else toast.success('Exported the frame (cards not included)')
    }, [items, sandbox?.title])

    // ---- placement ----
    const centerWorld = useCallback(() => canvas.worldFromScreen({ x: window.innerWidth / 2, y: window.innerHeight / 2 }), [canvas])

    // Declared after centerWorld, which it closes over (a hook reading a later
    // const lints clean and throws on every render).
    const flow = useFlowActions({ items, act, beginTransaction, endTransaction, canvas, nextZ, bump, setEditingShapeId, viewportCenter: centerWorld })

    // ---- templates ----
    const insertTemplate = useCallback((tpl) => {
        let built
        try { built = tpl.build({ newId: newSandboxItemId, style: { stroke: canvas.shapeStyle.stroke } }) } catch (e) { toast.error(`Could not build that template: ${e.message}`); return }
        const boxed = built.filter(i => i.type !== 'connector')
        const b = unionAABB(boxed)
        if (!b) return
        const c = centerWorld()
        const dx = Math.round(c.x - (b.x + b.w / 2)), dy = Math.round(c.y - (b.y + b.h / 2))
        const minZ = items.reduce((m, it) => Math.min(m, it.z_index ?? 0), 0)
        const frames = built.filter(isFrame)
        let fz = minZ - frames.length
        let z = nextZ()
        beginTransaction()
        for (const it of built) {
            const moved = it.type === 'connector' ? it : { ...it, x: it.x + dx, y: it.y + dy }
            act.addItem({ ...moved, z_index: isFrame(it) ? fz++ : z++ })
        }
        endTransaction()
        canvas.setTool('pointer')
        canvas.setSelection(new Set(boxed.map(i => i.id)))
        // Bring it into view at a zoom that shows the whole thing.
        const stage = stageRef.current
        const vw = stage?.width() || window.innerWidth, vh = stage?.height() || window.innerHeight
        const zoom = Math.max(0.1, Math.min((vw - 120) / b.w, (vh - 160) / b.h, 1))
        canvas.setViewport({ x: vw / 2 - (c.x) * zoom, y: vh / 2 - (c.y) * zoom, zoom })
        bump()
        toast.success(`Added “${tpl.name}” — one undo removes it`)
    }, [canvas, centerWorld, items, nextZ, act, beginTransaction, endTransaction, bump])

    // ---- group / lock / frame selection ----
    const selectedList = useCallback(() => items.filter(i => canvas.selectedIds.has(i.id) && i.type !== 'connector'), [items, canvas.selectedIds])
    const groupSelection = useCallback(() => {
        const sel = selectedList()
        if (sel.length < 2) return
        const gid = newSandboxItemId()
        beginTransaction()
        sel.forEach(it => act.updateItem(it.id, { payload: { ...it.payload, groupId: gid } }))
        endTransaction()
        bump()
    }, [selectedList, act, beginTransaction, endTransaction, bump])
    const ungroupSelection = useCallback(() => {
        const sel = selectedList().filter(it => it.payload?.groupId)
        if (!sel.length) return
        beginTransaction()
        sel.forEach(it => { const { groupId: _g, ...rest } = it.payload; act.updateItem(it.id, { payload: rest }) })
        endTransaction()
        bump()
    }, [selectedList, act, beginTransaction, endTransaction, bump])
    const toggleLock = useCallback(() => {
        const sel = selectedList()
        if (!sel.length) return
        const lock = !sel.some(it => it.payload?.locked)
        beginTransaction()
        sel.forEach(it => {
            const { locked: _l, ...rest } = it.payload || {}
            act.updateItem(it.id, { payload: lock ? { ...rest, locked: true } : rest })
        })
        endTransaction()
        bump()
        toast.success(lock ? 'Locked — it won’t move or delete until unlocked' : 'Unlocked')
    }, [selectedList, act, beginTransaction, endTransaction, bump])
    const frameSelection = useCallback(() => {
        const sel = selectedList()
        const b = unionAABB(sel)
        if (!b) return
        const pad = 40
        const minZ = items.reduce((m, it) => Math.min(m, it.z_index ?? 0), 0)
        const created = act.addItem({
            type: 'shape', x: Math.round(b.x - pad), y: Math.round(b.y - pad), w: Math.round(b.w + pad * 2), h: Math.round(b.h + pad * 2),
            rotation: 0, z_index: minZ - 1, payload: framePayload(nextFrameTitle(items)),
        })
        canvas.selectOnly(created.id)
        setEditingFrameId(created.id)
        bump()
    }, [selectedList, items, act, canvas, bump])

    // ---- copy / paste style ----
    const copyStyle = useCallback(() => {
        const src = items.find(i => canvas.selectedIds.has(i.id))
        if (!src) return
        const p = src.payload || {}
        const st = {}
        for (const k of STYLE_KEYS) if (p[k] !== undefined) st[k] = p[k]
        if (src.type === 'text' && p.color) st.textColor = p.color
        styleClipRef.current = { from: src.type, style: st }
        toast.success('Style copied — Ctrl+Alt+V to apply it')
    }, [items, canvas.selectedIds])
    const pasteStyle = useCallback(() => {
        const clip = styleClipRef.current
        if (!clip) return
        const sel = items.filter(i => canvas.selectedIds.has(i.id) && !i.payload?.locked)
        if (!sel.length) return
        beginTransaction()
        for (const it of sel) {
            const upd = {}
            for (const [k, v] of Object.entries(clip.style)) {
                if ((it.type === 'connector') !== CONNECTOR_STYLE.has(k) && k !== 'stroke' && k !== 'strokeWidth') continue
                if (it.type === 'text' && k === 'textColor') { upd.color = v; continue }
                if (it.type === 'text' && k === 'color') continue
                if (it.type === 'shape' && k === 'color') continue
                upd[k] = v
            }
            act.updateItem(it.id, { payload: { ...it.payload, ...upd } })
        }
        endTransaction()
        bump()
    }, [items, canvas.selectedIds, act, beginTransaction, endTransaction, bump])

    // ---- text shortcuts on the selection (not while typing) ----
    const textTargets = useCallback(() => items.filter(i => canvas.selectedIds.has(i.id) && !i.payload?.locked
        && (i.type === 'text' || (i.type === 'shape' && !isFrame(i) && !isFormat(i) && i.payload?.kind && !['line', 'arrow', 'elbowArrow', 'divider'].includes(i.payload.kind)))), [items, canvas.selectedIds])
    const toggleTextFlag = useCallback((key) => {
        const t = textTargets()
        if (!t.length) return false
        const on = !t[0].payload?.[key]
        beginTransaction()
        t.forEach(it => act.updateItem(it.id, { payload: { ...it.payload, [key]: on } }))
        endTransaction()
        bump()
        return true
    }, [textTargets, act, beginTransaction, endTransaction, bump])
    const stepTextSize = useCallback((dir) => {
        // Text, shapes with text, and Format widgets (their contents' size).
        const t = [...textTargets(), ...items.filter(i => canvas.selectedIds.has(i.id) && isFormat(i) && !i.payload?.locked)]
        if (!t.length) return false
        beginTransaction()
        t.forEach(it => {
            const cur = it.payload?.fontSize || (it.type === 'text' ? 18 : isFormat(it) ? 15 : 16)
            act.updateItem(it.id, { payload: { ...it.payload, fontSize: stepFontSize(cur, dir) } })
        })
        endTransaction()
        bump()
        return true
    }, [textTargets, items, canvas.selectedIds, act, beginTransaction, endTransaction, bump])

    const onPickNote = (note) => {
        const w = centerWorld()
        addCard({ type: 'note', x: w.x - 165, y: w.y - 215, w: 330, h: 430, rotation: 0, z_index: nextZ(), payload: { noteId: note.id } })
        setNotePickerOpen(false)
        bump()
        toast.success(`Attached "${note.title || 'Untitled'}"`)
    }
    const onPickTask = (task) => {
        const w = centerWorld()
        addCard({ type: 'task', x: w.x - 110, y: w.y - 55, w: 220, h: 110, rotation: 0, z_index: nextZ(), payload: { taskId: task.id } })
        setTaskPickerOpen(false)
        bump()
        toast.success(`Attached "${task.title || 'Untitled task'}"`)
    }

    const onPlaceText = useCallback((world) => {
        const created = addCard({
            type: 'text', x: world.x, y: world.y, w: 180, h: 44, rotation: 0, z_index: nextZ(),
            payload: { text: '', fontSize: 18, color: canvas.strokeColor },
        })
        canvas.setTool('pointer')
        canvas.selectOnly(created.id)
        bump()
    }, [addCard, nextZ, canvas, bump])

    const placeImageFile = useCallback(async (file, world) => {
        let created
        let localUrl
        try {
            const { blob, naturalW, naturalH } = await prepareImageBlob(file)
            let w = naturalW, h = naturalH
            const maxDisp = 480
            if (Math.max(w, h) > maxDisp) { const s = maxDisp / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s) }
            const at = world || centerWorld()
            // Insert optimistically with a local blob preview so it shows + undoes
            // instantly; the real R2 upload happens in the background.
            localUrl = URL.createObjectURL(blob)
            created = act.addItem({ type: 'image', x: at.x - w / 2, y: at.y - h / 2, w, h, rotation: 0, z_index: nextZ(), payload: { url: localUrl, naturalW, naturalH, _uploading: true } })
            bump()

            try {
                const { path } = await uploadImageFile(authFetch, API, blob)
                // Raw mutator (base.updateItem) so the URL swap doesn't create an undo
                // step; it re-marks the item dirty so the R2 path syncs.
                base.updateItem(created.id, { payload: { url: path, naturalW, naturalH } })
                URL.revokeObjectURL(localUrl)
            } catch (err) {
                base.updateItem(created.id, { payload: { url: localUrl, naturalW, naturalH, _uploadFailed: true } })
                toast.error(err?.message || 'Image upload failed — re-add it to save.')
            }
        } catch {
            if (localUrl) URL.revokeObjectURL(localUrl)
            toast.error('Could not load that image.')
        }
    }, [act, base, nextZ, centerWorld, bump, authFetch, API])

    const onImageDrop = useCallback((file, world) => { placeImageFile(file, world) }, [placeImageFile])

    const onPickImageClick = () => fileRef.current?.click()
    const onFileChange = (e) => {
        const file = e.target.files?.[0]
        if (file) placeImageFile(file, null)
        e.target.value = ''
    }

    // Attach a PDF → copied into the Bag, dropped as a scrollable preview card.
    const onPickPdf = useCallback(async () => {
        const r = await attachPdfViaPicker()
        if (!r) return
        const w = 360, h = 460
        const at = centerWorld()
        addCard({ type: 'pdf', x: at.x - w / 2, y: at.y - h / 2, w, h, rotation: 0, z_index: nextZ(), payload: { path: r.path, name: r.name } })
        bump()
    }, [addCard, nextZ, centerWorld, bump])

    const toggleMenu = useCallback((m) => setOpenMenu(cur => (cur === m ? null : m)), [])
    const openDiagram = useCallback((source) => { setOpenMenu(null); setDiagram({ source }) }, [])
    const itemsById = useMemo(() => new Map(items.map(i => [i.id, i])), [items])
    // What's cropped to a frame or widget (selection/attach.js): rects per item,
    // counts per container. Memoised so the Konva layers keep their memo.
    const board = useMemo(() => boardClips(items, itemsById), [items, itemsById])
    const frameCutLabels = useMemo(() => {
        const m = new Map()
        for (const [id, c] of board.cut) if (isFrame(itemsById.get(id))) m.set(id, cutLabel(c))
        return m
    }, [board, itemsById])
    const diagramColors = useMemo(() => ({
        stroke: canvas.shapeStyle.stroke, text: canvas.shapeStyle.stroke,
        fill: canvas.shapeStyle.fill || 'transparent',
    }), [canvas.shapeStyle])
    const closeMenu = useCallback((m) => setOpenMenu(cur => (cur === m ? null : cur)), [])
    // One thing active at a time: opening the shapes or media menu puts down
    // the tool you were holding (text, pen, sticky…), so a click on the board
    // while the menu is up just closes it instead of dropping text there.
    const toggleDockMenu = useCallback((m) => {
        const opening = openMenu !== m
        toggleMenu(m)
        const keep = canvas.tool === 'pointer' || canvas.tool === 'hand' || (m === 'shapes' && isPlainShapeTool(canvas.tool))
        if (opening && !keep) canvas.setTool('pointer')
    }, [openMenu, toggleMenu, canvas])
    const onToggleShapePicker = useCallback(() => toggleDockMenu('shapes'), [toggleDockMenu])
    const closeShapePicker = useCallback(() => closeMenu('shapes'), [closeMenu])
    const onToggleInsertMenu = useCallback(() => toggleDockMenu('insert'), [toggleDockMenu])
    const closeInsertMenu = useCallback(() => closeMenu('insert'), [closeMenu])
    const closePaintMenu = useCallback(() => closeMenu('paint'), [closeMenu])
    // Choosing a tool from the dock closes whatever menu was open.
    const chooseTool = useCallback((t) => { setOpenMenu(null); canvas.setTool(t) }, [canvas])
    // The bucket is a tool: it opens its colours; then click things to paint
    // them. While it's the tool, the bucket button re-opens the colours.
    const onBucketClick = useCallback(() => {
        if (canvas.tool !== 'fill') { canvas.setTool('fill'); setOpenMenu('paint') }
        else toggleMenu('paint')
    }, [canvas, toggleMenu])
    const onPaintColorChange = useCallback((c) => { canvas.setPaintColor(c); setOpenMenu(null) }, [canvas])

    // ---- shape text editing (Wave 3) ----
    const onShapeDoubleClick = useCallback((id) => {
        const it = items.find(i => i.id === id)
        if (it?.payload?.locked) return
        canvas.selectOnly(id)
        if (isFrame(it)) { setEditingFrameId(id); return }
        setEditingShapeId(id)
    }, [canvas, items])
    const onEditText = useCallback((id) => {
        const it = items.find(i => i.id === id)
        if (!it || it.payload?.locked) return
        if (isFrame(it)) setEditingFrameId(id)
        else if (isFormat(it)) setRenamingFormatId(id)
        else if (it.type === 'text') setTextEditReq(r => ({ id, n: (r?.n || 0) + 1 }))
        else if (it.type === 'shape') setEditingShapeId(id)
    }, [items])

    const onUpdateShapePayload = useCallback((id, patch) => {
        const item = items.find(i => i.id === id)
        if (!item) return
        act.updateItem(id, { payload: { ...item.payload, ...patch } })
        bump()
    }, [items, act, bump])
    // Paint bucket: recolour what was clicked (ink/paint.js decides how).
    const onPaint = useCallback((id) => {
        const it = items.find(i => i.id === id)
        const payload = paintPayload(it, canvas.paintColor)
        if (!payload) return
        act.updateItem(id, { payload })
        bump()
    }, [items, canvas.paintColor, act, bump])

    // ---- Format widgets ----
    // A widget's own records change through its payload: `fn` gets the payload
    // as it is now (not as it was at render), one undo step per change.
    const onCommitFormat = useCallback((id, fn) => {
        const it = base.getItemById(id)
        if (!it || it.payload?.locked) return
        act.updateItem(id, { payload: fn(it.payload) })
        bump()
    }, [base, act, bump])
    // Press on a widget's title bar or on a card: select it and drag it in the
    // same motion, through the board's own move (snapping, groups, riders).
    const onGrabItem = useCallback((e, id, locked) => {
        const wasSelected = canvas.selectedIds.has(id)
        if (!wasSelected || e.shiftKey) onSelect(id, e.shiftKey)
        if (e.shiftKey || locked) return
        const gid = items.find(i => i.id === id)?.payload?.groupId
        const ids = wasSelected ? [...canvas.selectedIds]
            : gid ? items.filter(i => i.payload?.groupId === gid).map(i => i.id) : [id]
        canvas.overlayApiRef?.current?.beginMove?.(e, ids)
    }, [canvas, items, onSelect])
    // A drop: anything that moved may now sit on a widget (attach) or have left
    // one (detach) — frames and widgets, selection/attach.js. Called inside
    // the move's transaction, so it is the same undo step. Reads the store as
    // it is now: the last move frame hasn't rendered yet.
    const onMoveEnd = useCallback((ids) => {
        const patches = attachPatches(ids, boardItemsNow(sandboxId))
        for (const p of patches) act.updateItem(p.id, { payload: p.payload })
    }, [sandboxId, act])
    // A frame starts moving or resizing: whatever sits in frames by position
    // only (a board from before attachment, or drawn there since) is attached
    // to its frame now, so it sticks from here on. Inside the gesture's transaction.
    const onFrameGesture = useCallback(() => {
        for (const p of stampPatches(boardItemsNow(sandboxId))) act.updateItem(p.id, { payload: p.payload })
    }, [sandboxId, act])
    const insertFormat = useCallback((view = 'table') => {
        const c = centerWorld()
        const { w, h } = FORMAT_SIZE
        const created = addCard({
            type: 'shape', x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2), w, h, rotation: 0, z_index: nextZ(),
            payload: formatPayload(view, nextFormatTitle(items, view)),
        })
        setOpenMenu(null)
        canvas.setTool('pointer')
        canvas.selectOnly(created.id)
        bump()
    }, [centerWorld, addCard, nextZ, items, canvas, bump])
    // A full-screen widget that goes away (undo, the CLI) takes focus mode with it,
    // or the page would go on ignoring keys.
    useEffect(() => {
        if (focusFormatId && !items.some(i => i.id === focusFormatId)) setFocusFormatId(null)
    }, [focusFormatId, items])
    const openFormatFocus = useCallback((id) => setFocusFormatId(id), [])
    const closeFormatFocus = useCallback(() => setFocusFormatId(null), [])
    const endFormatRename = useCallback(() => setRenamingFormatId(null), [])

    // ---- keyboard-driven actions ----
    const selectAll = useCallback(() => { canvas.setSelection(new Set(items.map(i => i.id))) }, [canvas, items])

    const duplicateSelection = useCallback(() => {
        const sel = items.filter(i => canvas.selectedIds.has(i.id))
        if (!sel.length) return
        beginTransaction()
        const base = nextZ()
        const newIds = []
        const regroup = new Map()   // a duplicated group becomes a new group, not a member of the old one
        // A copied widget's copied riders attach to the copy, not the original.
        const newIdOf = new Map(sel.map(it => [it.id, newSandboxItemId()]))
        sel.forEach((it, i) => {
            const gid = it.payload?.groupId
            if (gid && !regroup.has(gid)) regroup.set(gid, newSandboxItemId())
            let payload = gid ? { ...it.payload, groupId: regroup.get(gid) } : it.payload
            const att = it.payload?.attachedTo
            if (att && newIdOf.has(att)) payload = { ...payload, attachedTo: newIdOf.get(att) }
            const created = act.addItem({ ...it, id: newIdOf.get(it.id), payload, x: it.x + 16, y: it.y + 16, z_index: base + i })
            newIds.push(created.id)
        })
        endTransaction()
        canvas.setSelection(new Set(newIds))
        bump()
    }, [items, canvas, act, nextZ, beginTransaction, endTransaction, bump])

    const nudgeSelection = useCallback((dx, dy) => {
        const sel = items.filter(i => canvas.selectedIds.has(i.id))
        if (!sel.length) return
        beginTransaction()
        sel.filter(it => !it.payload?.locked).forEach(it => act.updateItem(it.id, { x: it.x + dx, y: it.y + dy }))
        endTransaction()
        bump()
    }, [items, canvas, act, beginTransaction, endTransaction, bump])

    const resetZoom = useCallback(() => { canvas.setViewport({ x: 0, y: 0, zoom: 1 }) }, [canvas])

    const fitToContent = useCallback(() => {
        const b = unionAABB(items)
        if (!b || b.w <= 0 || b.h <= 0) return
        const stage = stageRef.current
        const vw = stage?.width() || window.innerWidth
        const vh = stage?.height() || window.innerHeight
        const pad = 80
        const zoom = Math.max(0.1, Math.min((vw - pad) / b.w, (vh - pad) / b.h, 2))
        canvas.setViewport({ x: vw / 2 - (b.x + b.w / 2) * zoom, y: vh / 2 - (b.y + b.h / 2) * zoom, zoom })
    }, [items, canvas])

    // ---- clipboard paste (images) ----
    useEffect(() => {
        const onPaste = (e) => {
            if (isEditable(document.activeElement)) return
            const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'))
            if (!item) return
            const file = item.getAsFile()
            if (file) { e.preventDefault(); placeImageFile(file, null) }
        }
        window.addEventListener('paste', onPaste)
        return () => window.removeEventListener('paste', onPaste)
    }, [placeImageFile])

    // ---- keyboard ----
    useEffect(() => {
        const onKeyDown = (e) => {
            if (isEditable(document.activeElement)) return
            if (diagram || focusFormatId) return   // the pop-up / full-screen widget handles its own keys
            const meta = e.metaKey || e.ctrlKey

            if (meta && (e.key === 'z' || e.key === 'Z')) {
                e.preventDefault()
                if (e.shiftKey) redo(); else undo()
                return
            }
            if (meta && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return }
            if (meta && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); duplicateSelection(); return }
            if (meta && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); selectAll(); return }
            if (meta && e.key === '0') { e.preventDefault(); resetZoom(); return }
            // Copy / paste style (spec §8.4) — before plain Ctrl+C/V, which stay the system's.
            if (meta && e.altKey && (e.code === 'KeyC')) { e.preventDefault(); copyStyle(); return }
            if (meta && e.altKey && (e.code === 'KeyV')) { e.preventDefault(); pasteStyle(); return }
            if (meta && e.shiftKey && e.code === 'KeyG') { e.preventDefault(); ungroupSelection(); return }
            if (meta && !e.shiftKey && e.code === 'KeyG') { e.preventDefault(); groupSelection(); return }
            if (meta && e.shiftKey && e.code === 'KeyL') { e.preventDefault(); toggleLock(); return }
            if (meta && !e.shiftKey && !e.altKey && e.code === 'KeyB') { if (toggleTextFlag('bold')) e.preventDefault(); return }
            if (meta && !e.shiftKey && !e.altKey && e.code === 'KeyI') { if (toggleTextFlag('italic')) e.preventDefault(); return }
            if (meta && !e.shiftKey && !e.altKey && e.code === 'KeyU') { if (toggleTextFlag('underline')) e.preventDefault(); return }
            if (meta && e.shiftKey && (e.key === '>' || e.code === 'Period')) { if (stepTextSize(1)) e.preventDefault(); return }
            if (meta && e.shiftKey && (e.key === '<' || e.code === 'Comma')) { if (stepTextSize(-1)) e.preventDefault(); return }
            if (meta) return // leave other ⌘ combos alone

            // ── flowchart keys ──
            const sel = [...canvas.selectedIds]
            const one = sel.length === 1 ? items.find(i => i.id === sel[0]) : null
            const oneShape = one?.type === 'shape' && !isFormat(one) ? one : null
            if (e.key === 'Enter' && one && isFormat(one)) { e.preventDefault(); setFocusFormatId(one.id); return }
            if (e.key === 'Tab' && oneShape && !isFrame(oneShape)) { e.preventDefault(); if (e.shiftKey) flow.createSibling(oneShape.id); else flow.createNext(oneShape.id, 's'); return }
            if (e.key === 'Enter' && one && (one.type === 'shape' || one.type === 'text')) { e.preventDefault(); onEditText(one.id); return }
            if (e.altKey && ARROW_DIRS[e.key] && oneShape && !isFrame(oneShape)) { e.preventDefault(); flow.createNext(oneShape.id, ARROW_DIRS[e.key]); return }
            if ((e.key === 'c' || e.key === 'C') && !e.shiftKey && sel.length === 2) { e.preventDefault(); flow.connectSelected(); return }
            if (e.key === 'T' && e.shiftKey) { e.preventDefault(); flow.tidySelection(); return }
            // D: edit the selected diagram, or start a new one.
            if (e.key === 'd' || e.key === 'D') { e.preventDefault(); openDiagram(flow.diagramSource()); return }

            if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); return }
            if (e.key === 'Escape') { setShortcutsOpen(false); setOpenMenu(null); canvas.clearSelection(); if (canvas.tool !== 'pointer') canvas.setTool('pointer'); return }
            if (e.key === ']') { e.preventDefault(); onZOrder('front'); return }
            if (e.key === '[') { e.preventDefault(); onZOrder('back'); return }
            if (e.key === '?') { e.preventDefault(); setShortcutsOpen(o => !o); return }
            if (e.key === '1') { e.preventDefault(); fitToContent(); return }

            if (e.key.startsWith('Arrow')) {
                e.preventDefault()
                const d = e.shiftKey ? 10 : 1
                if (e.key === 'ArrowUp') nudgeSelection(0, -d)
                else if (e.key === 'ArrowDown') nudgeSelection(0, d)
                else if (e.key === 'ArrowLeft') nudgeSelection(-d, 0)
                else if (e.key === 'ArrowRight') nudgeSelection(d, 0)
                return
            }

            // `S` opens the shape picker (then pick a shape with the mouse/pen).
            if (e.key === 's' || e.key === 'S') { e.preventDefault(); toggleDockMenu('shapes'); return }

            const t = TOOL_KEYS[e.key.toLowerCase()]
            // A tool's key again flips to its sibling: V Select ⇄ Pan,
            // P Pen ⇄ Highlighter, E Eraser ⇄ Precision eraser.
            if (!t) return
            canvas.setTool(canvas.tool === t && TOOL_TOGGLES[t] ? TOOL_TOGGLES[t] : t)
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [undo, redo, deleteSelection, onZOrder, canvas, duplicateSelection, selectAll, resetZoom, fitToContent, nudgeSelection, items, flow,
        copyStyle, pasteStyle, groupSelection, ungroupSelection, toggleLock, toggleTextFlag, stepTextSize, onEditText, toggleDockMenu, diagram, openDiagram, focusFormatId])

    const onTitleCommit = () => {
        const next = titleDraft.trim()
        if (next && next !== sandbox?.title) rename(sandboxId, next)
    }

    if (!sandbox) {
        return (
            <div className={mode === 'half' ? styles.pageHalf : styles.page}>
                <div className={styles.canvasShell}>
                    <div className={styles.notFound}>
                        <span className={styles.mark}>✦</span>
                        <span className={styles.label}>Sandbox not found</span>
                        <button className={styles.headerBtn} onClick={() => navigate('/sandboxes')}>Back to hub</button>
                    </div>
                </div>
            </div>
        )
    }

    // Cards cropped to a frame or widget sit in a clipped wrapper (below); a
    // widget shows how many of its riders are cropped or out of view.
    const clipOf = board.clips
    const cutOn = board.cut
    const cardEl = (item) => {
        if (isFormat(item)) {
            return <FormatWidget item={item} tool={canvas.tool}
                selected={canvas.selectedIds.has(item.id)} renaming={renamingFormatId === item.id}
                cut={cutOn.get(item.id)}
                onSelect={onSelect} onGrab={onGrabItem} onRemove={onErase} onCommit={onCommitFormat}
                onOpenFocus={openFormatFocus} onRenameDone={endFormatRename} />
        }
        const shared = {
            item, zoom: canvas.viewport.zoom, tool: canvas.tool,
            selected: canvas.selectedIds.has(item.id), onSelect,
            onUpdate: act.updateItem, onRemove: onErase, beginTransaction, endTransaction, onMoveEnd, onGrab: onGrabItem,
        }
        if (item.type === 'note') return <AttachedNoteCard {...shared} notes={notes} />
        if (item.type === 'task') return <AttachedTaskCard {...shared} tasks={tasks} onToggleTask={toggleTaskCompletion} />
        if (item.type === 'pdf') return <SandboxPdfCard {...shared} />
        return <TextBoxCard {...shared}
            onAutoSize={(id, h) => base.updateItem(id, { h })}
            editRequest={textEditReq?.id === item.id ? textEditReq.n : 0} />
    }
    // Every card sits in a zero-size wrapper, clipped or not, so attaching or
    // detaching never remounts it (a remounted PDF iframe reloads — or worse).
    const cardEls = cardItems.map(item => {
        const r = clipOf.get(item.id)
        const clip = r ? `polygon(${r.x}px ${r.y}px, ${r.x + r.w}px ${r.y}px, ${r.x + r.w}px ${r.y + r.h}px, ${r.x}px ${r.y + r.h}px)` : undefined
        return <div key={item.id} style={{ position: 'absolute', left: 0, top: 0, clipPath: clip }}>{cardEl(item)}</div>
    })

    return (
        <div className={mode === 'half' ? styles.pageHalf : styles.page}>
            <header className={styles.header}>
                <ExpandSidebarButton />
                {mode !== 'half' && <NavArrows />}
                <div className={styles.titleGroup}>
                    <input
                        className={styles.title}
                        value={titleDraft}
                        onChange={(e) => setTitleDraft(e.target.value)}
                        onBlur={onTitleCommit}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
                        size={Math.max(8, titleDraft.length)}
                    />
                    <span className={styles.titleSep}>·</span>
                    <span className={styles.titleId}>{sandbox.id.slice(0, 6)}</span>
                </div>
                <div className={styles.headerActions}>
                    <button className={styles.headerBtn} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" onClick={() => setShortcutsOpen(true)}>⌨ Keys</button>
                    {mode === 'half' && (
                        <button className={styles.headerBtn} onClick={() => navigate(`/sandboxes/${sandboxId}`)}>Expand</button>
                    )}
                    {mode === 'half' && (
                        <button className={styles.headerBtn} onClick={() => view.close()}>Close</button>
                    )}
                    {mode === 'full' && (
                        <button className={styles.headerBtn} onClick={() => navigate('/sandboxes')}>All</button>
                    )}
                </div>
            </header>

            <div className={styles.canvasShell}>
                <SandboxToolbar
                    tool={canvas.tool}
                    onToolChange={chooseTool}
                    lastInkTool={canvas.lastInkTool}
                    shapeStyle={canvas.shapeStyle}
                    onShapeStyleChange={canvas.setShapeStyle}
                    paintColor={canvas.paintColor}
                    onPaintColorChange={onPaintColorChange}
                    paintMenuOpen={openMenu === 'paint'}
                    onBucketClick={onBucketClick}
                    onClosePaintMenu={closePaintMenu}
                    shapePickerOpen={openMenu === 'shapes'}
                    onToggleShapePicker={onToggleShapePicker}
                    onCloseShapePicker={closeShapePicker}
                    insertMenuOpen={openMenu === 'insert'}
                    onToggleInsertMenu={onToggleInsertMenu}
                    onCloseInsertMenu={closeInsertMenu}
                    onAttachNoteClick={() => setNotePickerOpen(true)}
                    onAttachTaskClick={() => setTaskPickerOpen(true)}
                    onPickImage={onPickImageClick}
                    onPickPdf={onPickPdf}
                    onInsertTable={insertFormat}
                    onUndo={undo}
                    onRedo={redo}
                    canUndo={canUndo}
                    canRedo={canRedo}
                    snapEnabled={canvas.snapEnabled}
                    onToggleSnap={() => canvas.setSnapEnabled(v => !v)}
                    onExport={onExport}
                    onOpenDiagram={() => openDiagram(null)}
                    onOpenTemplates={() => setTemplatesOpen(true)}
                />

                {isInkTool(canvas.tool) && !openMenu && (
                    <DrawFlyout
                        tool={canvas.tool}
                        onToolChange={canvas.setTool}
                        ink={canvas.ink}
                        onSelectPreset={canvas.selectPreset}
                        onPresetChange={canvas.updatePreset}
                    />
                )}

                <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onFileChange} />

                <SandboxCanvas
                    canvas={canvas}
                    items={items}
                    graphicItems={graphicItems}
                    connectorItems={connectorItems}
                    frameItems={frameItems}
                    editingFrameId={editingFrameId}
                    stageRef={stageRef}
                    onStrokeCommit={onStrokeCommit}
                    onShapeCommit={onShapeCommit}
                    onSelect={onSelect}
                    onMarqueeSelect={onMarqueeSelect}
                    onErase={onErase}
                    onPrecisionErase={onPrecisionErase}
                    onPrecisionEraseEnd={onPrecisionEraseEnd}
                    onSmartStroke={onSmartStroke}
                    onPaint={onPaint}
                    onPlaceText={onPlaceText}
                    onImageDrop={onImageDrop}
                    beginTransaction={beginTransaction}
                    endTransaction={endTransaction}
                    overlayChildren={cardEls}
                    selectionOverlay={
                        <SelectionOverlay
                            canvas={canvas}
                            selectedItems={selectedItems}
                            items={items}
                            updateItem={act.updateItem}
                            beginTransaction={beginTransaction}
                            endTransaction={endTransaction}
                            onCreateConnector={onCreateConnector}
                            onQuickAdd={(id, side) => flow.createNext(id, side)}
                            onQuickAddAt={flow.createConnectedAt}
                            onMoveEnd={onMoveEnd}
                            onFrameGesture={onFrameGesture}
                        />
                    }
                    contextToolbar={
                        <ContextToolbar
                            selectedItems={selectedItems}
                            items={items}
                            canvas={canvas}
                            onUpdatePayload={onUpdateShapePayload}
                            onBringFront={() => onZOrder('front')}
                            onSendBack={() => onZOrder('back')}
                            onAlign={onAlign}
                            onDuplicate={duplicateSelection}
                            onDelete={deleteSelection}
                            onGroup={groupSelection}
                            onUngroup={ungroupSelection}
                            onToggleLock={toggleLock}
                            onFrameSelection={frameSelection}
                            onExportFrame={onExportFrame}
                            onEditText={onEditText}
                            onRevertInk={revertToInk}
                            beginTransaction={beginTransaction}
                            endTransaction={endTransaction}
                            editingShapeId={editingShapeId}
                            flow={flow}
                            onEditDiagram={() => openDiagram(flow.diagramSource())}
                            onOpenFormat={openFormatFocus}
                        />
                    }
                    onShapeDoubleClick={onShapeDoubleClick}
                    onEmptyDoubleClick={flow.createAt}
                    editingShapeId={editingShapeId}
                    clips={board.clips}
                    frameCutLabels={frameCutLabels}
                    topGraphicItems={topGraphicItems}
                    topConnectorItems={topConnectorItems}
                    onWidgetIds={onWidget}
                    topStageRef={topStageRef}
                />

                {editingShapeId && (() => {
                    const editItem = items.find(i => i.id === editingShapeId)
                    if (!editItem || editItem.type !== 'shape' || isFrame(editItem)) return null
                    return (
                        <ShapeTextEditor
                            // Keyed per box: Tab hands editing straight to the next box,
                            // and a reused editor would carry over the last box's draft
                            // and its "already committed" guard — dropping what you type.
                            key={editItem.id}
                            item={editItem}
                            canvas={canvas}
                            onCommit={(id, patch) => { onUpdateShapePayload(id, patch) }}
                            onClose={() => setEditingShapeId(null)}
                            onTab={(shift) => { if (shift) flow.createSibling(editItem.id); else flow.createNext(editItem.id, 's') }}
                        />
                    )
                })()}

                {editingFrameId && (() => {
                    const f = items.find(i => i.id === editingFrameId)
                    if (!f || !isFrame(f)) return null
                    return (
                        <FrameTitleEditor
                            key={f.id}
                            frame={f}
                            canvas={canvas}
                            onCommit={(title) => { if (title !== (f.payload?.title || '')) onUpdateShapePayload(f.id, { title }) }}
                            onClose={() => setEditingFrameId(null)}
                        />
                    )
                })()}
            </div>

            <footer className={styles.footer}>
                <span>ZOOM {Math.round(canvas.viewport.zoom * 100)}%</span>
                <span className={styles.footerDot}>·</span>
                <span>TOOL {canvas.tool.toUpperCase()}</span>
                <span className={styles.footerDot}>·</span>
                <span>{items.length} ITEMS</span>
                <span className={styles.footerDot}>·</span>
                <span title="Ways to pan the board">{PAN_HINT}</span>
                {canvas.selectedIds.size > 0 && (
                    <>
                        <span className={styles.footerDot}>·</span>
                        <span style={{ color: 'var(--accent-warning)' }}>{canvas.selectedIds.size} SELECTED</span>
                    </>
                )}
                {canvas.spacePanning && (
                    <>
                        <span className={styles.footerDot}>·</span>
                        <span style={{ color: 'var(--accent-warning)' }}>PAN</span>
                    </>
                )}
            </footer>

            <NoteAttachPicker isOpen={notePickerOpen} notes={notes} onPick={onPickNote} onClose={() => setNotePickerOpen(false)} />
            <TaskAttachPicker isOpen={taskPickerOpen} tasks={tasks} onPick={onPickTask} onClose={() => setTaskPickerOpen(false)} />
            <ShortcutsModal isOpen={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
            <TemplatesModal isOpen={templatesOpen} onClose={() => setTemplatesOpen(false)} onInsert={insertTemplate} />
            {focusFormatId && (() => {
                const f = items.find(i => i.id === focusFormatId)
                return f && isFormat(f) ? <FormatFocus key={f.id} item={f} onClose={closeFormatFocus} onCommit={onCommitFormat} /> : null
            })()}
            <DiagramModal
                isOpen={!!diagram}
                source={diagram?.source || null}
                onClose={() => setDiagram(null)}
                onApply={(g) => flow.applyDiagram(g, diagram?.source || null)}
                byId={itemsById}
                colors={diagramColors}
            />
        </div>
    )
}

export default SandBoxPage
