import {
    LuMousePointer2, LuLasso, LuHand, LuPenTool, LuShapes,
    LuType, LuEraser, LuPlus, LuPaintBucket,
    LuUndo2, LuRedo2, LuMagnet, LuDownload,
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
    onAttachNoteClick, onAttachTaskClick, onPickImage,
    onUndo, onRedo, canUndo, canRedo,
    snapEnabled, onToggleSnap, onExport,
}) {
    const swatchRef = useRef(null)
    const shapeRef = useRef(null)
    const insertRef = useRef(null)
    const isShapeTool = SHAPE_TOOLS.includes(tool)
    return (
        <div className={styles.toolbar}>
            <ToolBtn active={tool === 'pointer'} title="Select (V)" onClick={() => onToolChange('pointer')}>
                <LuMousePointer2 size={16} />
            </ToolBtn>
            <ToolBtn active={tool === 'lasso'} title="Lasso select (G)" onClick={() => onToolChange('lasso')}>
                <LuLasso size={16} />
            </ToolBtn>
            <ToolBtn active={tool === 'hand'} title="Hand · Pan (Space)" onClick={() => onToolChange('hand')}>
                <LuHand size={16} />
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
            <span ref={insertRef}>
                <ToolBtn active={insertMenuOpen} title="Insert note / task / image" onClick={onToggleInsertMenu}>
                    <LuPlus size={17} />
                </ToolBtn>
            </span>
            <InsertMenu
                open={insertMenuOpen}
                anchorRef={insertRef}
                onClose={onCloseInsertMenu}
                onPickNote={onAttachNoteClick}
                onPickTask={onAttachTaskClick}
                onPickImage={onPickImage}
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
