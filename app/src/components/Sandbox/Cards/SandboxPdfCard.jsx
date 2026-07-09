import { memo } from 'react'
import styles from './SandboxPdfCard.module.css'
import { useCardPointer, cardBoxStyle } from './useCardPointer'
import { resolveImageUrl } from '../../../utils/imageUpload'

/**
 * An inline PDF preview card. payload: { path, name } — the Bag-relative path to a
 * PDF copied into attachments/. The header is the drag handle; the body hosts a
 * scrollable <iframe> (WebKitGTK renders the PDF) marked data-sb-noedit so
 * scrolling the pages doesn't start a card drag. Resize/rotate use the shared
 * selection-overlay handles (like the other cards), which set item.w/h.
 */
function SandboxPdfCard({ item, onUpdate, onRemove, zoom, tool, selected, onSelect, beginTransaction, endTransaction }) {
    const p = item.payload || {}
    const src = p.path ? resolveImageUrl(p.path) : ''
    const { elRef, onPointerDown, onPointerMove, onPointerUp } = useCardPointer({
        item, tool, zoom, onSelect, onUpdate, onRemove, beginTransaction, endTransaction,
    })

    return (
        <div
            ref={elRef}
            data-sb-card="true"
            data-sb-id={item.id}
            className={`${styles.card} ${selected ? styles.selected : ''}`}
            style={cardBoxStyle(item, selected)}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
        >
            <div className={styles.header}>
                <span className={styles.label}>PDF</span>
                <span className={styles.name} data-sb-card-title="true" title={p.name}>{p.name || 'document.pdf'}</span>
                <button className={styles.removeBtn} onClick={() => onRemove(item.id)} title="Remove PDF">×</button>
            </div>
            <div className={styles.body} data-sb-noedit="true">
                {src
                    ? <iframe className={styles.frame} src={src} title={p.name || 'PDF'} />
                    : <div className={styles.empty}>Could not load PDF</div>}
            </div>
        </div>
    )
}

export default memo(SandboxPdfCard)
