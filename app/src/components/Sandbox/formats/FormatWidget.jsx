import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LuTable2, LuMaximize2, LuMinimize2, LuChevronDown, LuLink, LuCheck } from 'react-icons/lu'
import styles from './FormatWidget.module.css'
import { useFormatSource } from './useFormatSource'
import { sourceLabel } from './dataSource'
import { viewComponent, VIEW_ICONS, switchableViews } from './views'
import { viewLabel } from './formats'
import Popover from './Popover'
import tStyles from './Table.module.css'
import { useTasksApi } from '../../../contexts/TasksApiContext'
import SourceMenu from './SourceMenu'
import { cutLabel } from '../selection/attach'
import { stepFontSize } from '../text/textStyle'
import { widgetBox, zIcon } from './zoomBox'
import DocWidget, { DocFocus } from './doc/DocWidget'

/**
 * A Format widget's chrome and body — used on the board (a window you move by
 * its title bar and resize with the selection handles) and in focus mode
 * (the same widget, full screen). The body is whichever view `payload.view`
 * names (views/index.js), fed one data source (dataSource.js).
 */
function Chrome({ item, source, commit, focus, focusSize, onFocusSize, renaming, onRenameDone, onToggleFocus, onPickSource, onTitlePointerDown }) {
    const { bundles } = useTasksApi()
    const p = item.payload || {}
    const [menu, setMenu] = useState(false)
    const [viewMenu, setViewMenu] = useState(false)
    const viewRef = useRef(null)
    const closeViewMenu = useCallback(() => setViewMenu(false), [])
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
    // One undo step. The records, fields and every view's settings stay as they are.
    const onPickView = (view) => commit(q => ({ ...q, view }))
    // A view's own settings (filters, sorts, widths…) live under payload[view]; one undo step per change.
    const onConfig = useCallback((fn) => commit(q => ({ ...q, [q.view || 'table']: fn(q[q.view || 'table'] || {}) })), [commit])
    return (
        <>
            <header className={styles.bar} onPointerDown={onTitlePointerDown}
                onDoubleClick={(e) => { if (!e.target.closest('button')) setTitleEdit(true) }}>
                {(() => { const Icon = VIEW_ICONS[p.view] || LuTable2; return <Icon {...zIcon(focus ? 16 : 14)} className={styles.barIcon} /> })()}
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
                {/* The view switcher (spec §13.2.4): the same records as a Table, Kanban or Matrix; each view keeps its own settings. */}
                <button ref={viewRef} className={styles.srcBtn} onClick={() => setViewMenu(m => !m)} title="Show these records as…" aria-label="View">
                    <span>{viewLabel(p.view)}</span>
                    <LuChevronDown {...zIcon(11)} />
                </button>
                <button ref={srcRef} className={`${styles.srcBtn} ${linked ? styles.srcLinked : ''}`} onClick={() => setMenu(m => !m)}
                    title="Where the records come from" aria-label="Data source">
                    {linked && <LuLink {...zIcon(11)} />}
                    <span>{sourceLabel(p, bundles)}</span>
                    <span className={styles.srcCount}>{source.records.length}</span>
                    <LuChevronDown {...zIcon(11)} />
                </button>
                {focus && onFocusSize && (
                    // Full screen has its own text size (payload.focusFontSize), so a big table on the board can still fit here.
                    <span className={styles.sizeStep}>
                        <button className={styles.barBtn} onClick={() => onFocusSize(-1)} title="Smaller text (Ctrl+−)" aria-label="Smaller text">−</button>
                        <span className={styles.sizeValue} title="Full-screen text size">{focusSize}</span>
                        <button className={styles.barBtn} onClick={() => onFocusSize(1)} title="Bigger text (Ctrl+=)" aria-label="Bigger text">+</button>
                    </span>
                )}
                <button className={styles.barBtn} onClick={onToggleFocus} title={focus ? 'Back to the board (Esc)' : 'Full screen (Enter)'}
                    aria-label={focus ? 'Exit full screen' : 'Full screen'}>
                    {focus ? <LuMinimize2 {...zIcon(15)} /> : <LuMaximize2 {...zIcon(13)} />}
                </button>
            </header>
            {/* data-sb-scroll: the board's wheel scrolls this instead of zooming. */}
            <div className={styles.body} data-sb-scroll="true">
                {/* Keyed by the view: a switch fades the new one in (150 ms) rather than jumping. */}
                <div key={p.view || 'table'} className={styles.viewFade}>
                    <View item={item} source={source} onConfig={onConfig} />
                </div>
            </div>
            {viewMenu && (
                <Popover anchor={viewRef} onClose={closeViewMenu} width={190} label="View">
                    <div className={tStyles.popHead}>Show as</div>
                    {switchableViews(p.view).map(v => {
                        const Icon = VIEW_ICONS[v.id] || LuTable2
                        const on = (p.view || 'table') === v.id
                        return (
                            <button key={v.id} className={tStyles.popItem} onClick={() => { setViewMenu(false); if (!on) onPickView(v.id) }}>
                                <span className={tStyles.popTick}>{on && <LuCheck size={13} />}</span>
                                <Icon size={14} /> <span className={tStyles.popLabel}>{v.label}</span>
                            </button>
                        )
                    })}
                    <div className={tStyles.popNote}>Same records; each view keeps its own filters and layout.</div>
                </Popover>
            )}
            {menu && <SourceMenu anchorRef={srcRef} source={p.source} bundles={bundles} onClose={closeMenu}
                onPick={(s) => { setMenu(false); onPickSource(s) }} />}
        </>
    )
}

// The size of a widget's contents (payload.fontSize, set from the floating bar).
const FORMAT_FONT = 15
// Full screen: its own size once set, else 15% over the widget's.
const focusFont = (item) => item.payload?.focusFontSize || Math.round((item.payload?.fontSize || FORMAT_FONT) * 1.15)

function RecordWidget({ item, zoom, tool, selected, renaming, cut, onSelect, onGrab, onCommit, onOpenFocus, onRenameDone }) {
    const commit = useCallback((fn) => onCommit(item.id, fn), [onCommit, item.id])
    const source = useFormatSource(item, commit)
    const locked = !!item.payload?.locked

    const onPointerDown = (e) => {
        if (e.button !== 0) return
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
            style={widgetBox(item, zoom, item.payload?.fontSize || FORMAT_FONT)}
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
function RecordFocus({ item, onClose, onCommit }) {
    const commit = useCallback((fn) => onCommit(item.id, fn), [onCommit, item.id])
    const source = useFormatSource(item, commit)
    const size = focusFont(item)
    const stepFocus = useCallback((dir) => commit(p => ({ ...p, focusFontSize: stepFontSize(p.focusFontSize || size, dir) })), [commit, size])
    useEffect(() => {
        const onKey = (e) => {
            if ((e.ctrlKey || e.metaKey) && ['=', '+', '-', '_'].includes(e.key)) {
                e.preventDefault(); e.stopPropagation()
                stepFocus(e.key === '=' || e.key === '+' ? 1 : -1)
                return
            }
            if (e.key !== 'Escape') return
            const t = document.activeElement
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return   // the field takes its own Esc
            e.stopPropagation()
            onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [onClose, stepFocus])
    return createPortal(
        <div className={styles.focusBackdrop} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
            <div className={styles.focusPanel} role="dialog" aria-label={item.payload?.title || 'Widget'} style={{ '--fmt-font': `${size}px` }}>
                <Chrome item={item} source={source} commit={commit} focus focusSize={size} onFocusSize={stepFocus} onToggleFocus={onClose}
                    onPickSource={(s) => commit(p => ({ ...p, source: s }))}
                    onRenameDone={(v) => { if (v && v !== item.payload?.title) commit(p => ({ ...p, title: v })) }} />
            </div>
        </div>,
        document.body,
    )
}

// A Doc (view 'doc', doc/doc.js) is a page of text, not a view of records: its own chrome.
const FormatWidget = (props) => (props.item.payload?.view === 'doc' ? <DocWidget {...props} /> : <RecordWidget {...props} />)
export const FormatFocus = (props) => (props.item.payload?.view === 'doc' ? <DocFocus {...props} /> : <RecordFocus {...props} />)

export default memo(FormatWidget)
