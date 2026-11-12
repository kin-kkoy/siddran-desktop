import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
    LuBringToFront, LuSendToBack, LuCopy, LuTrash2,
    LuAlignStartVertical, LuAlignCenterVertical, LuAlignEndVertical,
    LuAlignStartHorizontal, LuAlignCenterHorizontal, LuAlignEndHorizontal,
    LuAlignHorizontalDistributeCenter, LuAlignVerticalDistributeCenter,
    LuCornerRightDown, LuCable, LuNetwork, LuClipboardCopy,
    LuBold, LuItalic, LuUnderline, LuStrikethrough,
    LuAlignLeft, LuAlignCenter, LuAlignRight, LuAlignJustify,
    LuAlignVerticalJustifyStart, LuAlignVerticalJustifyCenter, LuAlignVerticalJustifyEnd,
    LuLock, LuLockOpen, LuGroup, LuUngroup, LuArrowLeftRight, LuImageDown, LuFrame, LuPaintBucket,
} from 'react-icons/lu'
import styles from './ContextToolbar.module.css'
import { getSelectionBounds, getOrientedAnchors } from './itemBounds'
import { connectorPoints, connectorMidpoint } from '../connectors/geometry'
import { HEAD_TYPES, HEAD_LABELS } from '../connectors/heads'
import { LINE_STYLES, lineStyleOf } from '../connectors/lineStyle'
import { SHAPES, SHAPE_GROUPS, shapesInGroup, isLineKind } from '../shapes/registry'
import { FONT_FAMILIES, FONT_SIZES, TEXT_PRESETS, stepFontSize, STICKY_COLORS } from '../text/textStyle'
import { isFrame, FRAME_FILLS } from '../frames/frames'

/**
 * Floating contextual action bar — sits above the current selection and follows
 * pan/zoom (positioned via screenFromWorld inside the canvas container). It is
 * the home for selection-dependent actions so the dock stays slim:
 *   • text row — for shapes AND text cards: style preset, font, size, B/I/U/S,
 *     alignment (horizontal; vertical for shapes), colour
 *   • style row — shape fill/border/width/line style/corners/kind, sticky and
 *     frame colours, flowchart actions, arrange, align, group, lock, duplicate
 *   • a single connector gets its own bar: colour, width, routing, both ends,
 *     line style, reverse, label
 *
 * Every control writes one undo step (beginTransaction/endTransaction around a
 * patch to each selected item).
 */

// Canvas colours: theme-neutral enough to read on the dark board and in exports.
const PALETTE = [
    '#e2ddf5', '#ffffff', '#9e9bb5', '#1f2430', '#f0b840', '#ffb84d', '#ff7a6b', '#e05c5c',
    '#ff9ec4', '#c39bff', '#5a9cf0', '#a9d8ff', '#6fd6c4', '#52c47a', '#d6e86b', '#000000',
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

const H_ALIGN = [
    { v: 'left', Icon: LuAlignLeft, title: 'Align text left' },
    { v: 'center', Icon: LuAlignCenter, title: 'Centre text' },
    { v: 'right', Icon: LuAlignRight, title: 'Align text right' },
    { v: 'justify', Icon: LuAlignJustify, title: 'Justify' },
]
const V_ALIGN = [
    { v: 'top', Icon: LuAlignVerticalJustifyStart, title: 'Text to top' },
    { v: 'middle', Icon: LuAlignVerticalJustifyCenter, title: 'Text to middle' },
    { v: 'bottom', Icon: LuAlignVerticalJustifyEnd, title: 'Text to bottom' },
]

const ROUTINGS = [
    { v: 'straight', label: '╱', title: 'Straight' },
    { v: 'elbow', label: '⌐', title: 'Elbow' },
    { v: 'curved', label: '∿', title: 'Curved' },
]
const LINE_GLYPH = { solid: '━', dashed: '┅', dotted: '┈' }
const HEAD_GLYPH = { none: '—', arrow: '▶', open: '›', triangle: '▷', circle: '●', diamond: '◇', bar: '┃' }

const GAP = 72  // px between the selection top and the bar, in screen space
// The bar is up to two rows tall. Placed above a selection near the top of the
// view it would be cut off by the canvas edge, so it pins just inside instead.
const BAR_ROOM = 150

function barPosition(x, anchorY) {
    const top = anchorY - GAP
    if (top < BAR_ROOM) return { left: x, top: 8, transform: 'translate(-50%, 0)' }
    return { left: x, top, transform: 'translate(-50%, -100%)' }
}

const CONVERTIBLE = SHAPE_GROUPS.filter(g => g.id !== 'line').flatMap(g => shapesInGroup(g.id))

// '#rrggbb' or '#rrggbbaa' → { hex: '#rrggbb', alpha: 0–100 }
function splitColor(v) {
    const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(v || '')
    if (!m) return { hex: '#ffffff', alpha: 100 }
    return { hex: `#${m[1]}`, alpha: m[2] ? Math.round(parseInt(m[2], 16) / 2.55) : 100 }
}
const joinColor = (hex, alpha) => (alpha >= 100 ? hex : `${hex}${Math.round(alpha * 2.55).toString(16).padStart(2, '0')}`)

/** Any colour, with transparency: a native picker plus an opacity slider. */
function CustomColor({ value, onPick }) {
    const { hex, alpha } = splitColor(value)
    return (
        <div className={styles.customColor}>
            <span>Custom</span>
            <input type="color" value={hex} aria-label="Custom colour"
                onChange={(e) => onPick(joinColor(e.target.value, alpha))} />
            <input type="range" min={5} max={100} step={5} value={alpha} className={styles.alphaSlider}
                aria-label="Opacity" title={`Opacity ${alpha}%`}
                style={{ backgroundImage: `linear-gradient(90deg, transparent, ${hex})` }}
                onChange={(e) => onPick(joinColor(hex, Number(e.target.value)))} />
            <span className={styles.alphaValue}>{alpha}%</span>
        </div>
    )
}

/** A colour swatch that opens a small palette under itself. */
function SwatchMenu({ id, open, setOpen, value, colors, title, onPick, allowNone = false, icon = null }) {
    const isOpen = open === id
    const none = !value || value === 'transparent'
    return (
        <span className={styles.menuWrap}>
            <button
                className={icon ? styles.btn : styles.swatch}
                style={icon ? undefined : { backgroundColor: none ? 'transparent' : value, backgroundImage: none ? 'linear-gradient(135deg, transparent 45%, #e05c5c 45%, #e05c5c 55%, transparent 55%)' : undefined }}
                onClick={() => setOpen(isOpen ? null : id)}
                title={title} aria-label={title} aria-expanded={isOpen}
            >
                {icon && (
                    <span className={styles.iconSwatch}>
                        {icon}
                        <span className={styles.iconBar} style={{ backgroundColor: none ? 'transparent' : value }} />
                    </span>
                )}
            </button>
            {isOpen && (
                <div className={styles.menu} role="menu">
                    <div className={styles.paletteGrid}>
                        {allowNone && (
                            <button className={styles.paletteNone} title="None" aria-label="None"
                                onClick={() => { onPick('transparent'); setOpen(null) }} />
                        )}
                        {colors.map(c => (
                            <button key={c} className={c === value ? styles.paletteCellActive : styles.paletteCell}
                                style={{ backgroundColor: c }} title={c} aria-label={c}
                                onClick={() => { onPick(c); setOpen(null) }} />
                        ))}
                    </div>
                    <CustomColor value={value} onPick={onPick} />
                </div>
            )}
        </span>
    )
}

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
    onGroup,
    onUngroup,
    onToggleLock,
    onFrameSelection,
    onExportFrame,
    onEditText,
    beginTransaction,
    endTransaction,
    editingShapeId,
    flow,               // useFlowActions — next / connect / tidy / copy as text
}) {
    const [openMenu, setOpenMenu] = useState(null)
    // Keep the (centred) bar inside the canvas horizontally: nudge it with a
    // margin after layout. Measures the bar against its container once per
    // render — no observer, so nothing feeds back into itself.
    const barRef = useRef(null)
    useLayoutEffect(() => {
        const el = barRef.current
        const host = el?.offsetParent
        if (!el || !host) return
        el.style.marginLeft = '0px'
        const r = el.getBoundingClientRect(), h = host.getBoundingClientRect()
        const pad = 8
        let shift = 0
        if (r.left < h.left + pad) shift = h.left + pad - r.left
        else if (r.right > h.right - pad) shift = h.right - pad - r.right
        el.style.marginLeft = `${shift}px`
    })
    const frames = useMemo(() => selectedItems.filter(isFrame), [selectedItems])
    const shapes = useMemo(() => selectedItems.filter(it => it.type === 'shape' && !isFrame(it)), [selectedItems])
    const texts = useMemo(() => selectedItems.filter(it => it.type === 'text'), [selectedItems])
    const connectors = useMemo(() => selectedItems.filter(it => it.type === 'connector'), [selectedItems])
    const byId = useMemo(() => new Map((items || []).map(i => [i.id, i])), [items])

    // ── Connector bar — exactly one connector selected (no shapes) ──
    if (!editingShapeId && shapes.length === 0 && selectedItems.length === 1 && connectors.length === 1) {
        const conn = connectors[0]
        const cp = conn.payload || {}
        const pts = connectorPoints(conn, byId)
        const mid = pts && connectorMidpoint(pts)
        if (!mid) return null
        const midScreen = canvas.screenFromWorld(mid)
        const cStyle = barPosition(midScreen.x, midScreen.y)
        const setPayload = (updates) => { beginTransaction(); onUpdatePayload(conn.id, updates); endTransaction() }
        const stroke = cp.stroke || '#e2ddf5'
        const width = cp.strokeWidth || 2
        const routing = cp.routing || 'elbow'
        const lstyle = lineStyleOf(cp)
        const head = cp.head || 'arrow'
        const headStart = cp.headStart || 'none'
        const nextStyle = LINE_STYLES[(LINE_STYLES.indexOf(lstyle) + 1) % LINE_STYLES.length]
        return (
            <div ref={barRef} className={styles.bar} style={cStyle} data-sb-handle="true" onPointerDown={(e) => e.stopPropagation()}>
                <div className={styles.row}>
                    <SwatchMenu id="cstroke" open={openMenu} setOpen={setOpenMenu} value={stroke} colors={PALETTE}
                        title="Line colour" onPick={(c) => setPayload({ stroke: c })} />
                    <div className={styles.sep} />
                    <button className={styles.btn} onClick={() => setPayload({ strokeWidth: Math.max(1, width - 1) })}
                        title="Thinner" aria-label="Thinner">−</button>
                    <span className={styles.radiusValue}>{width}</span>
                    <button className={styles.btn} onClick={() => setPayload({ strokeWidth: Math.min(12, width + 1) })}
                        title="Thicker" aria-label="Thicker">+</button>
                    <div className={styles.sep} />
                    {ROUTINGS.map(r => (
                        <button key={r.v} className={routing === r.v ? styles.btnActive : styles.btn}
                            onClick={() => setPayload(r.v === 'straight' ? { routing: r.v } : { routing: r.v, body: null })} title={r.title} aria-label={r.title}
                            aria-pressed={routing === r.v}>{r.label}</button>
                    ))}
                    <div className={styles.sep} />
                    <select className={styles.fontSelect} value={headStart} title="Start of line" aria-label="Start of line"
                        onChange={(e) => setPayload({ headStart: e.target.value })}>
                        {HEAD_TYPES.map(h => <option key={h} value={h}>{HEAD_GLYPH[h]} {HEAD_LABELS[h]}</option>)}
                    </select>
                    <button className={styles.btn} title="Swap ends" aria-label="Swap ends"
                        onClick={() => setPayload({ from: cp.to, to: cp.from, head: headStart, headStart: head })}>
                        <LuArrowLeftRight size={20} />
                    </button>
                    <select className={styles.fontSelect} value={head} title="End of line" aria-label="End of line"
                        onChange={(e) => setPayload({ head: e.target.value })}>
                        {HEAD_TYPES.map(h => <option key={h} value={h}>{HEAD_GLYPH[h]} {HEAD_LABELS[h]}</option>)}
                    </select>
                    <button className={cp.body === 'tapered' ? styles.btnActive : styles.btn}
                        // A tapered body is one straight swelling arrow, so it straightens the route.
                        onClick={() => setPayload(cp.body === 'tapered' ? { body: null } : { body: 'tapered', routing: 'straight' })}
                        title="Tapered arrow" aria-label="Tapered arrow" aria-pressed={cp.body === 'tapered'}>
                        <svg width="22" height="12" viewBox="0 0 22 12" aria-hidden="true"><path d="M1 5.6 L15 4.4 L15 1 L21 6 L15 11 L15 7.6 L1 6.4 Z" fill="currentColor" /></svg>
                    </button>
                    <button className={lstyle !== 'solid' ? styles.btnActive : styles.btn}
                        // `dash` stays in step so siddran-cli and older builds still see a dashed line.
                        onClick={() => setPayload({ lineStyle: nextStyle, dash: nextStyle !== 'solid' })}
                        title={`Line: ${lstyle} (click for ${nextStyle})`} aria-label="Line style">{LINE_GLYPH[lstyle]}</button>
                    <div className={styles.sep} />
                    {/* "yes" / "no" on a decision's branches. Uncontrolled + keyed on the
                        connector so typing is not an undo step per character. */}
                    <input
                        key={conn.id}
                        className={styles.labelInput}
                        defaultValue={cp.label || ''}
                        placeholder="Label"
                        aria-label="Arrow label"
                        data-sb-noedit="true"
                        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur() }}
                        onBlur={(e) => { const v = e.currentTarget.value.trim(); if (v !== (cp.label || '')) setPayload({ label: v }) }}
                    />
                    <div className={styles.sep} />
                    <button className={styles.btn} onClick={() => onDelete?.()} title="Delete" aria-label="Delete">✕</button>
                </div>
            </div>
        )
    }

    // ── General bar — any selection of boxed items (connectors have no box) ──
    const boxItems = selectedItems.filter(it => it.type !== 'connector')
    const box = boxItems.length > 0 ? getSelectionBounds(boxItems) : null
    if (!box || editingShapeId) return null

    // Position: top-center of selection, in screen coords (frames: above the title)
    const topScreen = canvas.screenFromWorld(getOrientedAnchors(box).n)
    const lift = frames.length && frames.length === boxItems.length ? 28 : 0
    const style = barPosition(topScreen.x, topScreen.y - lift)

    const selectedCount = selectedItems.length
    const locked = boxItems.some(it => it.payload?.locked)
    const textShapes = shapes.filter(s => !isLineKind(s.payload?.kind))
    const textTargets = [...textShapes, ...texts]
    const hasText = textTargets.length > 0 && !locked
    const filledShapes = textShapes.filter(s => s.payload?.kind !== 'sticky')
    const stickies = textShapes.filter(s => s.payload?.kind === 'sticky')
    const lineShapes = shapes.filter(s => isLineKind(s.payload?.kind))
    const grouped = boxItems.some(it => it.payload?.groupId)

    // Reference values come from the first item that has text.
    const ref = textTargets[0]?.payload || {}
    const refIsText = textTargets[0]?.type === 'text'
    const fontSize = ref.fontSize || (refIsText ? 18 : 16)
    const textAlign = ref.textAlign || (refIsText ? 'left' : 'center')
    const textColor = (refIsText ? ref.color : ref.textColor) || '#ffffff'
    const fontFamily = ref.fontFamily || 'sans'
    const preset = Object.keys(TEXT_PRESETS).find(k => {
        const t = TEXT_PRESETS[k]
        return t.fontSize === fontSize && !!t.bold === !!ref.bold && (t.fontFamily || 'sans') === fontFamily
    }) || ''

    const sref = filledShapes[0]?.payload || lineShapes[0]?.payload || {}
    const radius = sref.radius || 0
    const hasRadius = filledShapes.some(s => {
        const k = s.payload?.kind
        return k && k !== 'ellipse' && k !== 'circle' && SHAPES[k]
    })
    const shapeStyle = lineStyleOf(sref)
    const nextShapeStyle = LINE_STYLES[(LINE_STYLES.indexOf(shapeStyle) + 1) % LINE_STYLES.length]
    const borderWidth = sref.strokeWidth ?? 2

    // Apply one patch to a set of items, as one undo step. Text colour lives in
    // `color` on a text card and `textColor` on a shape.
    const patchItems = (list, updates) => {
        beginTransaction()
        list.forEach(it => onUpdatePayload(it.id, updates))
        endTransaction()
    }
    const patchText = (updates) => {
        beginTransaction()
        textTargets.forEach(it => {
            const u = { ...updates }
            if (it.type === 'text' && 'textColor' in u) { u.color = u.textColor; delete u.textColor }
            onUpdatePayload(it.id, u)
        })
        endTransaction()
    }
    const toggle = (key) => patchText({ [key]: !ref[key] })

    return (
        <div
            ref={barRef}
            className={styles.bar}
            style={style}
            data-sb-handle="true"
            onPointerDown={(e) => e.stopPropagation()}
        >
            {hasText && (
                <div className={styles.row}>
                    <select className={styles.fontSelect} value={preset} title="Text style" aria-label="Text style"
                        onChange={(e) => { const t = TEXT_PRESETS[e.target.value]; if (t) patchText({ fontSize: t.fontSize, bold: !!t.bold, fontFamily: t.fontFamily || 'sans' }) }}>
                        <option value="" disabled>Style</option>
                        {Object.entries(TEXT_PRESETS).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
                    </select>
                    <select className={styles.fontSelect} value={fontFamily} title="Font" aria-label="Font"
                        onChange={(e) => patchText({ fontFamily: e.target.value })}>
                        {Object.entries(FONT_FAMILIES).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
                    </select>
                    <button className={styles.btn} onClick={() => patchText({ fontSize: stepFontSize(fontSize, -1) })}
                        title="Smaller text (Ctrl+Shift+<)" aria-label="Smaller text">A−</button>
                    <select className={styles.fontSelect} value={fontSize} title="Font size" aria-label="Font size"
                        onChange={(e) => patchText({ fontSize: Number(e.target.value) })}>
                        {[...new Set([...FONT_SIZES, fontSize])].sort((a, b) => a - b).map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <button className={styles.btn} onClick={() => patchText({ fontSize: stepFontSize(fontSize, 1) })}
                        title="Bigger text (Ctrl+Shift+>)" aria-label="Bigger text">A+</button>
                    <div className={styles.sep} />
                    <button className={ref.bold ? styles.btnActive : styles.btn} onClick={() => toggle('bold')} title="Bold (Ctrl+B)" aria-label="Bold" aria-pressed={!!ref.bold}><LuBold size={20} /></button>
                    <button className={ref.italic ? styles.btnActive : styles.btn} onClick={() => toggle('italic')} title="Italic (Ctrl+I)" aria-label="Italic" aria-pressed={!!ref.italic}><LuItalic size={20} /></button>
                    <button className={ref.underline ? styles.btnActive : styles.btn} onClick={() => toggle('underline')} title="Underline (Ctrl+U)" aria-label="Underline" aria-pressed={!!ref.underline}><LuUnderline size={20} /></button>
                    <button className={ref.strike ? styles.btnActive : styles.btn} onClick={() => toggle('strike')} title="Strikethrough" aria-label="Strikethrough" aria-pressed={!!ref.strike}><LuStrikethrough size={20} /></button>
                    <div className={styles.sep} />
                    {H_ALIGN.filter(a => a.v !== 'justify' || texts.length > 0).map(a => (
                        <button key={a.v} className={textAlign === a.v ? styles.btnActive : styles.btn}
                            onClick={() => patchText({ textAlign: a.v })} title={a.title} aria-label={a.title} aria-pressed={textAlign === a.v}>
                            <a.Icon size={20} />
                        </button>
                    ))}
                    {textShapes.length > 0 && texts.length === 0 && (
                        <>
                            <div className={styles.sep} />
                            {V_ALIGN.map(a => (
                                <button key={a.v} className={(ref.verticalAlign || 'middle') === a.v ? styles.btnActive : styles.btn}
                                    onClick={() => patchText({ verticalAlign: a.v })} title={a.title} aria-label={a.title}
                                    aria-pressed={(ref.verticalAlign || 'middle') === a.v}>
                                    <a.Icon size={20} />
                                </button>
                            ))}
                        </>
                    )}
                    <div className={styles.sep} />
                    <SwatchMenu id="tcolor" open={openMenu} setOpen={setOpenMenu} value={textColor} colors={PALETTE}
                        title="Text colour" onPick={(c) => patchText({ textColor: c })} />
                    {texts.length > 0 && (
                        <SwatchMenu id="tbg" open={openMenu} setOpen={setOpenMenu} value={texts[0].payload?.bg} colors={PALETTE}
                            allowNone title="Highlight" icon={<span style={{ fontSize: 14, fontWeight: 700 }}>ab</span>}
                            onPick={(c) => patchItems(texts, { bg: c === 'transparent' ? null : c })} />
                    )}
                </div>
            )}

            <div className={styles.row}>
                {!locked && filledShapes.length > 0 && (
                    <>
                        <SwatchMenu id="fill" open={openMenu} setOpen={setOpenMenu} value={sref.fill} colors={PALETTE} allowNone
                            title="Fill" icon={<LuPaintBucket size={20} />} onPick={(c) => patchItems(filledShapes, { fill: c })} />
                        <SwatchMenu id="border" open={openMenu} setOpen={setOpenMenu} value={sref.stroke} colors={PALETTE} allowNone
                            title="Border colour" onPick={(c) => patchItems(filledShapes, { stroke: c })} />
                        <button className={styles.btn} onClick={() => patchItems(filledShapes, { strokeWidth: Math.max(0, borderWidth - 1) })}
                            title="Thinner border" aria-label="Thinner border">−</button>
                        <span className={styles.radiusValue}>{borderWidth}</span>
                        <button className={styles.btn} onClick={() => patchItems(filledShapes, { strokeWidth: Math.min(24, borderWidth + 1) })}
                            title="Thicker border" aria-label="Thicker border">+</button>
                        <button className={shapeStyle !== 'solid' ? styles.btnActive : styles.btn}
                            onClick={() => patchItems(filledShapes, { lineStyle: nextShapeStyle })}
                            title={`Border: ${shapeStyle} (click for ${nextShapeStyle})`} aria-label="Border style">{LINE_GLYPH[shapeStyle]}</button>
                        {hasRadius && (
                            <div className={styles.radiusGroup}>
                                <input type="range" className={styles.radiusSlider}
                                    min={0} max={40} step={1} value={radius}
                                    // One undo step per drag, closed wherever the button comes up.
                                    onPointerDown={() => { beginTransaction(); window.addEventListener('pointerup', () => endTransaction(), { once: true }) }}
                                    onChange={(e) => filledShapes.forEach(s => onUpdatePayload(s.id, { radius: Number(e.target.value) }))}
                                    title="Corner radius" aria-label="Corner radius" />
                                <span className={styles.radiusValue}>{radius}</span>
                            </div>
                        )}
                        <select className={styles.fontSelect} value={CONVERTIBLE.includes(sref.kind) ? sref.kind : ''}
                            title="Change shape — keeps text, size and arrows" aria-label="Change shape"
                            onChange={(e) => patchItems(filledShapes, { kind: e.target.value })}>
                            <option value="" disabled>Shape</option>
                            {SHAPE_GROUPS.filter(g => g.id !== 'line').map(g => (
                                <optgroup key={g.id} label={g.label}>
                                    {shapesInGroup(g.id).map(k => <option key={k} value={k}>{SHAPES[k].label}</option>)}
                                </optgroup>
                            ))}
                        </select>
                        <div className={styles.sep} />
                    </>
                )}

                {!locked && lineShapes.length > 0 && filledShapes.length === 0 && (
                    <>
                        <SwatchMenu id="lstroke" open={openMenu} setOpen={setOpenMenu} value={sref.stroke} colors={PALETTE}
                            title="Line colour" onPick={(c) => patchItems(lineShapes, { stroke: c })} />
                        <button className={shapeStyle !== 'solid' ? styles.btnActive : styles.btn}
                            onClick={() => patchItems(lineShapes, { lineStyle: nextShapeStyle })}
                            title={`Line: ${shapeStyle}`} aria-label="Line style">{LINE_GLYPH[shapeStyle]}</button>
                        <div className={styles.sep} />
                    </>
                )}

                {!locked && stickies.length > 0 && (
                    <>
                        <SwatchMenu id="sticky" open={openMenu} setOpen={setOpenMenu} value={stickies[0].payload?.fill} colors={STICKY_COLORS}
                            title="Sticky colour" onPick={(c) => patchItems(stickies, { fill: c })} />
                        <div className={styles.sep} />
                    </>
                )}

                {!locked && frames.length > 0 && (
                    <>
                        <SwatchMenu id="frame" open={openMenu} setOpen={setOpenMenu} value={frames[0].payload?.fill} colors={FRAME_FILLS}
                            title="Frame colour" icon={<LuPaintBucket size={20} />} onPick={(c) => patchItems(frames, { fill: c })} />
                        {frames.length === 1 && onExportFrame && (
                            <>
                                <button className={styles.btn} onClick={() => onEditText?.(frames[0].id)} title="Rename frame (double-click the title)" aria-label="Rename frame">Aa</button>
                                <button className={styles.btn} onClick={() => onExportFrame?.(frames[0].id)} title="Export this frame as PNG" aria-label="Export frame">
                                    <LuImageDown size={20} />
                                </button>
                            </>
                        )}
                        <div className={styles.sep} />
                    </>
                )}

                {/* Flowchart — the pen-free way to build one */}
                {flow && textShapes.length > 0 && !locked && (
                    <>
                        {textShapes.length === 1 && selectedCount === 1 && (
                            <button className={styles.btn} onClick={() => flow.createNext(textShapes[0].id, 's')}
                                title="Next step — a connected box below (Tab)" aria-label="Next step">
                                <LuCornerRightDown size={20} />
                            </button>
                        )}
                        {selectedCount === 2 && boxItems.length === 2 && (
                            <button className={styles.btn} onClick={() => flow.connectSelected()}
                                title="Connect these two (C)" aria-label="Connect">
                                <LuCable size={20} />
                            </button>
                        )}
                        {textShapes.length >= 2 && (
                            <button className={styles.btn} onClick={() => flow.tidySelection()}
                                title="Tidy — lay out along the arrows (⇧T)" aria-label="Tidy">
                                <LuNetwork size={20} />
                            </button>
                        )}
                        <button className={styles.btn} onClick={() => flow.copyAsText()}
                            title="Copy as text — paste into a note or an AI chat" aria-label="Copy as text">
                            <LuClipboardCopy size={20} />
                        </button>
                        <div className={styles.sep} />
                    </>
                )}

                {/* Arrange */}
                <button className={styles.btn} onClick={() => onBringFront?.()} title="Bring to front (])" aria-label="Bring to front">
                    <LuBringToFront size={20} />
                </button>
                <button className={styles.btn} onClick={() => onSendBack?.()} title="Send to back ([)" aria-label="Send to back">
                    <LuSendToBack size={20} />
                </button>

                {/* Align / distribute — multi-select only */}
                {selectedCount >= 2 && !locked && (
                    <>
                        <div className={styles.sep} />
                        <div className={styles.alignGrid}>
                            {ALIGN_OPS.map(a => (
                                <button key={a.op} className={styles.miniBtn} title={a.title} aria-label={a.title}
                                    disabled={selectedCount < a.min} onClick={() => onAlign?.(a.op)}>
                                    <a.Icon size={20} />
                                </button>
                            ))}
                        </div>
                    </>
                )}

                <div className={styles.sep} />
                {onFrameSelection && boxItems.length >= 2 && frames.length === 0 && (
                    <button className={styles.btn} onClick={() => onFrameSelection?.()} title="Put these in a frame" aria-label="Frame selection">
                        <LuFrame size={20} />
                    </button>
                )}
                {!onGroup ? null : grouped ? (
                    <button className={styles.btn} onClick={() => onUngroup?.()} title="Ungroup (Ctrl+Shift+G)" aria-label="Ungroup">
                        <LuUngroup size={20} />
                    </button>
                ) : boxItems.length >= 2 && (
                    <button className={styles.btn} onClick={() => onGroup?.()} title="Group (Ctrl+G)" aria-label="Group">
                        <LuGroup size={20} />
                    </button>
                )}
                {onToggleLock && (
                    <button className={locked ? styles.btnActive : styles.btn} onClick={() => onToggleLock()}
                        title={locked ? 'Unlock (Ctrl+Shift+L)' : 'Lock (Ctrl+Shift+L)'} aria-label={locked ? 'Unlock' : 'Lock'} aria-pressed={locked}>
                        {locked ? <LuLock size={20} /> : <LuLockOpen size={20} />}
                    </button>
                )}
                <button className={styles.btn} onClick={() => onDuplicate?.()} title="Duplicate (⌘D)" aria-label="Duplicate">
                    <LuCopy size={20} />
                </button>
                {!locked && (
                    <button className={styles.btn} onClick={() => onDelete?.()} title="Delete (Del)" aria-label="Delete">
                        <LuTrash2 size={20} />
                    </button>
                )}
            </div>
        </div>
    )
}

export default ContextToolbar
