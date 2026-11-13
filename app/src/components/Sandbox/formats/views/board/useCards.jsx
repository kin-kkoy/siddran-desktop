import { useEffect, useMemo, useRef, useState } from 'react'
import { isEmptyValue } from '../../fields'
import DetailPanel from '../table/DetailPanel'
import { AttachmentPreview } from '../table/Attachments'
import { useOpenAttachment } from '../table/attachKinds'

/**
 * Card state and callbacks. `order` = the record ids as the view shows them
 * (the detail panel steps through it). Returns a stable `api` for the cards
 * (they're memoized) plus the pieces the view renders.
 */
export function useCards({ source, primary, all, order, rootRef, down }) {
    const [sel, setSel] = useState(null)        // the selected card's record id
    const [editing, setEditing] = useState(null)
    const [detail, setDetail] = useState(null)
    const [preview, setPreview] = useState(null)
    const openAttachment = useOpenAttachment(setPreview)
    const focusRoot = () => rootRef.current?.focus({ preventScroll: true })
    const canEditTitle = !!primary && source.editable.has(primary.id)

    const act = useRef(null)
    act.current = {
        down,
        click: (ev, rid) => {
            focusRoot()
            setSel(rid)
            const rec = all.find(r => r.id === rid)
            // An empty title edits on one click, a filled one on a double-click; one tap on a touch screen (the Table's rules).
            if (canEditTitle && (ev?.pointerType === 'touch' || isEmptyValue(rec?.values?.[primary.id]))) setEditing(rid)
        },
        edit: (rid) => { if (canEditTitle) { setSel(rid); setEditing(rid) } },
        editDone: (rid, v) => {
            setEditing(null)
            const rec = all.find(r => r.id === rid)
            if (v != null && rec && v.trim() !== (rec.values?.[primary.id] || '')) {
                // A linked task always keeps a title.
                if (v.trim() || source.type === 'own') source.update(rid, { [primary.id]: v.trim() || undefined })
            }
            requestAnimationFrame(focusRoot)
        },
        open: (rid) => { setSel(rid); setDetail(rid) },
        remove: (rid) => { if (detail === rid) setDetail(null); setSel(null); source.remove(rid) },
    }
    const api = useMemo(() => {
        const out = {}
        for (const k of ['down', 'click', 'edit', 'editDone', 'open', 'remove']) out[k] = (...a) => act.current[k](...a)
        return out
    }, [])

    // Keys on the view (when no title editor has them): Enter edits the selected card, Space opens it, Esc lets go.
    const onKeyDown = (e) => {
        if ((e.ctrlKey || e.metaKey) && /^[zy]$/i.test(e.key)) return   // the board's undo
        if (e.target !== rootRef.current) return
        if (e.key === 'Escape') { if (!sel) return; e.stopPropagation(); setSel(null); return }
        e.stopPropagation()   // board shortcuts would fire otherwise
        if (!sel) return
        if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); api.edit(sel) }
        else if (e.key === ' ') { e.preventDefault(); setDetail(sel) }
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault()
            const i = order.indexOf(sel)
            const n = order[i + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1)]
            if (n) { setSel(n); rootRef.current?.querySelector(`[data-rid="${CSS.escape(n)}"]`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }) }
        }
    }

    // A press outside the widget (and its menus) lets go of the card.
    useEffect(() => {
        if (!sel) return
        const onDown = (e) => {
            if (rootRef.current?.closest('[data-sb-id], [role="dialog"]')?.contains(e.target)) return
            if (e.target.closest?.('[data-sb-handle="true"]')) return
            setSel(null)
        }
        window.addEventListener('pointerdown', onDown, true)
        return () => window.removeEventListener('pointerdown', onDown, true)
    }, [sel, rootRef])

    // A deleted record (undo, the CLI, another view) takes the selection and the panel with it.
    const exists = (id) => id && all.some(r => r.id === id)
    const selId = exists(sel) ? sel : null
    const detailRec = exists(detail) ? all.find(r => r.id === detail) : null
    const idx = detailRec ? order.indexOf(detail) : -1

    const overlays = (
        <>
            {detailRec && (
                <DetailPanel rec={detailRec} fields={source.fields} primary={primary} source={source}
                    index={idx} count={order.length} hidden={idx < 0}
                    onStep={(d) => { const n = order[idx + d]; if (n) { setDetail(n); setSel(n) } }}
                    onOpen={openAttachment} onClose={() => { setDetail(null); requestAnimationFrame(focusRoot) }} />
            )}
            {preview && <AttachmentPreview att={preview} onClose={() => setPreview(null)} />}
        </>
    )
    return { api, sel: selId, editing, detail: detailRec?.id || null, onKeyDown, overlays, setSel }
}
