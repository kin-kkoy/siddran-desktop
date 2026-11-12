import {
    LuMousePointer2, LuHand, LuShapes,
    LuType, LuImagePlus, LuPaintBucket,
    LuUndo2, LuRedo2, LuMagnet, LuDownload,
    LuFrame, LuLayoutTemplate,
} from 'react-icons/lu'
import { useRef } from 'react'
import styles from './SandboxToolbar.module.css'
import { DiagramIcon } from '../flow/icons'
import ShapePicker from './ShapePicker'
import InsertMenu from './InsertMenu'
import ColorMenu from './ColorMenu'
import { INK_TOOL_META } from '../ink/inkToolMeta'
import { SHAPE_TOOLS } from '../shapes/registry'
import { isInkTool, SHAPE_COLORS } from '../ink/presets'

// A post-it: square, folded bottom-right corner, adhesive strip on top — so it
// doesn't read as a document/file the way a page-with-fold icon does.
function StickyIcon({ size = 16 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 4h16v11l-5 5H4z" />
            <path d="M15 20v-5h5" />
            <path d="M4 8h16" strokeWidth="3.2" opacity="0.55" />
        </svg>
    )
}

function ToolBtn({ active, title, onClick, disabled, children }) {
    return (
        <button
            className={active ? styles.btnActive : styles.btn}
            onClick={onClick}
            title={title}
            aria-label={title}
            disabled={disabled}
        >
            {children}
        </button>
    )
}

function SandboxToolbar({
    tool, onToolChange, lastInkTool = 'pen',
    shapeStyle, onShapeStyleChange,
    paintColor, onPaintColorChange, paintMenuOpen, onBucketClick, onClosePaintMenu,
    shapePickerOpen, onToggleShapePicker, onCloseShapePicker,
    insertMenuOpen, onToggleInsertMenu, onCloseInsertMenu,
    onAttachNoteClick, onAttachTaskClick, onPickImage, onPickPdf, onInsertTable,
    onUndo, onRedo, canUndo, canRedo,
    snapEnabled, onToggleSnap, onExport,
    onOpenDiagram,
    onOpenTemplates,
}) {
    const fillRef = useRef(null)
    const shapeRef = useRef(null)
    const insertRef = useRef(null)
    const isShapeTool = SHAPE_TOOLS.includes(tool) && tool !== 'sticky' && tool !== 'frame'
    // One button for all the ink tools: it shows the current (or last) one and
    // opens the drawing flyout beside the dock; pressed again, back to Select.
    const inking = isInkTool(tool)
    const ink = INK_TOOL_META[inking ? tool : lastInkTool] || INK_TOOL_META.pen
    const InkIcon = ink.Icon
    const paintNone = !paintColor || paintColor === 'transparent'
    return (
        <div className={styles.toolbar}>
            {/* Select and Pan share one button: V (or a click on the active
                button) flips between them. Space-drag, middle-drag and two
                fingers pan from any tool. */}
            <ToolBtn
                active={(tool === 'pointer' || tool === 'hand') && !shapePickerOpen && !insertMenuOpen}
                title={tool === 'hand' ? 'Pan — V or click for Select' : 'Select (V) — press V again to pan'}
                onClick={() => onToolChange(tool === 'pointer' ? 'hand' : 'pointer')}
            >
                {tool === 'hand' ? <LuHand size={21} /> : <LuMousePointer2 size={21} />}
            </ToolBtn>
            <ToolBtn active={inking} title={inking ? 'Drawing tools — click for Select' : 'Drawing tools: pen, highlighter, smart drawing, erasers, lasso (P)'}
                onClick={() => onToolChange(inking ? 'pointer' : lastInkTool)}>
                <InkIcon size={21} />
            </ToolBtn>

            <div className={styles.divider} />

            <span ref={shapeRef}>
                <ToolBtn active={isShapeTool || shapePickerOpen} title="Shapes (S)" onClick={onToggleShapePicker}>
                    <LuShapes size={21} />
                </ToolBtn>
            </span>
            <ShapePicker
                open={shapePickerOpen}
                tool={tool}
                anchorRef={shapeRef}
                onPick={onToolChange}
                onClose={onCloseShapePicker}
                shapeStyle={shapeStyle}
                onShapeStyleChange={onShapeStyleChange}
            />
            <ToolBtn active={tool === 'text'} title="Text (T)" onClick={() => onToolChange('text')}>
                <LuType size={21} />
            </ToolBtn>
            <ToolBtn active={tool === 'sticky'} title="Sticky note (N) — click to place" onClick={() => onToolChange('sticky')}>
                <StickyIcon size={21} />
            </ToolBtn>
            <ToolBtn active={tool === 'frame'} title="Frame (F) — drag to draw" onClick={() => onToolChange('frame')}>
                <LuFrame size={21} />
            </ToolBtn>
            {onOpenTemplates && (
                <ToolBtn title="Templates" onClick={onOpenTemplates}>
                    <LuLayoutTemplate size={21} />
                </ToolBtn>
            )}
            {onOpenDiagram && (
                <ToolBtn title="Diagram — build from nodes or text (D)" onClick={onOpenDiagram}>
                    <DiagramIcon size={21} />
                </ToolBtn>
            )}
            <span ref={insertRef}>
                <ToolBtn active={insertMenuOpen} title="Media" onClick={onToggleInsertMenu}>
                    <LuImagePlus size={21} />
                </ToolBtn>
            </span>
            <InsertMenu
                open={insertMenuOpen}
                anchorRef={insertRef}
                onClose={onCloseInsertMenu}
                onPickNote={onAttachNoteClick}
                onPickTask={onAttachTaskClick}
                onPickImage={onPickImage}
                onPickPdf={onPickPdf}
                onPickTable={onInsertTable}
            />

            <div className={styles.divider} />

            {/* Paint bucket: a tool. Pick a colour, then click shapes, stickies,
                lines or ink to paint them. Esc or another tool puts it away. */}
            <span ref={fillRef}>
                <ToolBtn active={tool === 'fill'}
                    title={tool === 'fill' ? 'Paint bucket — click things to paint them; click here for colours, Esc to stop' : 'Paint bucket — pick a colour, then click a shape to fill it'}
                    onClick={onBucketClick}>
                    <span className={styles.iconSwatch}>
                        <LuPaintBucket size={19} />
                        <span className={paintNone ? styles.iconBarNone : styles.iconBar} style={paintNone ? undefined : { backgroundColor: paintColor }} />
                    </span>
                </ToolBtn>
            </span>
            <ColorMenu
                open={paintMenuOpen}
                anchorRef={fillRef}
                onClose={onClosePaintMenu}
                title="Paint with"
                colors={SHAPE_COLORS}
                value={paintColor}
                onPick={onPaintColorChange}
                allowNone
            />

            <div className={styles.divider} />

            <ToolBtn active={snapEnabled} title="Snap to grid & items" onClick={onToggleSnap}>
                <LuMagnet size={21} />
            </ToolBtn>
            <ToolBtn title="Export as PNG" onClick={onExport}>
                <LuDownload size={21} />
            </ToolBtn>

            <div className={styles.divider} />

            <ToolBtn title="Undo (⌘Z)" onClick={onUndo} disabled={!canUndo}>
                <LuUndo2 size={21} />
            </ToolBtn>
            <ToolBtn title="Redo (⌘⇧Z)" onClick={onRedo} disabled={!canRedo}>
                <LuRedo2 size={21} />
            </ToolBtn>
        </div>
    )
}

export default SandboxToolbar
