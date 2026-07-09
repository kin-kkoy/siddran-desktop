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
import BrushSettings from '../../components/Sandbox/Toolbar/BrushSettings'
import AttachedNoteCard from '../../components/Sandbox/Cards/AttachedNoteCard'
import AttachedTaskCard from '../../components/Sandbox/Cards/AttachedTaskCard'
import TextBoxCard from '../../components/Sandbox/Cards/TextBoxCard'
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
import { useSandboxView } from '../../contexts/SandboxViewContext'
import { useApi } from '../../contexts/ApiContext'
import { uploadImageFile } from '../../utils/imageUpload'
import { toast } from '../../utils/toast'

const CARD_TYPES = new Set(['note', 'task', 'text'])

const isEditable = (el) => {
    if (!el) return false
    const tag = el.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
}

// Per-shape keys were dropped — `S` opens the shape picker and the shape is
// chosen with the mouse/pen instead.
const TOOL_KEYS = { v: 'pointer', g: 'lasso', p: 'pen', e: 'eraser', t: 'text', h: 'hand' }

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
    const canvas = useSandboxCanvas(mode === 'half' ? 'pointer' : 'pen')

    const [notePickerOpen, setNotePickerOpen] = useState(false)
    const [taskPickerOpen, setTaskPickerOpen] = useState(false)
    const [titleDraft, setTitleDraft] = useState(sandbox?.title ?? '')
    // Colour palette starts collapsed to a single swatch; opening it tucks the
    // brush box away, and picking a colour brings the brush box back.
    const [paletteOpen, setPaletteOpen] = useState(false)
    const [brushCollapsed, setBrushCollapsed] = useState(false)
    const [shortcutsOpen, setShortcutsOpen] = useState(false)
    const [shapePickerOpen, setShapePickerOpen] = useState(false)
    const [insertMenuOpen, setInsertMenuOpen] = useState(false)
    const [editingShapeId, setEditingShapeId] = useState(null)
    const fileRef = useRef(null)
    const stageRef = useRef(null)

    useEffect(() => { setTitleDraft(sandbox?.title ?? '') }, [sandbox?.id, sandbox?.title])

    useEffect(() => {
        if (sandboxId) {
            try { localStorage.setItem('cinder_last_sandbox', sandboxId) } catch { /* ignore */ }
            view.setActiveSandboxId?.(sandboxId)
        }
    }, [sandboxId, view])

    const bump = useCallback(() => { if (sandboxId) touch(sandboxId) }, [sandboxId, touch])
    const nextZ = useCallback(() => items.reduce((m, it) => Math.max(m, it.z_index ?? 0), 0) + 1, [items])

    // Item buckets, z-sorted for paint order. Strokes + shapes + images share
    // ONE Konva layer so z-order works across all graphic types.
    const graphicItems = useMemo(() => sortByZ(items.filter(i => !CARD_TYPES.has(i.type) && i.type !== 'connector')), [items])
    const connectorItems = useMemo(() => sortByZ(items.filter(i => i.type === 'connector')), [items])
    const cardItems = useMemo(() => sortByZ(items.filter(i => CARD_TYPES.has(i.type))), [items])
    const selectedItems = useMemo(() => items.filter(i => canvas.selectedIds.has(i.id)), [items, canvas.selectedIds])

    // Fill-bucket "on" state reflects the SELECTED shape(s) if any are selected
    // (so it lights up when a filled shape is picked), else the default style.
    const fillOn = useMemo(() => {
        const shapes = selectedItems.filter(i => i.type === 'shape')
        if (shapes.length) return shapes.some(s => s.payload?.fill && s.payload.fill !== 'transparent')
        return canvas.shapeStyle.fill !== 'transparent'
    }, [selectedItems, canvas.shapeStyle.fill])

    // ---- commits ----
    const onStrokeCommit = useCallback((partial) => { act.addItem({ ...partial, z_index: nextZ() }); bump() }, [act, nextZ, bump])
    const onShapeCommit = useCallback((partial) => { act.addItem({ ...partial, z_index: nextZ() }); bump() }, [act, nextZ, bump])
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
        if (additive) canvas.toggleSelection(id)
        else canvas.selectOnly(id)
        setEditingShapeId(null)
    }, [canvas])
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
        const ids = [...canvas.selectedIds]
        if (ids.length === 0) return
        const orphans = connectorsAttachedTo(new Set(ids))
        beginTransaction()
        ids.forEach(id => act.removeItem(id))
        orphans.forEach(cid => act.removeItem(cid))
        endTransaction()
        canvas.clearSelection()
        bump()
    }, [canvas, connectorsAttachedTo, act, beginTransaction, endTransaction, bump])

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
        const res = exportStagePNG(stageRef.current, graphicItems, sandbox?.title)
        if (!res.ok) toast.error(res.reason === 'empty' ? 'Nothing to export yet.' : 'Export failed.')
        else toast.success('Exported PNG (cards not included)')
    }, [graphicItems, sandbox?.title])

    // ---- placement ----
    const centerWorld = useCallback(() => canvas.worldFromScreen({ x: window.innerWidth / 2, y: window.innerHeight / 2 }), [canvas])

    const onPickNote = (note) => {
        const w = centerWorld()
        act.addItem({ type: 'note', x: w.x - 100, y: w.y - 46, w: 200, h: 92, rotation: 0, z_index: nextZ(), payload: { noteId: note.id } })
        setNotePickerOpen(false)
        bump()
        toast.success(`Attached "${note.title || 'Untitled'}"`)
    }
    const onPickTask = (task) => {
        const w = centerWorld()
        act.addItem({ type: 'task', x: w.x - 110, y: w.y - 55, w: 220, h: 110, rotation: 0, z_index: nextZ(), payload: { taskId: task.id } })
        setTaskPickerOpen(false)
        bump()
        toast.success(`Attached "${task.title || 'Untitled task'}"`)
    }

    const onPlaceText = useCallback((world) => {
        const created = act.addItem({
            type: 'text', x: world.x, y: world.y, w: 180, h: 44, rotation: 0, z_index: nextZ(),
            payload: { text: '', fontSize: 18, color: canvas.strokeColor },
        })
        canvas.setTool('pointer')
        canvas.selectOnly(created.id)
        bump()
    }, [act, nextZ, canvas, bump])

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

    // ---- color ----
    const onColorChange = useCallback((value) => {
        canvas.setStrokeColor(value)
        canvas.setShapeStyle(prev => ({ ...prev, stroke: value, fill: prev.fill !== 'transparent' ? value : 'transparent' }))
        setPaletteOpen(false)
        setBrushCollapsed(false)   // picking a colour restores the brush box
    }, [canvas])

    const onTogglePalette = useCallback(() => {
        setPaletteOpen(open => {
            const next = !open
            setBrushCollapsed(next)   // open → tuck brush box away; close → restore it
            return next
        })
    }, [])
    const closePalette = useCallback(() => { setPaletteOpen(false); setBrushCollapsed(false) }, [])
    const onToggleShapePicker = useCallback(() => { setShapePickerOpen(v => !v) }, [])
    const closeShapePicker = useCallback(() => { setShapePickerOpen(false) }, [])
    const onToggleInsertMenu = useCallback(() => { setInsertMenuOpen(v => !v) }, [])
    const closeInsertMenu = useCallback(() => { setInsertMenuOpen(false) }, [])

    // ---- shape text editing (Wave 3) ----
    const onShapeDoubleClick = useCallback((id) => {
        canvas.selectOnly(id)
        setEditingShapeId(id)
    }, [canvas])

    const onUpdateShapePayload = useCallback((id, patch) => {
        const item = items.find(i => i.id === id)
        if (!item) return
        act.updateItem(id, { payload: { ...item.payload, ...patch } })
        bump()
    }, [items, act, bump])
    const onToggleFill = useCallback(() => {
        // Default style for future shapes.
        canvas.setShapeStyle(prev => ({ ...prev, fill: prev.fill === 'transparent' ? canvas.strokeColor : 'transparent' }))
        // If shapes are selected, toggle their fill too (current colour ⇄ transparent).
        const selectedShapes = items.filter(i => i.type === 'shape' && canvas.selectedIds.has(i.id))
        if (selectedShapes.length === 0) return
        beginTransaction()
        selectedShapes.forEach(s => {
            const filled = s.payload?.fill && s.payload.fill !== 'transparent'
            act.updateItem(s.id, { payload: { ...s.payload, fill: filled ? 'transparent' : canvas.strokeColor } })
        })
        endTransaction()
        bump()
    }, [canvas, items, act, beginTransaction, endTransaction, bump])

    // ---- keyboard-driven actions ----
    const selectAll = useCallback(() => { canvas.setSelection(new Set(items.map(i => i.id))) }, [canvas, items])

    const duplicateSelection = useCallback(() => {
        const sel = items.filter(i => canvas.selectedIds.has(i.id))
        if (!sel.length) return
        beginTransaction()
        const base = nextZ()
        const newIds = []
        sel.forEach((it, i) => {
            const created = act.addItem({ ...it, id: undefined, x: it.x + 16, y: it.y + 16, z_index: base + i })
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
        sel.forEach(it => act.updateItem(it.id, { x: it.x + dx, y: it.y + dy }))
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
            if (meta) return // leave other ⌘ combos alone

            if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); return }
            if (e.key === 'Escape') { setShortcutsOpen(false); canvas.clearSelection(); return }
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
            if (e.key === 's' || e.key === 'S') { e.preventDefault(); setShapePickerOpen(o => !o); return }

            const t = TOOL_KEYS[e.key.toLowerCase()]
            if (t) canvas.setTool(t)
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [undo, redo, deleteSelection, onZOrder, canvas, duplicateSelection, selectAll, resetZoom, fitToContent, nudgeSelection])

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

    const cardEls = cardItems.map(item => {
        const shared = {
            item, zoom: canvas.viewport.zoom, tool: canvas.tool,
            selected: canvas.selectedIds.has(item.id), onSelect,
            onUpdate: act.updateItem, onRemove: onErase, beginTransaction, endTransaction,
        }
        if (item.type === 'note') return <AttachedNoteCard key={item.id} {...shared} notes={notes} />
        if (item.type === 'task') return <AttachedTaskCard key={item.id} {...shared} tasks={tasks} onToggleTask={toggleTaskCompletion} />
        return <TextBoxCard key={item.id} {...shared} />
    })

    return (
        <div className={mode === 'half' ? styles.pageHalf : styles.page}>
            <header className={styles.header}>
                <ExpandSidebarButton />
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
                    onToolChange={canvas.setTool}
                    color={canvas.strokeColor}
                    onColorChange={onColorChange}
                    paletteOpen={paletteOpen}
                    onTogglePalette={onTogglePalette}
                    onClosePalette={closePalette}
                    shapePickerOpen={shapePickerOpen}
                    onToggleShapePicker={onToggleShapePicker}
                    onCloseShapePicker={closeShapePicker}
                    insertMenuOpen={insertMenuOpen}
                    onToggleInsertMenu={onToggleInsertMenu}
                    onCloseInsertMenu={closeInsertMenu}
                    fillOn={fillOn}
                    onToggleFill={onToggleFill}
                    onAttachNoteClick={() => setNotePickerOpen(true)}
                    onAttachTaskClick={() => setTaskPickerOpen(true)}
                    onPickImage={onPickImageClick}
                    onUndo={undo}
                    onRedo={redo}
                    canUndo={canUndo}
                    canRedo={canRedo}
                    snapEnabled={canvas.snapEnabled}
                    onToggleSnap={() => canvas.setSnapEnabled(v => !v)}
                    onExport={onExport}
                />

                {canvas.tool === 'pen' && (
                    <BrushSettings
                        brush={canvas.brush}
                        onChange={canvas.setBrush}
                        onReset={canvas.resetBrush}
                        collapsed={brushCollapsed}
                        onCollapsedChange={setBrushCollapsed}
                    />
                )}

                <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onFileChange} />

                <SandboxCanvas
                    canvas={canvas}
                    items={items}
                    graphicItems={graphicItems}
                    connectorItems={connectorItems}
                    stageRef={stageRef}
                    onStrokeCommit={onStrokeCommit}
                    onShapeCommit={onShapeCommit}
                    onSelect={onSelect}
                    onMarqueeSelect={onMarqueeSelect}
                    onErase={onErase}
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
                            beginTransaction={beginTransaction}
                            endTransaction={endTransaction}
                            editingShapeId={editingShapeId}
                        />
                    }
                    onShapeDoubleClick={onShapeDoubleClick}
                    editingShapeId={editingShapeId}
                />

                {editingShapeId && (() => {
                    const editItem = items.find(i => i.id === editingShapeId)
                    if (!editItem || editItem.type !== 'shape') return null
                    return (
                        <ShapeTextEditor
                            item={editItem}
                            canvas={canvas}
                            onCommit={(id, patch) => { onUpdateShapePayload(id, patch) }}
                            onClose={() => setEditingShapeId(null)}
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
        </div>
    )
}

export default SandBoxPage
