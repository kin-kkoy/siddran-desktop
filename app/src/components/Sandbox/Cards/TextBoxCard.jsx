import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import styles from './TextBoxCard.module.css'
import { useCardPointer, cardBoxStyle } from './useCardPointer'
import { cssTextStyle } from '../text/textStyle'

/**
 * A free text label. payload: { text, fontSize, color } plus the optional
 * typography in text/textStyle.js (family, bold/italic/underline/strike, align,
 * line height, highlight `bg`). Double-click to edit
 * (a textarea); blur or Esc commits. Selectable/movable/resizable/erasable like
 * other cards. While editing, the textarea (data-sb-noedit) swallows pointer so
 * dragging/selection don't fire, and the isEditable keyboard guard keeps canvas
 * shortcuts from stealing keystrokes.
 */
function TextBoxCard({ item, onUpdate, onRemove, onAutoSize, editRequest, zoom, tool, selected, onSelect, beginTransaction, endTransaction }) {
    const p = item.payload || {}
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState(p.text || '')
    const taRef = useRef(null)

    useEffect(() => { if (!editing) setDraft(p.text || '') }, [p.text, editing])
    useEffect(() => { if (editing) { taRef.current?.focus(); taRef.current?.select() } }, [editing])
    // The textarea grows with what is typed (wrapped lines included).
    useLayoutEffect(() => {
        const ta = taRef.current
        if (!editing || !ta) return
        ta.style.height = 'auto'
        ta.style.height = `${ta.scrollHeight}px`
    }, [editing, draft, p.fontSize, p.fontFamily, p.lineHeight])

    const { elRef, onPointerDown, onPointerMove, onPointerUp } = useCardPointer({
        item, tool, zoom, onSelect, onUpdate, onRemove, beginTransaction, endTransaction,
    })

    const commit = () => {
        setEditing(false)
        if (draft !== (p.text || '')) onUpdate(item.id, { payload: { ...p, text: draft } })
    }

    const textStyle = {
        ...cssTextStyle(p, p.fontSize || 18),
        color: p.color || 'var(--text-primary)',
    }

    // Enter / the toolbar can ask for edit mode (editRequest bumps per request).
    useEffect(() => { if (editRequest) setEditing(true) }, [editRequest])

    // Grow (or shrink) the card's height to its text, so a bigger font never
    // spills out of the box the selection handles show. Measures the content
    // only — never the card it resizes — and writes through the raw store
    // (onAutoSize), so it is not an undo step of its own. offsetHeight is in the
    // card's own (pre-zoom) CSS px, i.e. world units.
    const contentRef = useRef(null)
    useLayoutEffect(() => {
        const c = contentRef.current
        if (!c || !onAutoSize) return
        const want = Math.ceil(c.offsetHeight + 14)   // + .box vertical padding & border
        if (Math.abs(want - (item.h || 0)) > 2) onAutoSize(item.id, Math.max(28, want))
    })

    return (
        <div
            ref={elRef}
            data-sb-card="true"
            data-sb-id={item.id}
            className={`${styles.box} ${selected ? styles.selected : ''}`}
            style={{
                ...cardBoxStyle(item, selected),
                background: p.bg || undefined,
                // While typing the box grows with the textarea; on commit the
                // auto-size above writes the settled height back.
                ...(editing ? { height: 'auto', minHeight: item.h } : null),
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onDoubleClick={(e) => { e.stopPropagation(); setEditing(true) }}
        >
            {/* Selected: the floating bar's trash does this, so no × over the handles. */}
            {!selected && <button className={styles.removeBtn} onClick={() => onRemove(item.id)} title="Delete text">×</button>}
            {editing ? (
                <textarea
                    ref={taRef}
                    rows={1}
                    data-sb-noedit="true"
                    className={styles.input}
                    style={textStyle}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e) => {
                        e.stopPropagation()
                        if (e.key === 'Escape') { e.preventDefault(); commit() }
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                />
            ) : (
                <div ref={contentRef} className={styles.text} style={textStyle}>
                    {p.text ? p.text : <span className={styles.placeholder}>Double-click to edit</span>}
                </div>
            )}
        </div>
    )
}

export default memo(TextBoxCard)
