import { createPortal } from 'react-dom'
import { useMemo, useState } from 'react'

const styles = {
    backdrop: {
        position: 'fixed', inset: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'sbFadeIn 0.2s ease both',
    },
    modal: {
        width: 'min(560px, 92vw)',
        maxHeight: '78vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-strong)',
        borderRadius: 12,
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        animation: 'sbSlideUp 0.3s cubic-bezier(0.16,1,0.3,1) both',
    },
    header: {
        padding: '18px 22px 12px',
        borderBottom: '1px solid var(--border-default)',
        display: 'flex',
        alignItems: 'baseline',
        gap: 10,
    },
    title: {
        fontFamily: 'var(--font-heading)',
        fontSize: 20,
        fontWeight: 500,
        color: 'var(--text-primary)',
    },
    subtitle: {
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        color: 'var(--text-muted)',
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        marginLeft: 'auto',
    },
    search: {
        margin: '12px 22px',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-default)',
        borderRadius: 6,
        color: 'var(--text-primary)',
        fontSize: 13,
        padding: '9px 12px',
        outline: 'none',
        fontFamily: 'inherit',
    },
    list: {
        flex: 1,
        overflowY: 'auto',
        padding: '0 12px 18px',
    },
    itemTitle: {
        fontFamily: 'var(--font-heading)',
        fontSize: 15,
        color: 'var(--text-primary)',
        lineHeight: 1.3,
    },
    itemTags: {
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        color: 'var(--text-muted)',
        letterSpacing: '0.08em',
        marginTop: 4,
    },
    empty: {
        textAlign: 'center',
        color: 'var(--text-muted)',
        fontSize: 13,
        padding: 24,
    },
    closeBtn: {
        marginLeft: 8,
        background: 'transparent',
        border: 'none',
        color: 'var(--text-muted)',
        cursor: 'pointer',
        fontSize: 20,
        padding: 0,
    },
}

function NoteAttachPicker({ isOpen, notes, onPick, onClose }) {
    const [q, setQ] = useState('')

    const filtered = useMemo(() => {
        const query = q.trim().toLowerCase()
        if (!query) return notes ?? []
        return (notes ?? []).filter(n =>
            (n.title || '').toLowerCase().includes(query) ||
            (n.tags  || '').toLowerCase().includes(query)
        )
    }, [notes, q])

    if (!isOpen) return null

    const onBackdrop = (e) => { if (e.target === e.currentTarget) onClose() }

    return createPortal(
        <>
            <style>{`
                @keyframes sbFadeIn { from { opacity: 0 } to { opacity: 1 } }
                @keyframes sbSlideUp { from { opacity: 0; transform: translateY(12px) } to { opacity: 1; transform: translateY(0) } }
                .sb-attach-item {
                    padding: 12px 14px; margin-bottom: 6px;
                    background: transparent; border: 1px solid transparent; border-radius: 8px;
                    cursor: pointer; transition: background-color 0.15s, border-color 0.15s;
                }
                /* CSS :hover — clears reliably even if a mouseleave is missed. */
                .sb-attach-item:hover { background: var(--bg-elevated); border-color: var(--border-default); }
            `}</style>
            <div style={styles.backdrop} onClick={onBackdrop}>
                <div style={styles.modal}>
                    <div style={styles.header}>
                        <span style={styles.title}>Attach a note</span>
                        <span style={styles.subtitle}>LIVE REFERENCE</span>
                        <button onClick={onClose} style={styles.closeBtn}>×</button>
                    </div>
                    <input
                        autoFocus
                        style={styles.search}
                        placeholder="Search by title or tag..."
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                    />
                    <div style={styles.list}>
                        {filtered.length === 0 ? (
                            <div style={styles.empty}>
                                {(notes ?? []).length === 0
                                    ? 'You have no notes yet. Create a note first, then come back.'
                                    : 'No notes match that search.'}
                            </div>
                        ) : filtered.map(n => (
                            <div
                                key={n.id}
                                className="sb-attach-item"
                                onClick={() => onPick(n)}
                            >
                                <div style={styles.itemTitle}>{n.title || 'Untitled'}</div>
                                {n.tags ? <div style={styles.itemTags}>{n.tags}</div> : null}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </>,
        document.body
    )
}

export default NoteAttachPicker
