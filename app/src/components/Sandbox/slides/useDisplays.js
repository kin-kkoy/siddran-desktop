import { useEffect, useState } from 'react'

const invoke = () => (typeof window !== 'undefined' && (window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke)) || null

// Read once per app run; displays rarely change while a board is open, and a
// fresh read happens whenever a size menu opens (`refresh`).
let cache = null
let pending = null

async function load() {
    const inv = invoke()
    if (!inv) return []
    try { return (await inv('list_displays')) || [] } catch { return [] }
}

/**
 * The connected displays, laptop first: [{ name, kind, width, height }]
 * (src-tauri/src/slides.rs). Empty outside the desktop shell.
 */
export function useDisplays() {
    const [displays, setDisplays] = useState(cache || [])
    useEffect(() => {
        let live = true
        if (!cache) {
            pending = pending || load().then(d => { cache = d; pending = null; return d })
            pending.then(d => { if (live) setDisplays(d) })
        }
        return () => { live = false }
    }, [])
    const refresh = () => load().then(d => { cache = d; setDisplays(d) })
    return { displays, refresh }
}
