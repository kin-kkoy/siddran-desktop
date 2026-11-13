import { useEffect, useRef, useState } from 'react'
import { FRAME_TITLE_PX, FRAME_TITLE_GAP } from './frames'

/**
 * Inline rename for a frame: an input laid exactly over the painted title.
 * Enter / Esc / blur commit; the unmount cleanup commits too, because clicking
 * the canvas clears the editing id (unmounting this) before blur would fire —
 * the same trap ShapeTextEditor documents.
 */
function FrameTitleEditor({ frame, canvas, onCommit, onClose }) {
    const [draft, setDraft] = useState(frame.payload?.title || '')
    const ref = useRef(null)
    const zoom = canvas.viewport.zoom
    const at = canvas.screenFromWorld({ x: frame.x, y: frame.y })

    useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])

    const done = useRef(false)
    const apply = useRef(() => {})
    apply.current = () => {
        if (done.current) return
        done.current = true
        onCommit(draft.trim() || 'Frame')
    }
    useEffect(() => () => apply.current(), [])
    const commit = () => { apply.current(); onClose() }

    return (
        <input
            ref={ref}
            data-sb-noedit="true"
            data-sb-handle="true"
            aria-label="Frame title"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); commit() }
            }}
            style={{
                position: 'absolute',
                left: at.x - 4,
                top: at.y - FRAME_TITLE_PX - FRAME_TITLE_GAP - 4,
                width: Math.max(160, Math.min(frame.w * zoom, 420)),
                height: FRAME_TITLE_PX + 8,
                padding: '0 4px',
                fontSize: FRAME_TITLE_PX,
                fontWeight: 600,
                fontFamily: 'Inter, system-ui, sans-serif',
                color: 'var(--text-primary)',
                background: 'var(--bg-primary)',
                border: '1px solid var(--accent-warning)',
                borderRadius: 4,
                outline: 'none',
                zIndex: 12,
            }}
        />
    )
}

export default FrameTitleEditor
