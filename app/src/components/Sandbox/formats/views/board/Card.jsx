import { memo, useState } from 'react'
import { LuMaximize2, LuTrash2, LuCheck } from 'react-icons/lu'
import styles from '../../Board.module.css'
import { OptionChip } from '../TableMenus'
import { cardText } from '../../boards'
import { hasOptions, isEmptyValue, optionHue } from '../../fields'
import { FONT_FAMILIES } from '../../../text/textStyle'

/**
 * A record as a card (Kanban, Matrix): its title, a few fields, a coloured
 * edge by a select field. A click selects it; the title edits on a
 * double-click — or one click when it's empty (the Table's rule), one tap on
 * a touch screen. ⤢ opens the record's detail panel; the trash deletes (own
 * records). Both are always there, dimmed until the card is hovered.
 */
function TitleEditor({ value, onDone, style }) {
    const [draft, setDraft] = useState(value)
    return (
        <textarea className={styles.titleEdit} style={style} value={draft} autoFocus rows={1} aria-label="Card title"
            onFocus={(e) => { const n = e.currentTarget.value.length; e.currentTarget.setSelectionRange(n, n) }}
            onChange={(e) => setDraft(e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && /^[zy]$/i.test(e.key)) return
                e.stopPropagation()
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onDone(draft, e.key) }
                if (e.key === 'Escape') { e.preventDefault(); onDone(null) }
            }}
            onBlur={() => onDone(draft)} />
    )
}

function Value({ field, v, detailed }) {
    if (isEmptyValue(v)) return detailed ? <span className={styles.fieldEmpty}>—</span> : null
    if (hasOptions(field)) return <span className={styles.chips}>{(Array.isArray(v) ? v : [v]).map(o => <OptionChip key={o} label={o} small />)}</span>
    if (field.type === 'check') return <span className={styles.fieldText}><LuCheck size="0.9em" /> {field.name}</span>
    return <span className={styles.fieldText}>{cardText(field, v)}</span>
}

export /** The add box at the foot of a column: Enter adds and stays open for the next (spec), Esc or leaving it closes. */
function AddCard({ onAdd, onClose, placeholder }) {
    const [text, setText] = useState('')
    return (
        <textarea className={styles.addBox} value={text} autoFocus rows={2} placeholder={placeholder} aria-label="New card"
            onChange={(e) => setText(e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && /^[zy]$/i.test(e.key)) return
                e.stopPropagation()
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (text.trim()) { onAdd(text.trim()); setText('') } }
                if (e.key === 'Escape') { e.preventDefault(); onClose() }
            }}
            onBlur={() => { if (text.trim()) onAdd(text.trim()); onClose() }} />
    )
}

/** A look (the style bar's) as CSS: the size and fill on the card, the rest on its title. */
function lookCss(l) {
    if (!l) return {}
    const deco = [l.underline && 'underline', l.strike && 'line-through'].filter(Boolean).join(' ')
    return {
        card: {
            fontSize: l.scale ? `${(0.87 * l.scale).toFixed(3)}em` : undefined,
            backgroundColor: l.bg ? `color-mix(in srgb, ${l.bg} 26%, var(--bg-surface))` : undefined,
        },
        title: {
            fontFamily: l.fontFamily ? FONT_FAMILIES[l.fontFamily]?.css : undefined,
            fontWeight: l.bold ? 700 : undefined,
            fontStyle: l.italic ? 'italic' : undefined,
            textDecoration: deco || undefined,
            color: l.color || undefined,
            textAlign: l.textAlign || undefined,
        },
    }
}

function Card({ rec, primary, shown, colorBy, size, look, selected, editing, editable, canRemove, drop, dragging, stale, api }) {
    const css = lookCss(look)
    const title = primary ? rec.values?.[primary.id] : ''
    const hue = colorBy && typeof rec.values?.[colorBy.id] === 'string' ? optionHue(rec.values[colorBy.id]) : null
    const detailed = size === 'detailed'
    return (
        <div data-rid={rec.id} role="listitem" aria-selected={selected}
            className={[styles.card, selected && styles.cardSel, dragging && styles.cardLifted, drop === 'before' && styles.dropBefore, drop === 'after' && styles.dropAfter, size === 'compact' && styles.compact, stale && styles.stale].filter(Boolean).join(' ')}
            style={{ ...css.card, ...(hue != null ? { '--card-hue': hue } : null) }}
            onPointerDown={(e) => api.down(e, rec.id)}
            onDoubleClick={(e) => { if (!e.target.closest('button')) api.edit(rec.id) }}>
            {hue != null && <span className={styles.cardEdge} />}
            <div className={styles.cardTop}>
                {editing ? (
                    <TitleEditor style={css.title} value={typeof title === 'string' ? title : ''} onDone={(v, key) => api.editDone(rec.id, v, key)} />
                ) : (
                    <span className={`${styles.cardTitle} ${title ? '' : styles.untitled}`} style={css.title} title={editable ? 'Double-click to edit' : undefined}>{title || 'Untitled'}</span>
                )}
                <span className={styles.cardTools}>
                    <button className={styles.cardBtn} onClick={() => api.open(rec.id)} title="Open the record (Space)" aria-label="Open the record">
                        <LuMaximize2 size="0.85em" />
                    </button>
                    {canRemove && (
                        <button className={`${styles.cardBtn} ${styles.cardDel}`} onClick={() => api.remove(rec.id)} title="Delete record" aria-label="Delete record">
                            <LuTrash2 size="0.85em" />
                        </button>
                    )}
                </span>
            </div>
            {size !== 'compact' && shown.length > 0 && (
                <div className={detailed ? styles.fieldsDetailed : styles.fields}>
                    {shown.map(f => {
                        const v = rec.values?.[f.id]
                        if (!detailed && isEmptyValue(v)) return null
                        const err = rec.errors?.[f.id]
                        return (
                            <div key={f.id} className={styles.field} title={f.name}>
                                {detailed && <span className={styles.fieldName}>{f.name}</span>}
                                {err ? <span className={styles.fieldErr} title={err.message}>{err.code}</span> : <Value field={f} v={v} detailed={detailed} />}
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}

export default memo(Card)
