import { memo, useEffect, useRef, useState } from 'react'
import { LuFileText } from 'react-icons/lu'
import styles from './SandboxPdfCard.module.css'
import { useCardPointer, cardBoxStyle } from './useCardPointer'
import { resolveImageUrl } from '../../../utils/imageUpload'

/**
 * An inline PDF preview card. payload: { path, name } — the Bag-relative path to a
 * PDF copied into attachments/. The header is the drag handle; the body hosts a
 * scrollable <iframe> (WebKitGTK renders the PDF) marked data-sb-noedit so
 * scrolling the pages doesn't start a card drag. Resize/rotate use the shared
 * selection-overlay handles (like the other cards), which set item.w/h.
 *
 * While actively resizing, an opaque placeholder covers the iframe so the browser
 * can skip re-rendering the PDF to every intermediate size (the pages re-render
 * once, crisply, when the drag settles) — keeps resize smooth.
 */
function SandboxPdfCard({ item, onUpdate, onRemove, zoom, tool, selected, onSelect, beginTransaction, endTransaction }) {
    const p = item.payload || {}
    const src = p.path ? resolveImageUrl(p.path) : ''
    const { elRef, onPointerDown, onPointerMove, onPointerUp } = useCardPointer({
        item, tool, zoom, onSelect, onUpdate, onRemove, beginTransaction, endTransaction,
    })

    // Detect an in-progress resize (body size changing) and cover the iframe until
    // it settles (180ms of no size change).
    const bodyRef = useRef(null)
    const [resizing, setResizing] = useState(false)
    const settleTimer = useRef(null)
    const lastSize = useRef(null)
    useEffect(() => {
        const el = bodyRef.current
        if (!el || typeof ResizeObserver === 'undefined') return
        const ro = new ResizeObserver(() => {
            const w = el.clientWidth, h = el.clientHeight
            const prev = lastSize.current
            lastSize.current = { w, h }
            if (!prev || (prev.w === w && prev.h === h)) return
            setResizing(true)
            if (settleTimer.current) clearTimeout(settleTimer.current)
            settleTimer.current = setTimeout(() => setResizing(false), 180)
        })
        ro.observe(el)
        return () => { ro.disconnect(); if (settleTimer.current) clearTimeout(settleTimer.current) }
    }, [])

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
                <span className={styles.name} title={p.name}>{p.name || 'document.pdf'}</span>
                <button className={styles.removeBtn} onClick={() => onRemove(item.id)} title="Remove PDF">×</button>
            </div>
            <div ref={bodyRef} className={styles.body} data-sb-noedit="true">
                {src
                    ? <iframe className={styles.frame} src={src} title={p.name || 'PDF'} />
                    : <div className={styles.empty}>Could not load PDF</div>}
                {resizing && src && (
                    <div className={styles.resizeCover} aria-hidden="true">
                        <LuFileText size={26} />
                        <span className={styles.coverName}>{p.name || 'PDF'}</span>
                    </div>
                )}
            </div>
        </div>
    )
}

export default memo(SandboxPdfCard)
