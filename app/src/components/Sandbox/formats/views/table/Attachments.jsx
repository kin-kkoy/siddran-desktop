import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { LuFile, LuFileText, LuImage, LuNotebookText, LuX, LuPlus, LuFolderOpen } from 'react-icons/lu'
import styles from '../../Table.module.css'
import { attachFilesViaPicker } from '../../../../../desktop/media'
import { resolveImageUrl } from '../../../../../utils/imageUpload'
import { revealPath } from '../../../../../desktop/reveal'
import { getBagPath } from '../../../../../desktop/localStore'
import { useBagNotes } from '../../../../../contexts/BagNotesContext'
import { kindOf, attKey } from './attachKinds'

/**
 * Attachment cells: a value is [{ path, name }] — a file copied into the Bag
 * (attachments/_boards/) — and/or [{ note, name }], a note in the Bag. Chips
 * open what they point at: a note in the notes page, an image or PDF in a
 * preview, anything else in the file manager.
 */

const ICONS = { note: LuNotebookText, image: LuImage, pdf: LuFileText, file: LuFile }

export function AttachChip({ att, onOpen, onRemove }) {
    const Icon = ICONS[kindOf(att)]
    return (
        <span className={styles.att}>
            <button className={styles.attOpen} title={`Open ${att.name}`} onMouseDown={(e) => e.preventDefault()}
                onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onOpen?.(att) }}>
                <Icon size="1em" /> <span className={styles.attName}>{att.name}</span>
            </button>
            {onRemove && (
                <button className={styles.attRemove} title="Remove (the file stays in the Bag)" aria-label={`Remove ${att.name}`}
                    onClick={() => onRemove(att)}><LuX size="0.9em" /></button>
            )}
        </span>
    )
}

/** An image or PDF over the window; Esc or a click outside closes it. */
export function AttachmentPreview({ att, onClose }) {
    const src = resolveImageUrl(att.path)
    return createPortal(
        <div className={styles.previewBack} data-sb-handle="true" role="dialog" aria-label={att.name}
            onPointerDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose() }}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onClose() }} tabIndex={-1}
            ref={(el) => el?.focus({ preventScroll: true })}>
            <div className={styles.previewPanel}>
                <div className={styles.previewBar}>
                    <span className={styles.attName}>{att.name}</span>
                    <span className={styles.grow} />
                    <button className={styles.popBtnQuiet} onClick={() => revealPath(`${getBagPath()}/${att.path}`)}><LuFolderOpen size={13} /> Show in folder</button>
                    <button className={styles.popIcon} onClick={onClose} aria-label="Close"><LuX size={15} /></button>
                </div>
                {kindOf(att) === 'image'
                    ? <img className={styles.previewImg} src={src} alt={att.name} />
                    : <iframe className={styles.previewFrame} src={src} title={att.name} />}
            </div>
        </div>,
        document.body,
    )
}

/** Inside a popover: what's attached (each removable), add files, attach a note. */
export function AttachEditor({ value, onChange, onOpen }) {
    const list = useMemo(() => (Array.isArray(value) ? value : []), [value])
    const notes = useBagNotes()
    const [noteQ, setNoteQ] = useState(null)   // null = the note search is closed
    const shown = useMemo(() => {
        if (noteQ == null) return []
        const q = noteQ.trim().toLowerCase()
        const have = new Set(list.map(attKey))
        return (notes || []).filter(n => !have.has(`n:${n.id}`) && (!q || (n.title || '').toLowerCase().includes(q))).slice(0, 30)
    }, [notes, noteQ, list])
    const remove = (att) => onChange(list.filter(a => attKey(a) !== attKey(att)))
    const addFiles = async () => {
        const got = await attachFilesViaPicker()
        if (got.length) onChange([...list, ...got])
    }
    return (
        <>
            <div className={styles.popHead}>Attachments</div>
            {list.length === 0 && <div className={styles.popEmpty}>Nothing attached yet.</div>}
            <div className={styles.attList}>
                {list.map(a => <AttachChip key={attKey(a)} att={a} onOpen={onOpen} onRemove={remove} />)}
            </div>
            <div className={styles.popActions}>
                <button className={styles.popBtn} onClick={addFiles}><LuPlus size={13} /> Add files…</button>
                <button className={styles.popBtn} onClick={() => setNoteQ(q => (q == null ? '' : null))}><LuNotebookText size={13} /> Attach a note</button>
            </div>
            {noteQ != null && (
                <>
                    <div className={styles.popRow}>
                        <input className={styles.popInput} autoFocus placeholder="Find a note" value={noteQ} aria-label="Find a note"
                            onChange={(e) => setNoteQ(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter' && shown[0]) { onChange([...list, { note: shown[0].id, name: shown[0].title || 'Untitled' }]); setNoteQ(null) } }} />
                    </div>
                    {shown.map(n => (
                        <button key={n.id} className={styles.popItem} onClick={() => { onChange([...list, { note: n.id, name: n.title || 'Untitled' }]); setNoteQ(null) }}>
                            <span className={styles.popTick}><LuNotebookText size={13} /></span>
                            <span className={styles.popLabel}>{n.title || 'Untitled'}</span>
                        </button>
                    ))}
                    {!shown.length && <div className={styles.popEmpty}>No notes match.</div>}
                </>
            )}
        </>
    )
}
