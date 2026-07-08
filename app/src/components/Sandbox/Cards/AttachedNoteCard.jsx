import { memo } from 'react'
import { useNavigate } from 'react-router-dom'
import styles from './AttachedNoteCard.module.css'
import { useCardPointer, cardBoxStyle } from './useCardPointer'

/**
 * A live-reference note card. `item.payload.noteId` is the only thing stored on
 * the sandbox; the title is read from `notes` on every render. Select/move/
 * resize/rotate + eraser-delete flow through the shared card pointer hook and
 * the transform overlay.
 */
function AttachedNoteCard({ item, notes, onUpdate, onRemove, zoom, tool, selected, onSelect, beginTransaction, endTransaction }) {
    const note = notes?.find(n => n.id === item.payload.noteId)
    const navigate = useNavigate()
    const { elRef, onPointerDown, onPointerMove, onPointerUp } = useCardPointer({
        item, tool, zoom, onSelect, onUpdate, onRemove, beginTransaction, endTransaction,
    })

    const common = {
        ref: elRef,
        'data-sb-card': 'true',
        'data-sb-id': item.id,
        style: cardBoxStyle(item, selected),
        onPointerDown, onPointerMove, onPointerUp,
    }

    if (!note) {
        return (
            <div {...common} className={styles.deleted}>
                <button className={styles.removeBtn} onClick={() => onRemove(item.id)} title="Remove attachment">×</button>
                <div className={styles.label}>NOTE GONE</div>
                <div className={styles.deletedNote}>The referenced note was deleted.</div>
            </div>
        )
    }

    return (
        <div {...common} className={styles.card}>
            <button className={styles.removeBtn} onClick={() => onRemove(item.id)} title="Detach (note is not deleted)">×</button>
            <div className={styles.label}>NOTE</div>
            <div
                className={styles.title}
                data-sb-card-title="true"
                onClick={() => navigate(`/notes/${note.id}`)}
                title="Open this note"
            >
                {note.title || 'Untitled'}
            </div>
        </div>
    )
}

export default memo(AttachedNoteCard)
