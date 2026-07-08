import { createPortal } from 'react-dom'
import { useMemo, useState } from 'react'

// Mirrors NoteAttachPicker's look; lists tasks filtered by title/description.
const styles = {
    backdrop: {
        position: 'fixed', inset: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'sbFadeIn 0.2s ease both',
    },
    modal: {
        width: 'min(560px, 92vw)', maxHeight: '78vh',
        display: 'flex', flexDirection: 'column',
        background: 'var(--bg-surface)', border: '1px solid var(--border-strong)',
        borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        animation: 'sbSlideUp 0.3s cubic-bezier(0.16,1,0.3,1) both',
    },
    header: { padding: '18px 22px 12px', borderBottom: '1px solid var(--border-default)', display: 'flex', alignItems: 'baseline', gap: 10 },
    title: { fontFamily: 'var(--font-heading)', fontSize: 20, fontWeight: 500, color: 'var(--text-primary)' },
    subtitle: { fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.14em', textTransform: 'uppercase', marginLeft: 'auto' },
    search: { margin: '12px 22px', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 6, color: 'var(--text-primary)', fontSize: 13, padding: '9px 12px', outline: 'none', fontFamily: 'inherit' },
    list: { flex: 1, overflowY: 'auto', padding: '0 12px 18px' },
    item: { padding: '12px 14px', marginBottom: 6, background: 'transparent', border: '1px solid transparent', borderRadius: 8, cursor: 'pointer', transition: 'background-color 0.15s, border-color 0.15s' },
    itemHover: { background: 'var(--bg-elevated)', borderColor: 'var(--border-default)' },
    itemTitle: { fontFamily: 'var(--font-heading)', fontSize: 15, color: 'var(--text-primary)', lineHeight: 1.3 },
    itemMeta: { fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.08em', marginTop: 4 },
    empty: { textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: 24 },
    closeBtn: { marginLeft: 8, background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 20, padding: 0 },
}

function TaskAttachPicker({ isOpen, tasks, onPick, onClose }) {
    const [q, setQ] = useState('')
    const [hoverId, setHoverId] = useState(null)

    const filtered = useMemo(() => {
        const query = q.trim().toLowerCase()
        const list = tasks ?? []
        if (!query) return list
        return list.filter(t =>
            (t.title || '').toLowerCase().includes(query) ||
            (t.description || '').toLowerCase().includes(query)
        )
    }, [tasks, q])

    if (!isOpen) return null
    const onBackdrop = (e) => { if (e.target === e.currentTarget) onClose() }

    return createPortal(
        <>
            <style>{`
                @keyframes sbFadeIn { from { opacity: 0 } to { opacity: 1 } }
                @keyframes sbSlideUp { from { opacity: 0; transform: translateY(12px) } to { opacity: 1; transform: translateY(0) } }
            `}</style>
            <div style={styles.backdrop} onClick={onBackdrop}>
                <div style={styles.modal}>
                    <div style={styles.header}>
                        <span style={styles.title}>Attach a task</span>
                        <span style={styles.subtitle}>LIVE REFERENCE</span>
                        <button onClick={onClose} style={styles.closeBtn}>×</button>
                    </div>
                    <input
                        autoFocus
                        style={styles.search}
                        placeholder="Search by title..."
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                    />
                    <div style={styles.list}>
                        {filtered.length === 0 ? (
                            <div style={styles.empty}>
                                {(tasks ?? []).length === 0
                                    ? 'You have no tasks yet. Create a task first, then come back.'
                                    : 'No tasks match that search.'}
                            </div>
                        ) : filtered.map(t => (
                            <div
                                key={t.id}
                                style={{ ...styles.item, ...(hoverId === t.id ? styles.itemHover : {}) }}
                                onMouseEnter={() => setHoverId(t.id)}
                                onMouseLeave={() => setHoverId(null)}
                                onClick={() => onPick(t)}
                            >
                                <div style={styles.itemTitle}>{t.title || 'Untitled task'}</div>
                                <div style={styles.itemMeta}>
                                    {t.priority ? `${t.priority.toUpperCase()} · ` : ''}{t.is_completed ? 'DONE' : 'OPEN'}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </>,
        document.body
    )
}

export default TaskAttachPicker
