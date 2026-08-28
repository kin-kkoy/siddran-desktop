import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './DiagramEditorOverlay.module.css'
import SandboxCanvas from '../Sandbox/Canvas/SandboxCanvas'
import SelectionOverlay from '../Sandbox/selection/SelectionOverlay'
import ContextToolbar from '../Sandbox/selection/ContextToolbar'
import ShapeTextEditor from '../Sandbox/selection/ShapeTextEditor'
import ShapePicker from '../Sandbox/Toolbar/ShapePicker'
import { sortByZ, reorder } from '../Sandbox/selection/zorder'
import { alignPatches } from '../Sandbox/selection/align'
import { unionAABB } from '../Sandbox/selection/snapping'
import { SHAPE_TOOLS } from '../Sandbox/shapes/registry'
import { useSandboxCanvas } from '../../hooks/useSandboxCanvas'
import { useSandboxHistory } from '../../hooks/useSandboxHistory'
import { useDiagramItems } from '../../hooks/useDiagramItems'
import { LuMousePointer2, LuHand, LuShapes, LuEraser, LuUndo2, LuRedo2, LuX, LuCheck } from 'react-icons/lu'

/**
 * Edit a note's diagram, using the Sandbox's own canvas.
 *
 * The decision was "view inline, edit in an overlay", and the overlay is the
 * REAL SandboxCanvas — same selection overlay, same context toolbar, same
 * connectors, same undo. What differs is where the items live (useDiagramItems,
 * in memory, belonging to this block) and which tools are offered: the flowchart
 * subset, so a note's diagram cannot quietly become a whole Sandbox with
 * freehand, PDFs and cards in it.
 *
 * Nothing is written to the note until Done. Cancel throws the session away —
 * which is why the items are a local copy rather than a live view of the block.
 */

// The tools a note diagram gets. Freehand ('pen'), lasso, images and cards are
// deliberately absent: they are the reason to open a real Sandbox instead.
//
// 'text' is absent too, and that is not an oversight. The Sandbox's text tool
// places a standalone TEXT CARD, which is DOM rather than Konva — it is not part
// of the flowchart subset and diagramSvg.js cannot draw one, so offering the tool
// would let a note hold a diagram that renders with pieces missing. Text in a
// diagram is text INSIDE a shape, reached by double-click or Enter.
const ALLOWED_TOOLS = new Set(['pointer', 'hand', 'eraser', ...SHAPE_TOOLS])

// The Sandbox's tool keys, minus the ones whose tools are not offered here — `p`
// (pen), `g` (lasso) and `t` (text card) would switch to a tool this overlay has
// no button for and cannot save. Everything else is the same key as the Sandbox,
// because a diagram IS the Sandbox as far as the muscle memory is concerned.
const TOOL_KEYS = { v: 'pointer', e: 'eraser', h: 'hand' }

// Typing in a shape's text box must not trigger tool switches. Narrower than the
// guard SandBoxPage uses: the note's CodeMirror is `contenteditable` and sits
// right behind this modal, so "is something editable focused?" is not the
// question — "is the thing being typed into part of THIS overlay?" is.
const isEditable = (el) => {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
}

function DiagramEditorOverlay({ doc, onSave, onCancel }) {
  const base = useDiagramItems(doc?.items)
  const { items } = base
  const history = useSandboxHistory(base)
  const { do: act, undo, redo, canUndo, canRedo, beginTransaction, endTransaction } = history
  const canvas = useSandboxCanvas('pointer')

  const [shapePickerOpen, setShapePickerOpen] = useState(false)
  const [editingShapeId, setEditingShapeId] = useState(null)
  const shapeBtnRef = useRef(null)
  const stageRef = useRef(null)
  const canvasWrapRef = useRef(null)   // measured by fitToContent ('1')
  const hostRef = useRef(null)

  const nextZ = useCallback(
    () => items.reduce((m, it) => Math.max(m, it.z_index ?? 0), 0) + 1,
    [items],
  )

  // Same buckets the Sandbox page builds. No card types here — the subset has
  // none — but connectors still need their own layer so links paint behind boxes.
  const graphicItems = useMemo(() => sortByZ(items.filter(i => i.type !== 'connector')), [items])
  const connectorItems = useMemo(() => sortByZ(items.filter(i => i.type === 'connector')), [items])
  const selectedItems = useMemo(() => items.filter(i => canvas.selectedIds.has(i.id)), [items, canvas.selectedIds])

  // ── commits ────────────────────────────────────────────────────────────────

  const onShapeCommit = useCallback((partial) => {
    act.addItem({ ...partial, z_index: nextZ() })
  }, [act, nextZ])

  const onCreateConnector = useCallback((payload) => {
    act.addItem({
      type: 'connector', x: 0, y: 0, w: 0, h: 0, rotation: 0, z_index: nextZ(),
      payload: { routing: 'elbow', head: 'arrow', stroke: canvas.strokeColor, strokeWidth: 2, ...payload },
    })
  }, [act, nextZ, canvas.strokeColor])

  // ── selection ──────────────────────────────────────────────────────────────

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

  // Deleting a shape has to take its links with it, or the block would be saved
  // with connectors pointing at nothing — parseDiagram drops those on the next
  // read, so the drawing would silently lose arrows between one save and one open.
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
  }, [connectorsAttachedTo, act, beginTransaction, endTransaction])

  const deleteSelection = useCallback(() => {
    const ids = [...canvas.selectedIds]
    if (!ids.length) return
    const orphans = connectorsAttachedTo(new Set(ids))
    beginTransaction()
    ids.forEach(id => act.removeItem(id))
    orphans.forEach(cid => act.removeItem(cid))
    endTransaction()
    canvas.clearSelection()
  }, [canvas, connectorsAttachedTo, act, beginTransaction, endTransaction])

  const duplicateSelection = useCallback(() => {
    const sel = items.filter(i => canvas.selectedIds.has(i.id))
    if (!sel.length) return
    beginTransaction()
    const z = nextZ()
    const ids = []
    sel.forEach((it, i) => {
      const created = act.addItem({ ...it, id: undefined, x: it.x + 16, y: it.y + 16, z_index: z + i })
      ids.push(created.id)
    })
    endTransaction()
    canvas.setSelection(new Set(ids))
  }, [items, canvas, act, nextZ, beginTransaction, endTransaction])

  const onZOrder = useCallback((op) => {
    const patches = reorder(items, canvas.selectedIds, op)
    if (!patches.length) return
    beginTransaction()
    patches.forEach(p => act.updateItem(p.id, { z_index: p.z_index }))
    endTransaction()
  }, [items, canvas.selectedIds, act, beginTransaction, endTransaction])

  const onAlign = useCallback((op) => {
    const sel = items.filter(i => canvas.selectedIds.has(i.id) && i.type !== 'connector')
    const patches = alignPatches(sel, op)
    if (!patches.length) return
    beginTransaction()
    patches.forEach(p => act.updateItem(p.id, p))
    endTransaction()
  }, [items, canvas.selectedIds, act, beginTransaction, endTransaction])

  // ── shape text ─────────────────────────────────────────────────────────────

  const onShapeDoubleClick = useCallback((id) => {
    canvas.selectOnly(id)
    setEditingShapeId(id)
  }, [canvas])

  const onUpdateShapePayload = useCallback((id, patch) => {
    const item = items.find(i => i.id === id)
    if (!item) return
    act.updateItem(id, { payload: { ...item.payload, ...patch } })
  }, [items, act])

  // ── tools ──────────────────────────────────────────────────────────────────

  const setTool = useCallback((tool) => {
    if (!ALLOWED_TOOLS.has(tool)) return
    canvas.setTool(tool)
  }, [canvas])

  const isShapeTool = SHAPE_TOOLS.includes(canvas.tool)

  // ── save / cancel ──────────────────────────────────────────────────────────

  const save = useCallback(() => {
    // Commit an open text edit first, or the last thing typed into a shape is
    // lost by the very action meant to keep it.
    setEditingShapeId(null)
    onSave(base.itemsRef.current)
  }, [onSave, base])

  const selectAll = useCallback(() => {
    canvas.setSelection(new Set(items.map(i => i.id)))
  }, [canvas, items])

  const nudgeSelection = useCallback((dx, dy) => {
    const sel = items.filter(i => canvas.selectedIds.has(i.id) && i.type !== 'connector')
    if (!sel.length) return
    beginTransaction()
    sel.forEach(it => act.updateItem(it.id, { x: it.x + dx, y: it.y + dy }))
    endTransaction()
  }, [items, canvas.selectedIds, act, beginTransaction, endTransaction])

  const fitToContent = useCallback(() => {
    const b = unionAABB(items.filter(i => i.type !== 'connector'))
    if (!b) { canvas.setViewport({ x: 0, y: 0, zoom: 1 }); return }
    const el = canvasWrapRef.current
    const w = el?.clientWidth || 800
    const h = el?.clientHeight || 500
    const pad = 48
    const zoom = Math.max(0.1, Math.min(2, Math.min((w - pad) / (b.w || 1), (h - pad) / (b.h || 1))))
    canvas.setViewport({
      x: w / 2 - (b.x + b.w / 2) * zoom,
      y: h / 2 - (b.y + b.h / 2) * zoom,
      zoom,
    })
  }, [items, canvas])

  // The same shortcuts the Sandbox has, so the two do not disagree about what a
  // key means.
  //
  // Bound on window in the CAPTURE phase, and that is load-bearing rather than a
  // detail. The note's CodeMirror is `contenteditable` and sits directly behind
  // this modal; if focus is still there — and a click that opens the overlay
  // preventDefaults, so it often is — then a bubble-phase listener runs only
  // AFTER the editor has already inserted the character. Pressing `s` for the
  // shape picker would type an "s" into the note. Capturing first, swallowing the
  // event, and pulling focus back is what makes the overlay actually modal.
  useEffect(() => {
    const onKeyDown = (e) => {
      const active = document.activeElement
      const inOverlay = !!hostRef.current?.contains(active)
      if (!inOverlay) hostRef.current?.focus()

      const stop = () => { e.preventDefault(); e.stopPropagation() }

      // Typing into a shape's own text box: leave every key alone except the one
      // that gets back out of it.
      if (inOverlay && isEditable(active)) {
        if (e.key === 'Escape') { stop(); setEditingShapeId(null) }
        return
      }

      const mod = e.ctrlKey || e.metaKey

      if (mod && (e.key === 'z' || e.key === 'Z')) {
        stop()
        if (e.shiftKey) redo(); else undo()
        return
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) { stop(); redo(); return }
      if (mod && (e.key === 'd' || e.key === 'D')) { stop(); duplicateSelection(); return }
      if (mod && (e.key === 'a' || e.key === 'A')) { stop(); selectAll(); return }
      if (mod && e.key === '0') { stop(); canvas.setViewport({ x: 0, y: 0, zoom: 1 }); return }
      if (mod) { if (!inOverlay) stop(); return }

      // Escape unwinds one layer at a time, so it can never discard the session
      // by accident: text box → selection → close.
      if (e.key === 'Escape') {
        stop()
        if (editingShapeId) { setEditingShapeId(null); return }
        if (canvas.selectedIds.size) { canvas.clearSelection(); return }
        onCancel()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') { stop(); deleteSelection(); return }
      if (e.key === ']') { stop(); onZOrder('front'); return }
      if (e.key === '[') { stop(); onZOrder('back'); return }
      if (e.key === '1') { stop(); fitToContent(); return }

      if (e.key.startsWith('Arrow')) {
        stop()
        const d = e.shiftKey ? 10 : 1
        if (e.key === 'ArrowUp') nudgeSelection(0, -d)
        else if (e.key === 'ArrowDown') nudgeSelection(0, d)
        else if (e.key === 'ArrowLeft') nudgeSelection(-d, 0)
        else if (e.key === 'ArrowRight') nudgeSelection(d, 0)
        return
      }

      // Enter (or F2) labels the selected shape — the same thing double-clicking
      // it does, but reachable from the keyboard.
      if (e.key === 'Enter' || e.key === 'F2') {
        const only = canvas.selectedIds.size === 1 ? [...canvas.selectedIds][0] : null
        const target = only && items.find(i => i.id === only && i.type === 'shape')
        if (target) { stop(); setEditingShapeId(target.id) }
        else if (!inOverlay) stop()
        return
      }

      if (e.key === 's' || e.key === 'S') { stop(); setShapePickerOpen(o => !o); return }

      const tool = TOOL_KEYS[e.key.toLowerCase()]
      if (tool) { stop(); setTool(tool); return }

      // Nothing of ours, but the note behind must not receive it either.
      if (!inOverlay) stop()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [
    editingShapeId, onCancel, undo, redo, duplicateSelection, deleteSelection,
    selectAll, nudgeSelection, fitToContent, onZOrder, setTool, canvas, items,
  ])

  const editItem = editingShapeId ? items.find(i => i.id === editingShapeId) : null

  return createPortal(
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label="Edit diagram">
      <div className={styles.panel} ref={hostRef} tabIndex={-1}>
        <div className={styles.header}>
          <div className={styles.tools}>
            <ToolBtn active={canvas.tool === 'pointer'} title="Select (V)" onClick={() => setTool('pointer')}>
              <LuMousePointer2 size={16} />
            </ToolBtn>
            <ToolBtn active={canvas.tool === 'hand'} title="Pan (Space)" onClick={() => setTool('hand')}>
              <LuHand size={16} />
            </ToolBtn>
            <span ref={shapeBtnRef}>
              <ToolBtn active={isShapeTool} title="Shapes (S)" onClick={() => setShapePickerOpen(v => !v)}>
                <LuShapes size={16} />
              </ToolBtn>
            </span>
            <ShapePicker
              open={shapePickerOpen}
              tool={canvas.tool}
              anchorRef={shapeBtnRef}
              onPick={(kind) => { setTool(kind); setShapePickerOpen(false) }}
              onClose={() => setShapePickerOpen(false)}
            />
            <ToolBtn active={canvas.tool === 'eraser'} title="Eraser (E)" onClick={() => setTool('eraser')}>
              <LuEraser size={16} />
            </ToolBtn>
            <div className={styles.divider} />
            <ToolBtn disabled={!canUndo} title="Undo (Ctrl+Z)" onClick={undo}><LuUndo2 size={16} /></ToolBtn>
            <ToolBtn disabled={!canRedo} title="Redo (Ctrl+Shift+Z)" onClick={redo}><LuRedo2 size={16} /></ToolBtn>
          </div>

          <div className={styles.actions}>
            <span className={styles.tip}>Edge dot connects · Enter labels</span>
            <button type="button" className={styles.cancel} onClick={onCancel}>
              <LuX size={15} /> Cancel
            </button>
            <button type="button" className={styles.done} onClick={save}>
              <LuCheck size={15} /> Done
            </button>
          </div>
        </div>

        <div className={styles.canvasWrap} ref={canvasWrapRef}>
          <SandboxCanvas
            canvas={canvas}
            items={items}
            graphicItems={graphicItems}
            connectorItems={connectorItems}
            stageRef={stageRef}
            onShapeCommit={onShapeCommit}
            onSelect={onSelect}
            onMarqueeSelect={onMarqueeSelect}
            onErase={onErase}
            onShapeDoubleClick={onShapeDoubleClick}
            editingShapeId={editingShapeId}
            beginTransaction={beginTransaction}
            endTransaction={endTransaction}
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
          />
          {editItem && editItem.type === 'shape' && (
            <ShapeTextEditor
              item={editItem}
              canvas={canvas}
              onCommit={(id, patch) => onUpdateShapePayload(id, patch)}
              onClose={() => setEditingShapeId(null)}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function ToolBtn({ active, disabled, title, onClick, children }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      className={`${styles.toolBtn} ${active ? styles.toolActive : ''}`}
      // pointerdown + preventDefault so pressing a tool never steals focus from
      // the canvas mid-gesture, matching SandboxToolbar's buttons.
      onPointerDown={(e) => { e.preventDefault() }}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export default DiagramEditorOverlay
