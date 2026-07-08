import { useEffect, useRef, useState } from 'react'

/**
 * Positioned DOM text editor that overlays a shape when the user double-clicks
 * it. Blur or Escape commits; auto-focus on mount; data-sb-noedit prevents
 * canvas shortcuts; pointer-down stops propagation so drag/selection don't fire.
 *
 * The editor is transparent (no backdrop) so the shape stays visible while you
 * type. A flex wrapper centres the text both ways, and the textarea auto-grows
 * to its content — so new lines push the block open symmetrically around the
 * centre (document-style) rather than anchoring to the top.
 *
 * Positioned via screenFromWorld on the shape's bounding box, sized to match the
 * shape's screen dimensions. Rendered as a child of the canvas container.
 */
function ShapeTextEditor({ item, canvas, onCommit, onClose }) {
    const p = item.payload || {}
    const [draft, setDraft] = useState(p.text || '')
    const taRef = useRef(null)

    // Screen-space box for the shape
    const topLeft = canvas.screenFromWorld({ x: item.x, y: item.y })
    const zoom = canvas.viewport.zoom
    const sw = (item.w || 100) * zoom
    const sh = (item.h || 60) * zoom

    // Auto-focus and select on mount
    useEffect(() => {
        const ta = taRef.current
        if (ta) { ta.focus(); ta.select() }
    }, [])

    // Auto-grow the textarea to fit its content so the flex wrapper keeps the
    // text vertically centred — it expands around the centre as lines are added.
    useEffect(() => {
        const ta = taRef.current
        if (!ta) return
        ta.style.height = 'auto'
        ta.style.height = `${ta.scrollHeight}px`
    }, [draft, zoom, p.fontSize])

    // Sync draft if text changes externally while we're open
    useEffect(() => { setDraft(p.text || '') }, [p.text])

    // Persist the edit. Backed by a ref so the unmount cleanup below always sees
    // the latest draft/handlers, and a one-shot guard so blur + unmount can't
    // double-apply. This matters because clicking elsewhere fires the canvas's
    // pointerdown → onSelect → setEditingShapeId(null), which unmounts this
    // editor BEFORE its onBlur runs — without the cleanup the text would be lost.
    const committedRef = useRef(false)
    const applyRef = useRef(() => {})
    applyRef.current = () => {
        if (committedRef.current) return
        committedRef.current = true
        const text = draft.trim()
        if (text !== (p.text || '').trim()) onCommit(item.id, { text })
    }
    useEffect(() => () => { applyRef.current() }, [])

    const commit = () => {
        applyRef.current()
        onClose()
    }

    return (
        <div
            data-sb-noedit="true"
            data-sb-handle="true"
            onPointerDown={(e) => {
                // The whole shape is an active edit zone: clicking anywhere
                // inside keeps the caret in the text (placed at the end) instead
                // of committing. Only a click fully outside the shape commits.
                e.stopPropagation()
                if (e.target !== taRef.current) {
                    e.preventDefault()
                    const ta = taRef.current
                    if (ta) { ta.focus(); const n = ta.value.length; ta.setSelectionRange(n, n) }
                }
            }}
            style={{
                position: 'absolute',
                left: topLeft.x,
                top: topLeft.y,
                width: sw,
                height: sh,
                transform: item.rotation ? `rotate(${item.rotation}deg)` : undefined,
                transformOrigin: '0 0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                zIndex: 12,
                pointerEvents: 'auto',
                cursor: 'text',
            }}
        >
            <textarea
                ref={taRef}
                data-sb-noedit="true"
                data-sb-handle="true"
                rows={1}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Escape') { e.preventDefault(); commit() }
                }}
                onPointerDown={(e) => e.stopPropagation()}
                style={{
                    width: '100%',
                    height: 'auto',
                    resize: 'none',
                    border: 'none',
                    outline: 'none',
                    background: 'transparent',
                    color: p.textColor || '#ffffff',
                    fontSize: (p.fontSize || 16) * zoom,
                    fontFamily: 'Inter, system-ui, sans-serif',
                    fontWeight: p.bold ? 'bold' : 'normal',
                    lineHeight: 1.25,
                    textAlign: p.textAlign || 'center',
                    padding: `0 ${8 * zoom}px`,
                    overflow: 'hidden',
                    pointerEvents: 'auto',
                    boxSizing: 'border-box',
                }}
            />
        </div>
    )
}

export default ShapeTextEditor
