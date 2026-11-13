import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LuTable2, LuMaximize2, LuMinimize2, LuChevronDown, LuLink } from 'react-icons/lu'
import styles from './FormatWidget.module.css'
import { useFormatSource } from './useFormatSource'
import { sourceLabel } from './dataSource'
import { viewComponent } from './views'
import { useTasksApi } from '../../../contexts/TasksApiContext'
import SourceMenu from './SourceMenu'
import { cutLabel } from '../selection/attach'

/**
 * A Format widget's chrome and body — used on the board (a window you move by
 * its title bar and resize with the selection handles) and in focus mode
 * (the same widget, full screen). The body is whichever view `payload.view`
 * names (views/index.js), fed one data source (dataSource.js).
 */
function Chrome({ item, source, commit, focus, renaming, onRenameDone, onToggleFocus, onPickSource, onTitlePointerDown }) {
    const { bundles } = useTasksApi()
    const p = item.payload || {}
    const [menu, setMenu] = useState(false)
    const [titleEdit, setTitleEdit] = useState(false)
    const srcRef = useRef(null)
    const editing = titleEdit || renaming
    const linked = p.source?.type === 'tasks' || p.source?.type === 'project'
    const closeMenu = useCallback(() => setMenu(false), [])
    const doneRename = (v) => {
        setTitleEdit(false)
        onRenameDone?.(v)
    }
    const View = viewComponent(p.view)
    // A view's own settings (filters, sorts, widths…) live under payload[view]; one undo step per change.
    const onConfig = useCallback((fn) => commit(q => ({ ...q, [q.view || 'table']: fn(q[q.view || 'table'] || {}) })), [commit])
    return (
        <>
            <header className={styles.bar} onPointerDown={onTitlePointerDown}
                onDoubleClick={(e) => { if (!e.target.closest('button')) setTitleEdit(true) }}>
                <LuTable2 size={focus ? 16 : 14} className={styles.barIcon} />
                {editing ? (
                    <input className={styles.renameInput} autoFocus defaultValue={p.title || ''} aria-label="Widget title"
                        onPointerDown={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                            e.stopPropagation()
                            if (e.key === 'Enter') e.currentTarget.blur()
                            if (e.key === 'Escape') { e.currentTarget.value = p.title || ''; e.currentTarget.blur() }
                        }}
                        onBlur={(e) => doneRename(e.currentTarget.value.trim())} />
                ) : (
                    <span className={styles.barTitle} title="Double-click to rename">{p.title || 'Untitled'}</span>
                )}
                <span className={styles.barSpacer} />
                <button ref={srcRef} className={`${styles.srcBtn} ${linked ? styles.srcLinked : ''}`} onClick={() => setMenu(m => !m)}
                    title="Where the records come from" aria-label="Data source">
                    {linked && <LuLink size={11} />}
                    <span>{sourceLabel(p, bundles)}</span>
                    <span className={styles.srcCount}>{source.records.length}</span>
                    <LuChevronDown size={11} />
                </button>
                <button className={styles.barBtn} onClick={onToggleFocus} title={focus ? 'Back to the board (Esc)' : 'Full screen (Enter)'}
                    aria-label={focus ? 'Exit full screen' : 'Full screen'}>
                    {focus ? <LuMinimize2 size={15} /> : <LuMaximize2 size={13} />}
                </button>
            </header>
            {/* data-sb-scroll: the board's wheel scrolls this instead of zooming. */}
            <div className={styles.body} data-sb-scroll="true">
                <View item={item} source={source} onConfig={onConfig} />
            </div>
            {menu && <SourceMenu anchorRef={srcRef} source={p.source} bundles={bundles} onClose={closeMenu}
                onPick={(s) => { setMenu(false); onPickSource(s) }} />}
        </>
    )
}

// The size of a widget's contents (payload.fontSize, set from the floating bar).
const FORMAT_FONT = 15
const fontVar = (item) => ({ '--fmt-font': `${item.payload?.fontSize || FORMAT_FONT}px` })

function FormatWidget({ item, tool, selected, renaming, cut, onSelect, onGrab, onRemove, onCommit, onOpenFocus, onRenameDone }) {
    const commit = useCallback((fn) => onCommit(item.id, fn), [onCommit, item.id])
    const source = useFormatSource(item, commit)
    const locked = !!item.payload?.locked

    const onPointerDown = (e) => {
        if (e.button !== 0) return
        if (tool === 'eraser') { e.stopPropagation(); onRemove?.(item.id); return }
        e.stopPropagation()
        // Typing or clicking a control inside doesn't (re)select the widget.
        if (e.target.closest('input, button, select, textarea')) return
        onSelect?.(item.id, e.shiftKey)
    }
    // The title bar is the handle: press and drag moves the widget (and what sits on it).
    const onTitlePointerDown = (e) => {
        if (e.button !== 0 || tool === 'eraser' || e.target.closest('input, button')) return
        e.stopPropagation()
        onGrab?.(e, item.id, locked)
    }
    const onPickSource = (s) => commit(p => ({ ...p, source: s }))
    const onRename = (v) => {
        onRenameDone?.(item.id)
        if (v && v !== item.payload?.title) commit(p => ({ ...p, title: v }))
    }

    return (
        <div
            data-sb-card="true"
            data-sb-id={item.id}
            data-sb-scrollcard="true"
            className={`${styles.widget} ${selected ? styles.selected : ''}`}
            style={{ left: item.x, top: item.y, width: item.w, height: item.h, ...fontVar(item) }}
            onPointerDown={onPointerDown}
        >
            <Chrome item={item} source={source} commit={commit} renaming={renaming} onRenameDone={onRename}
                onToggleFocus={() => onOpenFocus?.(item.id)} onPickSource={onPickSource} onTitlePointerDown={onTitlePointerDown} />
            {cut && (
                // Cropped: partly showing past the edge. Out of view: none of it shows.
                <span className={styles.hiddenBadge} title="Attached to this widget but past its edge — make the widget bigger, or drag them off">
                    {cutLabel(cut)}
                </span>
            )}
        </div>
    )
}

/** Focus mode: the widget over the whole window. Esc (or the button) goes back. */
export function FormatFocus({ item, onClose, onCommit }) {
    const commit = useCallback((fn) => onCommit(item.id, fn), [onCommit, item.id])
    const source = useFormatSource(item, commit)
    useEffect(() => {
        const onKey = (e) => {
            if (e.key !== 'Escape') return
            const t = document.activeElement
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return   // the field takes its own Esc
            e.stopPropagation()
            onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [onClose])
    return createPortal(
        <div className={styles.focusBackdrop} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
            <div className={styles.focusPanel} role="dialog" aria-label={item.payload?.title || 'Widget'} style={fontVar(item)}>
                <Chrome item={item} source={source} commit={commit} focus onToggleFocus={onClose}
                    onPickSource={(s) => commit(p => ({ ...p, source: s }))}
                    onRenameDone={(v) => { if (v && v !== item.payload?.title) commit(p => ({ ...p, title: v })) }} />
            </div>
        </div>,
        document.body,
    )
}

export default memo(FormatWidget)
