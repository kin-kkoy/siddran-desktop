import { useMemo } from 'react'
import {
    LuBringToFront, LuSendToBack, LuCopy, LuTrash2,
    LuAlignStartVertical, LuAlignCenterVertical, LuAlignEndVertical,
    LuAlignStartHorizontal, LuAlignCenterHorizontal, LuAlignEndHorizontal,
    LuAlignHorizontalDistributeCenter, LuAlignVerticalDistributeCenter,
} from 'react-icons/lu'
import styles from './ContextToolbar.module.css'
import { getSelectionBounds, getOrientedAnchors } from './itemBounds'
import { connectorPoints, connectorMidpoint } from '../connectors/geometry'

const STROKE_COLORS = ['#e2ddf5', '#f0b840', '#5a9cf0', '#e05c5c', '#52c47a', '#ffffff']

/**
 * Floating contextual action bar — sits above the current selection and follows
 * pan/zoom (positioned via screenFromWorld inside the canvas container). It is
 * the home for selection-dependent actions so the dock stays slim:
 *   • shape selections also get text/style controls
 *   • a single connector gets its own line controls
 *   • everything gets Arrange (front/back), Align (≥2), Duplicate, Delete
 */

const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 36, 48]

const TEXT_COLORS = [
    '#ffffff', '#e2ddf5', '#f0b840', '#5a9cf0', '#e05c5c', '#52c47a', '#000000',
]

// Alignment grid (shown when ≥2 items selected). Distribute needs ≥3.
const ALIGN_OPS = [
    { op: 'left', title: 'Align left', Icon: LuAlignStartVertical, min: 2 },
    { op: 'centerX', title: 'Align centre (H)', Icon: LuAlignCenterVertical, min: 2 },
    { op: 'right', title: 'Align right', Icon: LuAlignEndVertical, min: 2 },
    { op: 'distH', title: 'Distribute horizontally', Icon: LuAlignHorizontalDistributeCenter, min: 3 },
    { op: 'top', title: 'Align top', Icon: LuAlignStartHorizontal, min: 2 },
    { op: 'middle', title: 'Align middle (V)', Icon: LuAlignCenterHorizontal, min: 2 },
    { op: 'bottom', title: 'Align bottom', Icon: LuAlignEndHorizontal, min: 2 },
    { op: 'distV', title: 'Distribute vertically', Icon: LuAlignVerticalDistributeCenter, min: 3 },
]

const GAP = 48  // px above the selection top in screen space

function ContextToolbar({
    selectedItems,
    items,
    canvas,
    onUpdatePayload,
    onBringFront,
    onSendBack,
    onAlign,
    onDuplicate,
    onDelete,
    beginTransaction,
    endTransaction,
    editingShapeId,
}) {
    const shapes = useMemo(
        () => selectedItems.filter(it => it.type === 'shape'),
        [selectedItems],
    )
    const connectors = useMemo(
        () => selectedItems.filter(it => it.type === 'connector'),
        [selectedItems],
    )
    const byId = useMemo(() => new Map((items || []).map(i => [i.id, i])), [items])

    // ── Connector bar — exactly one connector selected (no shapes) ──
    if (!editingShapeId && shapes.length === 0 && selectedItems.length === 1 && connectors.length === 1) {
        const conn = connectors[0]
        const cp = conn.payload || {}
        const pts = connectorPoints(conn, byId)
        const mid = pts && connectorMidpoint(pts)
        if (!mid) return null
        const midScreen = canvas.screenFromWorld(mid)
        const cStyle = { left: midScreen.x, top: midScreen.y - GAP, transform: 'translate(-50%, -100%)' }
        const setPayload = (updates) => { beginTransaction(); onUpdatePayload(conn.id, updates); endTransaction() }
        const stroke = cp.stroke || '#e2ddf5'
        const width = cp.strokeWidth || 2
        const elbow = (cp.routing || 'elbow') === 'elbow'
        const cycleStroke = () => {
            const i = STROKE_COLORS.indexOf(stroke)
            setPayload({ stroke: STROKE_COLORS[(i + 1) % STROKE_COLORS.length] })
        }
        return (
            <div className={styles.bar} style={cStyle} data-sb-handle="true" onPointerDown={(e) => e.stopPropagation()}>
                <button className={styles.swatch} style={{ backgroundColor: stroke }}
                    onClick={cycleStroke} title="Line colour" aria-label="Line colour" />
                <div className={styles.sep} />
                <button className={styles.btn} onClick={() => setPayload({ strokeWidth: Math.max(1, width - 1) })}
                    title="Thinner" aria-label="Thinner">−</button>
                <span className={styles.radiusValue}>{width}</span>
                <button className={styles.btn} onClick={() => setPayload({ strokeWidth: Math.min(8, width + 1) })}
                    title="Thicker" aria-label="Thicker">+</button>
                <div className={styles.sep} />
                <button className={elbow ? styles.btnActive : styles.btn}
                    onClick={() => setPayload({ routing: elbow ? 'straight' : 'elbow' })}
                    title={elbow ? 'Elbow (click for straight)' : 'Straight (click for elbow)'}
                    aria-label="Toggle routing">{elbow ? '⌐' : '╱'}</button>
                <div className={styles.sep} />
                <button className={styles.btn} onClick={() => onDelete?.()} title="Delete" aria-label="Delete">✕</button>
            </div>
        )
    }

    // ── General bar — any selection of boxed items (connectors have no box) ──
    const boxItems = selectedItems.filter(it => it.type !== 'connector')
    const box = boxItems.length > 0 ? getSelectionBounds(boxItems) : null
    if (!box || editingShapeId) return null

    // Position: top-center of selection, in screen coords
    const topScreen = canvas.screenFromWorld(getOrientedAnchors(box).n)
    const style = { left: topScreen.x, top: topScreen.y - GAP, transform: 'translate(-50%, -100%)' }

    const selectedCount = selectedItems.length
    const hasShapes = shapes.length > 0

    // Shape style values (first shape as reference for multi-select)
    const ref = hasShapes ? (shapes[0].payload || {}) : {}
    const fontSize = ref.fontSize || 16
    const bold = !!ref.bold
    const textAlign = ref.textAlign || 'center'
    const textColor = ref.textColor || '#ffffff'
    const radius = ref.radius || 0
    const hasRadius = shapes.some(s => {
        const k = s.payload?.kind
        return k && k !== 'ellipse' && k !== 'line' && k !== 'arrow' && k !== 'elbowArrow' && k !== 'divider'
    })

    // Apply a payload patch to every selected shape, in one undo step.
    const patch = (updates) => {
        beginTransaction()
        shapes.forEach(s => onUpdatePayload(s.id, updates))
        endTransaction()
    }
    const cycleAlign = () => {
        const next = textAlign === 'left' ? 'center' : textAlign === 'center' ? 'right' : 'left'
        patch({ textAlign: next })
    }
    const cycleTextColor = () => {
        const idx = TEXT_COLORS.indexOf(textColor)
        patch({ textColor: TEXT_COLORS[(idx + 1) % TEXT_COLORS.length] })
    }
    const alignIcon = textAlign === 'left' ? '⫷' : textAlign === 'right' ? '⫸' : '☰'

    return (
        <div
            className={styles.bar}
            style={style}
            data-sb-handle="true"
            onPointerDown={(e) => e.stopPropagation()}
        >
            {hasShapes && (
                <>
                    <select
                        className={styles.fontSelect}
                        value={fontSize}
                        onChange={(e) => patch({ fontSize: Number(e.target.value) })}
                        title="Font size"
                    >
                        {FONT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <button className={bold ? styles.btnActive : styles.btn} onClick={() => patch({ bold: !bold })}
                        title="Bold" aria-label="Bold">B</button>
                    <button className={styles.btn} onClick={cycleAlign}
                        title={`Align: ${textAlign}`} aria-label={`Text align: ${textAlign}`}>{alignIcon}</button>
                    <button className={styles.swatch} style={{ backgroundColor: textColor }}
                        onClick={cycleTextColor} title="Text colour" aria-label="Text colour" />
                    {hasRadius && (
                        <div className={styles.radiusGroup}>
                            <input type="range" className={styles.radiusSlider}
                                min={0} max={30} step={1} value={radius}
                                onChange={(e) => patch({ radius: Number(e.target.value) })} title="Corner radius" />
                            <span className={styles.radiusValue}>{radius}</span>
                        </div>
                    )}
                    <div className={styles.sep} />
                </>
            )}

            {/* Arrange */}
            <button className={styles.btn} onClick={() => onBringFront?.()} title="Bring to front (])" aria-label="Bring to front">
                <LuBringToFront size={15} />
            </button>
            <button className={styles.btn} onClick={() => onSendBack?.()} title="Send to back ([)" aria-label="Send to back">
                <LuSendToBack size={15} />
            </button>

            {/* Align / distribute — multi-select only */}
            {selectedCount >= 2 && (
                <>
                    <div className={styles.sep} />
                    <div className={styles.alignGrid}>
                        {ALIGN_OPS.map(a => (
                            <button key={a.op} className={styles.miniBtn} title={a.title} aria-label={a.title}
                                disabled={selectedCount < a.min} onClick={() => onAlign?.(a.op)}>
                                <a.Icon size={12} />
                            </button>
                        ))}
                    </div>
                </>
            )}

            <div className={styles.sep} />
            <button className={styles.btn} onClick={() => onDuplicate?.()} title="Duplicate (⌘D)" aria-label="Duplicate">
                <LuCopy size={14} />
            </button>
            <button className={styles.btn} onClick={() => onDelete?.()} title="Delete (Del)" aria-label="Delete">
                <LuTrash2 size={14} />
            </button>
        </div>
    )
}

export default ContextToolbar
