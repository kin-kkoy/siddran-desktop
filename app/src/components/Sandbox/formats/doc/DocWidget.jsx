import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { LuFilePen, LuMaximize2, LuMinimize2, LuChevronDown, LuLink, LuCheck, LuExternalLink, LuSearch, LuFilePlus2, LuUnlink } from 'react-icons/lu'
import styles from '../FormatWidget.module.css'
import dStyles from './Doc.module.css'
import tStyles from '../Table.module.css'
import Popover from '../Popover'
import CodeMirrorEditor from '../../../Editor/CodeMirrorEditor'
import NoteSearch from '../../../Notes/NoteSearch'
import { useBagNotes } from '../../../../contexts/BagNotesContext'
import { useNotesApi } from '../../../../contexts/NotesApiContext'
import { cutLabel } from '../../selection/attach'
import { stepFontSize } from '../../text/textStyle'
import { isNoteDoc, docStats, statsLabel, DOC_TEMPLATES, DOC_CHAR_LIMIT, templateTitle } from './doc'
import { slashCompletions } from './slash'

const EXTRA_COMPLETIONS = [slashCompletions]
// Spec §13.3.3: autosave about half a second after the last keystroke.
const SAVE_DELAY = 500

/**
 * A Doc on the board (doc.js): a window like the other Format widgets — title
 * bar to move it, the selection handles to resize it, ⛶ for full screen — with
 * the notes editor inside. Its text is either kept in the board (`payload.body`,
 * one undo step per save) or a real note, saved through the notes store.
 */
function DocChrome({ item, commit, focus, focusSize, onFocusSize, renaming, onRenameDone, onToggleFocus, onTitlePointerDown }) {
    const p = item.payload || {}
    const notes = useBagNotes()
    const { editBody, addNote } = useNotesApi()
    const navigate = useNavigate()
    const linked = isNoteDoc(p)
    const note = linked ? notes?.find(n => String(n.id) === String(p.source.noteId)) : null
    const [titleEdit, setTitleEdit] = useState(false)
    const [menu, setMenu] = useState(false)
    const [find, setFind] = useState(null)   // a token that bumps on each Ctrl+F; null = closed
    const srcRef = useRef(null)
    const searchApiRef = useRef(null)
    const closeMenu = useCallback(() => setMenu(false), [])
    const editing = titleEdit || renaming

    // What's on screen right now, for the footer: kept live as you type (the board
    // payload only catches up on save).
    const savedText = linked ? (note?.body ?? '') : (p.body || '')
    const [live, setLive] = useState(savedText)
    useEffect(() => { setLive(savedText) }, [savedText])
    const [stats, setStats] = useState(() => docStats(savedText))
    useEffect(() => {
        const id = setTimeout(() => setStats(docStats(live)), 200)
        return () => clearTimeout(id)
    }, [live])

    const onSave = useCallback((md) => {
        if (linked) return note ? editBody?.(note.id, md) : false
        commit(q => (q.body === md ? q : { ...q, body: md }))
        return true
    }, [linked, note, editBody, commit])

    const doneRename = (v) => {
        setTitleEdit(false)
        onRenameDone?.(v)
    }

    // ---- the source menu ----
    const linkTo = (n) => { setMenu(false); commit(q => ({ ...q, source: { type: 'note', noteId: n.id } })) }
    const keepHere = () => {
        setMenu(false)
        // Unlinking takes a copy of the note's text, so nothing vanishes from the board.
        commit(q => ({ ...q, source: { type: 'own' }, body: note ? (note.body || '') : (q.body || '') }))
    }
    const saveAsNote = async () => {
        setMenu(false)
        if (!addNote) return
        const body = p.body || ''
        const created = await addNote(p.title || 'Doc')
        if (!created) return
        if (body && !(await editBody?.(created.id, body))) return
        // The text now lives in the note; the board keeps only the link.
        commit(q => ({ ...q, source: { type: 'note', noteId: created.id }, body: '' }))
    }
    const applyTemplate = (t) => {
        const body = t.body()
        commit(q => {
            const isDefault = !q.title || /^Doc( \d+)?$/.test(q.title)
            return { ...q, body, title: isDefault ? templateTitle(t.id, q.title) : q.title }
        })
    }

    const showTemplates = !linked && !live.trim()
    const nearLimit = stats.chars >= DOC_CHAR_LIMIT * 0.9

    const onKeyDown = (e) => {
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'f' || e.key === 'F')) {
            e.preventDefault(); e.stopPropagation()
            setFind(t => (t || 0) + 1)
            return
        }
        // Esc leaves the text (R13.3) — after the editor's own Esc (closing the slash menu) had its turn.
        if (e.key === 'Escape' && !e.defaultPrevented && e.target.closest?.('.cm-editor')) {
            e.stopPropagation()
            e.target.blur?.()
            document.activeElement?.blur?.()
        }
    }

    return (
        <>
            <header className={styles.bar} onPointerDown={onTitlePointerDown}
                onDoubleClick={(e) => { if (!e.target.closest('button')) setTitleEdit(true) }}>
                <LuFilePen size={focus ? 16 : 14} className={styles.barIcon} />
                {editing ? (
                    <input className={styles.renameInput} autoFocus defaultValue={p.title || ''} aria-label="Doc title"
                        onPointerDown={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                            e.stopPropagation()
                            if (e.key === 'Enter') e.currentTarget.blur()
                            if (e.key === 'Escape') { e.currentTarget.value = p.title || ''; e.currentTarget.blur() }
                        }}
                        onBlur={(e) => doneRename(e.currentTarget.value.trim())} />
                ) : (
                    <span className={styles.barTitle} title="Double-click to rename">{p.title || 'Untitled'}</span>
                )}
                <span className={styles.barSpacer} />
                <button className={styles.barBtn} onClick={() => setFind(t => (t ? null : 1))} title="Find in this Doc (Ctrl+F)" aria-label="Find">
                    <LuSearch size={13} />
                </button>
                <button ref={srcRef} className={`${styles.srcBtn} ${linked ? styles.srcLinked : ''}`} onClick={() => setMenu(m => !m)}
                    title={linked ? 'This Doc is a note in your Bag' : 'This Doc’s text is kept in the board'} aria-label="Where the text lives">
                    {linked && <LuLink size={11} />}
                    <span>{linked ? (note?.title || 'Note gone') : 'In this board'}</span>
                    <LuChevronDown size={11} />
                </button>
                {focus && onFocusSize && (
                    <span className={styles.sizeStep}>
                        <button className={styles.barBtn} onClick={() => onFocusSize(-1)} title="Smaller text (Ctrl+−)" aria-label="Smaller text">−</button>
                        <span className={styles.sizeValue} title="Full-screen text size">{focusSize}</span>
                        <button className={styles.barBtn} onClick={() => onFocusSize(1)} title="Bigger text (Ctrl+=)" aria-label="Bigger text">+</button>
                    </span>
                )}
                <button className={styles.barBtn} onClick={onToggleFocus} title={focus ? 'Back to the board (Esc)' : 'Full screen (Enter)'}
                    aria-label={focus ? 'Exit full screen' : 'Full screen'}>
                    {focus ? <LuMinimize2 size={15} /> : <LuMaximize2 size={13} />}
                </button>
            </header>
            {find != null && (
                <div className={dStyles.find} onPointerDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') setFind(null) }}>
                    <NoteSearch searchRef={searchApiRef} viewMode={false} focusToken={find} onClose={() => setFind(null)} />
                </div>
            )}
            {/* data-sb-scroll: the board's wheel scrolls the text instead of zooming. */}
            <div className={`${styles.body} ${dStyles.body}`} data-sb-scroll="true" onKeyDown={onKeyDown}>
                {linked && !note ? (
                    <div className={dStyles.gone}>
                        <p>The note this Doc showed was deleted (or isn’t in this Bag).</p>
                        <button className={tStyles.popBtn} onClick={keepHere}>Keep an empty Doc in the board</button>
                    </div>
                ) : (
                    <>
                        {showTemplates && (
                            <div className={dStyles.templates} onPointerDown={(e) => e.stopPropagation()}>
                                <span className={dStyles.templatesHead}>Start from</span>
                                {DOC_TEMPLATES.filter(t => t.id !== 'blank').map(t => (
                                    <button key={t.id} className={dStyles.template} onClick={() => applyTemplate(t)} title={t.hint}>{t.label}</button>
                                ))}
                                <span className={dStyles.templatesHint}>or just type — <kbd>/</kbd> for blocks</span>
                            </div>
                        )}
                        <div className={dStyles.editor} data-sb-noedit="true">
                            <CodeMirrorEditor
                                // A new source is a new document: remount rather than merge one into the other.
                                key={linked ? `note:${p.source.noteId}` : 'own'}
                                initialContent={savedText}
                                externalBody={savedText}
                                onSave={onSave}
                                onDocChange={setLive}
                                noteId={linked ? note.id : `doc:${item.id}`}
                                placeholder={linked ? 'Write here — it saves to the note.' : 'Write here…'}
                                notes={notes}
                                onNavigateNote={(id) => navigate(`/notes/${id}`)}
                                showDock={false}
                                saveDelay={SAVE_DELAY}
                                extraCompletions={EXTRA_COMPLETIONS}
                                searchApiRef={searchApiRef}
                            />
                        </div>
                    </>
                )}
            </div>
            <footer className={dStyles.footer}>
                <span>{statsLabel(stats)}</span>
                {nearLimit && (
                    <span className={stats.chars > DOC_CHAR_LIMIT ? dStyles.over : dStyles.near}
                        title="A Doc holds about 80,000 characters. Past that, start a new Doc.">
                        {stats.chars.toLocaleString()} / {DOC_CHAR_LIMIT.toLocaleString()}
                    </span>
                )}
            </footer>
            {menu && (
                <Popover anchor={srcRef} onClose={closeMenu} width={250} label="Where the text lives">
                    <div className={tStyles.popHead}>The text lives</div>
                    <button className={tStyles.popItem} onClick={linked ? keepHere : closeMenu}>
                        <span className={tStyles.popTick}>{!linked && <LuCheck size={13} />}</span>
                        <span className={tStyles.popLabel}>In this board</span>
                        {linked && <LuUnlink size={13} />}
                    </button>
                    {linked && note && (
                        <button className={tStyles.popItem} onClick={() => { setMenu(false); navigate(`/notes/${note.id}`) }}>
                            <span className={tStyles.popTick}><LuCheck size={13} /></span>
                            <span className={tStyles.popLabel}>{note.title || 'Untitled'}</span>
                            <LuExternalLink size={13} />
                        </button>
                    )}
                    {!linked && (
                        <button className={tStyles.popItem} onClick={saveAsNote}>
                            <span className={tStyles.popTick} />
                            <LuFilePlus2 size={14} /> <span className={tStyles.popLabel}>Save as a new note</span>
                        </button>
                    )}
                    <div className={tStyles.popSep} />
                    <NotePicker notes={notes} current={linked ? p.source.noteId : null} onPick={linkTo} />
                    <div className={tStyles.popNote}>
                        {linked ? 'Edits go straight to the note. Board undo doesn’t cover them; the note’s own history does.'
                            : 'Linking shows a note here instead; this text stays in the board for when you switch back.'}
                    </div>
                </Popover>
            )}
        </>
    )
}

function NotePicker({ notes, current, onPick }) {
    const [q, setQ] = useState('')
    const list = useMemo(() => {
        const needle = q.trim().toLowerCase()
        return (notes || [])
            .filter(n => !String(n.id).startsWith('temp-'))
            .filter(n => !needle || (n.title || '').toLowerCase().includes(needle))
            .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
            .slice(0, 30)
    }, [notes, q])
    return (
        <>
            <div className={tStyles.popRow}>
                <input className={tStyles.popInput} placeholder="Show a note instead…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a note" />
            </div>
            <div className={dStyles.pickList}>
                {list.map(n => (
                    <button key={n.id} className={tStyles.popItem} onClick={() => onPick(n)} disabled={String(n.id) === String(current)}>
                        <span className={tStyles.popTick} />
                        <span className={tStyles.popLabel}>{n.title || 'Untitled'}</span>
                    </button>
                ))}
                {!list.length && <div className={tStyles.popEmpty}>No notes match.</div>}
            </div>
        </>
    )
}

// Same text-size rules as the other widgets (FormatWidget.jsx).
const DOC_FONT = 15
const focusFont = (item) => item.payload?.focusFontSize || Math.round((item.payload?.fontSize || DOC_FONT) * 1.15)

function DocWidget({ item, tool, selected, renaming, cut, onSelect, onGrab, onCommit, onOpenFocus, onRenameDone }) {
    const commit = useCallback((fn) => onCommit(item.id, fn), [onCommit, item.id])
    const locked = !!item.payload?.locked
    const onPointerDown = (e) => {
        if (e.button !== 0) return
        e.stopPropagation()
        // Clicking into the text (or a control) doesn't (re)select the widget — no floating bar over what you're writing.
        if (e.target.closest('input, button, select, textarea, .cm-editor, [data-sb-noedit]')) return
        onSelect?.(item.id, e.shiftKey)
    }
    const onTitlePointerDown = (e) => {
        if (e.button !== 0 || tool === 'eraser' || e.target.closest('input, button')) return
        e.stopPropagation()
        onGrab?.(e, item.id, locked)
    }
    const onRename = (v) => {
        onRenameDone?.(item.id)
        if (v && v !== item.payload?.title) commit(p => ({ ...p, title: v }))
    }
    return (
        <div
            data-sb-card="true"
            data-sb-id={item.id}
            data-sb-scrollcard="true"
            className={`${styles.widget} ${dStyles.doc} ${selected ? styles.selected : ''}`}
            style={{ left: item.x, top: item.y, width: item.w, height: item.h, '--fmt-font': `${item.payload?.fontSize || DOC_FONT}px` }}
            onPointerDown={onPointerDown}
        >
            <DocChrome item={item} commit={commit} renaming={renaming} onRenameDone={onRename}
                onToggleFocus={() => onOpenFocus?.(item.id)} onTitlePointerDown={onTitlePointerDown} />
            {cut && (
                <span className={styles.hiddenBadge} title="Attached to this Doc but past its edge — make it bigger, or drag them off">
                    {cutLabel(cut)}
                </span>
            )}
        </div>
    )
}

/** Full screen: the Doc as a reading-width page over the window. Esc leaves the text first, then full screen. */
export function DocFocus({ item, onClose, onCommit }) {
    const commit = useCallback((fn) => onCommit(item.id, fn), [onCommit, item.id])
    const size = focusFont(item)
    const stepFocus = useCallback((dir) => commit(p => ({ ...p, focusFontSize: stepFontSize(p.focusFontSize || size, dir) })), [commit, size])
    useEffect(() => {
        const onKey = (e) => {
            if ((e.ctrlKey || e.metaKey) && ['=', '+', '-', '_'].includes(e.key)) {
                e.preventDefault(); e.stopPropagation()
                stepFocus(e.key === '=' || e.key === '+' ? 1 : -1)
                return
            }
            if (e.key !== 'Escape' || e.defaultPrevented) return
            const t = document.activeElement
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return   // the text takes its own Esc
            e.stopPropagation()
            onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [onClose, stepFocus])
    return createPortal(
        <div className={styles.focusBackdrop} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
            <div className={`${styles.focusPanel} ${dStyles.focusPanel}`} role="dialog" aria-label={item.payload?.title || 'Doc'} style={{ '--fmt-font': `${size}px` }}>
                <DocChrome item={item} commit={commit} focus focusSize={size} onFocusSize={stepFocus} onToggleFocus={onClose}
                    onRenameDone={(v) => { if (v && v !== item.payload?.title) commit(p => ({ ...p, title: v })) }} />
            </div>
        </div>,
        document.body,
    )
}

export default memo(DocWidget)
