import { useCallback, useEffect, useRef, useState } from 'react'
import { presentedFrames, startIndex } from './slides'

const invoke = () => (typeof window !== 'undefined' && (window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke)) || null

/** Ask the shell for fullscreen; resolves to whether it was fullscreen before (null outside Tauri). */
export async function setFullscreen(enabled) {
    const inv = invoke()
    if (!inv) return null
    try { return !!(await inv('set_presentation_fullscreen', { enabled: !!enabled })) } catch { return null }
}

/**
 * Presentation mode's lifecycle (spec §11.8). Entering remembers the viewport,
 * selection and tool and goes fullscreen; leaving restores all of them exactly
 * (R11.18). Presenting never writes the board or the undo stack.
 */
export function usePresentation({ canvas, items }) {
    const [session, setSession] = useState(null)   // { start: index, n } | null
    const saved = useRef(null)

    // `from`: false = the first slide, true = "from here" (the selected frame,
    // else the one in view), or a frame id.
    const start = useCallback((from = false) => {
        const shown = presentedFrames(items)
        if (!shown.length) return false
        const center = canvas.worldFromScreen({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
        const at = typeof from === 'string' ? startIndex(items, shown, { selectedIds: new Set([from]) })
            : from ? startIndex(items, shown, { selectedIds: canvas.selectedIds, center }) : 0
        saved.current = {
            viewport: canvas.viewport,
            selection: new Set(canvas.selectedIds),
            tool: canvas.tool,
            fullscreen: null,
        }
        canvas.clearSelection()
        if (canvas.tool !== 'pointer') canvas.setTool('pointer')
        setSession(s => ({ start: Math.max(0, at), n: (s?.n || 0) + 1 }))
        setFullscreen(true).then(was => { if (saved.current) saved.current.fullscreen = was })
        return true
    }, [items, canvas])

    const stop = useCallback(() => {
        const s = saved.current
        saved.current = null
        setSession(null)
        if (!s) return
        canvas.setViewport(s.viewport)
        canvas.setSelection(s.selection)
        canvas.setTool(s.tool)
        // Leave fullscreen only if presenting put us there.
        if (s.fullscreen === false) setFullscreen(false)
    }, [canvas])

    // Leaving the board mid-presentation must not strand the window fullscreen.
    useEffect(() => () => { if (saved.current?.fullscreen === false) setFullscreen(false) }, [])

    return { session, start, stop }
}
