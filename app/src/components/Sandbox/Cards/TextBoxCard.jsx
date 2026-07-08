import { memo, useEffect, useRef, useState } from 'react'
import styles from './TextBoxCard.module.css'
import { useCardPointer, cardBoxStyle } from './useCardPointer'

/**
 * A free text label. payload: { text, fontSize, color }. Double-click to edit
 * (a textarea); blur or Esc commits. Selectable/movable/resizable/erasable like
 * other cards. While editing, the textarea (data-sb-noedit) swallows pointer so
 * dragging/selection don't fire, and the isEditable keyboard guard keeps canvas
 * shortcuts from stealing keystrokes.
 */
function TextBoxCard({ item, onUpdate, onRemove, zoom, tool, selected, onSelect, beginTransaction, endTransaction }) {
    const p = item.payload || {}
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState(p.text || '')
    const taRef = useRef(null)

    useEffect(() => { if (!editing) setDraft(p.text || '') }, [p.text, editing])
    useEffect(() => { if (editing) { taRef.current?.focus(); taRef.current?.select() } }, [editing])

    const { elRef, onPointerDown, onPointerMove, onPointerUp } = useCardPointer({
        item, tool, zoom, onSelect, onUpdate, onRemove, beginTransaction, endTransaction,
    })

    const commit = () => {
        setEditing(false)
        if (draft !== (p.text || '')) onUpdate(item.id, { payload: { ...p, text: draft } })
    }

    const textStyle = {
        fontSize: (p.fontSize || 18),
        color: p.color || 'var(--text-primary)',
    }

    return (
        <div
            ref={elRef}
            data-sb-card="true"
            data-sb-id={item.id}
            className={`${styles.box} ${selected ? styles.selected : ''}`}
            style={cardBoxStyle(item, selected)}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onDoubleClick={(e) => { e.stopPropagation(); setEditing(true) }}
        >
            <button className={styles.removeBtn} onClick={() => onRemove(item.id)} title="Delete text">×</button>
            {editing ? (
                <textarea
                    ref={taRef}
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
                <div className={styles.text} style={textStyle}>
                    {p.text ? p.text : <span className={styles.placeholder}>Double-click to edit</span>}
                </div>
            )}
        </div>
    )
}

export default memo(TextBoxCard)
