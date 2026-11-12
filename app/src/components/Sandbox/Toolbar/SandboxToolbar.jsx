import {
    LuMousePointer2, LuLasso, LuHand, LuPenTool, LuShapes,
    LuType, LuEraser, LuImagePlus, LuPaintBucket,
    LuUndo2, LuRedo2, LuMagnet, LuDownload, LuWorkflow,
    LuFrame, LuLayoutTemplate,
} from 'react-icons/lu'
import { useRef } from 'react'
import styles from './SandboxToolbar.module.css'
import ColorPalette from './ColorPalette'
import ShapePicker from './ShapePicker'
import InsertMenu from './InsertMenu'
import { SHAPE_TOOLS } from '../shapes/registry'

const COLORS = [
    { name: 'cream', value: '#e2ddf5' },
    { name: 'gold', value: '#f0b840' },
    { name: 'blue', value: '#5a9cf0' },
    { name: 'red', value: '#e05c5c' },
    { name: 'green', value: '#52c47a' },
    { name: 'black', value: '#000000' },
]

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
    tool, onToolChange,
    color, onColorChange,
    paletteOpen, onTogglePalette, onClosePalette,
    shapePickerOpen, onToggleShapePicker, onCloseShapePicker,
    insertMenuOpen, onToggleInsertMenu, onCloseInsertMenu,
    fillOn, onToggleFill,
    onAttachNoteClick, onAttachTaskClick, onPickImage, onPickPdf,
    onUndo, onRedo, canUndo, canRedo,
    snapEnabled, onToggleSnap, onExport,
    onOpenFlowText,
    onOpenTemplates,
}) {
    const swatchRef = useRef(null)
    const shapeRef = useRef(null)
    const insertRef = useRef(null)
    const isShapeTool = SHAPE_TOOLS.includes(tool) && tool !== 'sticky' && tool !== 'frame'
    return (
        <div className={styles.toolbar}>
            {/* Select and Pan share one button: V (or a click on the active
                button) flips between them. Space-drag, middle-drag and two
                fingers pan from any tool. */}
            <ToolBtn
                active={tool === 'pointer' || tool === 'hand'}
                title={tool === 'hand' ? 'Pan — V or click for Select' : 'Select (V) — press V again to pan'}
                onClick={() => onToolChange(tool === 'pointer' ? 'hand' : 'pointer')}
            >
                {tool === 'hand' ? <LuHand size={16} /> : <LuMousePointer2 size={16} />}
            </ToolBtn>
            <ToolBtn active={tool === 'lasso'} title="Lasso select (G)" onClick={() => onToolChange('lasso')}>
                <LuLasso size={16} />
            </ToolBtn>
            <ToolBtn active={tool === 'pen'} title="Pen (P)" onClick={() => onToolChange('pen')}>
                <LuPenTool size={16} />
            </ToolBtn>
            <ToolBtn active={tool === 'eraser'} title="Eraser (E)" onClick={() => onToolChange('eraser')}>
                <LuEraser size={16} />
            </ToolBtn>

            <div className={styles.divider} />

            <span ref={shapeRef}>
                <ToolBtn active={isShapeTool} title="Shapes (S)" onClick={onToggleShapePicker}>
                    <LuShapes size={16} />
                </ToolBtn>
            </span>
            <ShapePicker
                open={shapePickerOpen}
                tool={tool}
                anchorRef={shapeRef}
                onPick={onToolChange}
                onClose={onCloseShapePicker}
            />
            <ToolBtn active={tool === 'text'} title="Text (T)" onClick={() => onToolChange('text')}>
                <LuType size={16} />
            </ToolBtn>
            <ToolBtn active={tool === 'sticky'} title="Sticky note (N) — click to place" onClick={() => onToolChange('sticky')}>
                <StickyIcon size={16} />
            </ToolBtn>
            <ToolBtn active={tool === 'frame'} title="Frame (F) — drag to draw" onClick={() => onToolChange('frame')}>
                <LuFrame size={16} />
            </ToolBtn>
            {onOpenTemplates && (
                <ToolBtn title="Templates" onClick={onOpenTemplates}>
                    <LuLayoutTemplate size={16} />
                </ToolBtn>
            )}
            {onOpenFlowText && (
                <ToolBtn title="Diagram from text (D)" onClick={onOpenFlowText}>
                    <LuWorkflow size={16} />
                </ToolBtn>
            )}
            <span ref={insertRef}>
                <ToolBtn active={insertMenuOpen} title="Media" onClick={onToggleInsertMenu}>
                    <LuImagePlus size={16} />
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
            />

            <div className={styles.divider} />

            <button
                ref={swatchRef}
                className={paletteOpen ? `${styles.swatchCurrent} ${styles.swatchCurrentOpen}` : styles.swatchCurrent}
                style={{ backgroundColor: color }}
                onClick={onTogglePalette}
                title="Stroke colour"
                aria-label="Stroke colour"
            />
            <ColorPalette
                open={paletteOpen}
                colors={COLORS}
                current={color}
                anchorRef={swatchRef}
                onPick={onColorChange}
                onClose={onClosePalette}
            />
            <ToolBtn active={fillOn} title="Fill shapes with color" onClick={onToggleFill}>
                <LuPaintBucket size={15} />
            </ToolBtn>

            <div className={styles.divider} />

            <ToolBtn active={snapEnabled} title="Snap to grid & items" onClick={onToggleSnap}>
                <LuMagnet size={16} />
            </ToolBtn>
            <ToolBtn title="Export as PNG" onClick={onExport}>
                <LuDownload size={16} />
            </ToolBtn>

            <div className={styles.divider} />

            <ToolBtn title="Undo (⌘Z)" onClick={onUndo} disabled={!canUndo}>
                <LuUndo2 size={16} />
            </ToolBtn>
            <ToolBtn title="Redo (⌘⇧Z)" onClick={onRedo} disabled={!canRedo}>
                <LuRedo2 size={16} />
            </ToolBtn>
        </div>
    )
}

export default SandboxToolbar
