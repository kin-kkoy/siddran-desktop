import { memo, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { LuExternalLink } from 'react-icons/lu'
import styles from './AttachedNoteCard.module.css'
import { useCardPointer, cardBoxStyle } from './useCardPointer'
import { markdownToHtml } from '../../Editor/utils/markdownToHtml'

/**
 * A live-reference note card. `item.payload.noteId` is the only thing stored on
 * the sandbox; title + body are read from `notes` each render. The body is
 * rendered (a mini reading view) in a scrollable pane so the card actually shows
 * the note's contents; the header title opens the note. Drag by the header.
 */
function AttachedNoteCard({ item, notes, onUpdate, onRemove, zoom, tool, selected, onSelect, beginTransaction, endTransaction }) {
    const note = notes?.find(n => n.id === item.payload.noteId)
    const navigate = useNavigate()
    const html = useMemo(() => (note?.body?.trim() ? markdownToHtml(note.body) : ''), [note?.body])
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
            <div {...common} className={`${styles.card} ${styles.deleted} ${selected ? styles.selected : ''}`}>
                <div className={styles.header}>
                    <span className={styles.label}>NOTE GONE</span>
                    <span className={styles.title} />
                    <button className={styles.iconBtn} onClick={() => onRemove(item.id)} title="Remove attachment" aria-label="Remove">×</button>
                </div>
                <div className={styles.deletedNote}>The referenced note was deleted.</div>
            </div>
        )
    }

    return (
        <div {...common} data-sb-scrollcard="true" className={`${styles.card} ${selected ? styles.selected : ''}`}>
            <div className={styles.header}>
                <span className={styles.label}>NOTE</span>
                <span className={styles.title} title={note.title || 'Untitled'}>{note.title || 'Untitled'}</span>
                <button
                    className={styles.iconBtn}
                    data-sb-card-title="true"
                    onClick={() => navigate(`/notes/${note.id}`)}
                    title="Open this note"
                    aria-label="Open this note"
                >
                    <LuExternalLink size={13} />
                </button>
                <button className={styles.iconBtn} onClick={() => onRemove(item.id)} title="Detach (note is not deleted)" aria-label="Detach note">×</button>
            </div>
            <div className={styles.page} data-sb-noedit="true" data-sb-scroll="true">
                {html
                    ? <div className={styles.rendered} dangerouslySetInnerHTML={{ __html: html }} />
                    : <div className={styles.emptyBody}>Empty note</div>}
            </div>
        </div>
    )
}

export default memo(AttachedNoteCard)
