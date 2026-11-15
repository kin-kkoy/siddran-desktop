import { createPortal } from 'react-dom'

/**
 * Preset (non-customizable) keyboard-shortcut reference for the Sandbox.
 * Portal modal mirroring the NoteAttachPicker visual language.
 */
const GROUPS = [
    {
        title: 'Tools',
        rows: [
            ['Select', ['V']], ['Pan tool (toggle)', ['V', 'V']], ['Pen', ['P']], ['Highlighter', ['P', 'P']],
            ['Eraser (whole strokes)', ['E']], ['Precision eraser', ['E', 'E']],
            ['Lasso select', ['G']], ['Shapes', ['S']], ['Text', ['T']],
            ['Sticky note', ['N']], ['Frame', ['F']],
        ],
    },
    {
        title: 'Edit',
        rows: [
            ['Undo', ['⌘', 'Z']], ['Redo', ['⌘', '⇧', 'Z']], ['Duplicate', ['⌘', 'D']],
            ['Select all', ['⌘', 'A']], ['Delete', ['Del']], ['Deselect', ['Esc']],
            ['Copy style', ['⌘', 'Alt', 'C']], ['Paste style', ['⌘', 'Alt', 'V']],
        ],
    },
    {
        title: 'Text',
        rows: [
            ['Edit text', ['Enter']], ['Bold', ['⌘', 'B']], ['Italic', ['⌘', 'I']], ['Underline', ['⌘', 'U']],
            ['Bigger text', ['⌘', '⇧', '>']], ['Smaller text', ['⌘', '⇧', '<']],
        ],
    },
    {
        title: 'Arrange',
        rows: [
            ['Bring to front', [']']], ['Send to back', ['[']],
            ['Nudge', ['←', '↑', '↓', '→']], ['Nudge ×10', ['⇧', 'Arrows']],
            ['Group', ['⌘', 'G']], ['Ungroup', ['⌘', '⇧', 'G']], ['Lock / unlock', ['⌘', '⇧', 'L']],
        ],
    },
    {
        title: 'Flowchart',
        rows: [
            ['Edit box text', ['Enter']],
            ['Next step, connected', ['Tab']], ['Next branch beside it', ['⇧', 'Tab']],
            ['Step in a direction', ['Alt', 'Arrows']], ['Connect two boxes', ['C']],
            ['Tidy the layout', ['⇧', 'T']], ['Diagram — nodes or text (edits the selected one)', ['D']],
            ['Connected box from a dot', ['Shift', 'Click dot']], ['New box at the drop', ['Drag dot', 'Shift', 'release']],
            ['Free-ended arrow', ['Drag dot', 'Alt']],
        ],
    },
    {
        title: 'View',
        rows: [
            ['Pan', ['Space', 'drag']], ['Zoom', ['Scroll']],
            ['Zoom to fit', ['1']], ['Reset zoom', ['⌘', '0']], ['This help', ['?']],
        ],
    },
    {
        title: 'Slides (media menu → Slides)',
        rows: [
            ['Slides panel', ['⇧', 'F']], ['Present from the start', ['F5']], ['Present from here', ['⇧', 'F5']],
            ['Next / previous slide', ['→', '←']], ['Go to slide n', ['n', 'Enter']],
            ['Blank the screen', ['B']], ['Fullscreen', ['F']], ['Stop presenting', ['Esc']],
        ],
    },
]

const s = {
    backdrop: {
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'sbFadeIn 0.2s ease both',
    },
    modal: {
        width: 'min(620px, 92vw)', maxHeight: '80vh', display: 'flex', flexDirection: 'column',
        background: 'var(--bg-surface)', border: '1px solid var(--border-strong)',
        borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        animation: 'sbSlideUp 0.3s cubic-bezier(0.16,1,0.3,1) both',
    },
    header: {
        padding: '18px 22px 14px', borderBottom: '1px solid var(--border-default)',
        display: 'flex', alignItems: 'baseline', gap: 10,
    },
    title: { fontFamily: 'var(--font-heading)', fontSize: 20, fontWeight: 500, color: 'var(--text-primary)' },
    subtitle: {
        fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)',
        letterSpacing: '0.14em', textTransform: 'uppercase', marginLeft: 'auto',
    },
    closeBtn: { marginLeft: 8, background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 20, padding: 0 },
    body: {
        overflowY: 'auto', padding: '16px 22px 22px',
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px 28px',
    },
    group: {},
    groupTitle: {
        fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em',
        textTransform: 'uppercase', color: 'var(--accent-warning)', marginBottom: 8,
    },
    row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 0', gap: 12 },
    label: { fontSize: 13, color: 'var(--text-secondary)' },
    keys: { display: 'flex', gap: 4, flexShrink: 0 },
    key: {
        fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-primary)',
        background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
        borderRadius: 5, padding: '2px 7px', minWidth: 18, textAlign: 'center',
    },
}

function ShortcutsModal({ isOpen, onClose }) {
    if (!isOpen) return null
    const onBackdrop = (e) => { if (e.target === e.currentTarget) onClose() }

    return createPortal(
        <>
            <style>{`
                @keyframes sbFadeIn { from { opacity: 0 } to { opacity: 1 } }
                @keyframes sbSlideUp { from { opacity: 0; transform: translateY(12px) } to { opacity: 1; transform: translateY(0) } }
            `}</style>
            <div style={s.backdrop} onClick={onBackdrop}>
                <div style={s.modal}>
                    <div style={s.header}>
                        <span style={s.title}>Keyboard shortcuts</span>
                        <span style={s.subtitle}>Preset</span>
                        <button onClick={onClose} style={s.closeBtn} aria-label="Close">×</button>
                    </div>
                    <div style={s.body}>
                        {GROUPS.map(g => (
                            <div key={g.title} style={s.group}>
                                <div style={s.groupTitle}>{g.title}</div>
                                {g.rows.map(([label, keys]) => (
                                    <div key={label} style={s.row}>
                                        <span style={s.label}>{label}</span>
                                        <span style={s.keys}>
                                            {keys.map((k, i) => <span key={i} style={s.key}>{k}</span>)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </>,
        document.body,
    )
}

export default ShortcutsModal
