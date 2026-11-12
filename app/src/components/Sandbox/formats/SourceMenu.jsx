import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LuCheck } from 'react-icons/lu'
import styles from './FormatWidget.module.css'

const SHOWS = [['open', 'Open'], ['all', 'All'], ['done', 'Done']]

/**
 * Where a widget's records come from: its own (kept in the board) or the
 * Bag's tasks — all of them or one project's — with an open/all/done filter.
 * Portalled and fixed-positioned beside its button, like the dock's menus.
 */
function SourceMenu({ anchorRef, source, bundles = [], onPick, onClose }) {
    const panelRef = useRef(null)
    const [pos, setPos] = useState(null)

    useLayoutEffect(() => {
        const r = anchorRef.current?.getBoundingClientRect()
        if (!r) return
        const W = 232
        setPos({ top: Math.round(r.bottom + 6), left: Math.round(Math.max(8, Math.min(r.right - W, window.innerWidth - W - 8))) })
    }, [anchorRef])

    useEffect(() => {
        const onDown = (e) => {
            if (panelRef.current?.contains(e.target) || anchorRef.current?.contains(e.target)) return
            onClose()
        }
        const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
        window.addEventListener('pointerdown', onDown, true)
        window.addEventListener('keydown', onKey, true)
        return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey, true) }
    }, [anchorRef, onClose])

    if (!pos) return null
    const type = source?.type || 'own'
    const show = source?.show || 'open'
    const item = (label, active, onClick, key) => (
        <button key={key || label} className={styles.menuItem} onClick={onClick} aria-pressed={active}>
            <span className={styles.menuTick}>{active && <LuCheck size={13} />}</span>
            <span className={styles.menuLabel}>{label}</span>
        </button>
    )

    return createPortal(
        <div ref={panelRef} className={styles.menu} style={{ top: pos.top, left: pos.left }}
            data-sb-handle="true" onPointerDown={(e) => e.stopPropagation()}>
            <div className={styles.menuHead}>Records</div>
            {item('Own records — kept in this board', type === 'own', () => onPick({ type: 'own' }))}
            <div className={styles.menuHead}>Linked to Siddran tasks</div>
            {item('All tasks', type === 'tasks', () => onPick({ type: 'tasks', show }))}
            {bundles.map(b => item(b.title || 'Untitled project', type === 'project' && String(source.projectId) === String(b.id),
                () => onPick({ type: 'project', projectId: b.id, show }), `p-${b.id}`))}
            {type !== 'own' && (
                <>
                    <div className={styles.menuHead}>Show</div>
                    <div className={styles.menuShows}>
                        {SHOWS.map(([v, label]) => (
                            <button key={v} className={show === v ? styles.showOn : styles.show}
                                onClick={() => onPick({ ...source, show: v })} aria-pressed={show === v}>{label}</button>
                        ))}
                    </div>
                </>
            )}
            {type !== 'own' && <div className={styles.menuNote}>Edits change the real tasks. Board undo doesn’t cover them.</div>}
        </div>,
        document.body,
    )
}

export default SourceMenu
