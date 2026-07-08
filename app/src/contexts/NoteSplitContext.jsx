import { createContext, useCallback, useContext, useMemo, useState } from 'react'

// EXPERIMENTAL split view: two notes side by side on NotePage. The left pane is
// always the route note (/notes/:id); the right pane is `splitNoteId` (null until
// the user picks a note from the sidebar). `focusedSide` decides which pane a
// sidebar click targets and which pane shows the focus ring. Mirrors the shape of
// SandboxViewContext / CalendarViewContext.
const NoteSplitContext = createContext(null)

export function NoteSplitProvider({ children }) {
    const [enabled, setEnabled] = useState(false)
    const [splitNoteId, setSplitNoteId] = useState(null)
    const [focusedSide, setFocusedSide] = useState('left')

    // Turn split on with an empty, focused right pane — the user fills it from the sidebar.
    const enable = useCallback(() => {
        setEnabled(true)
        setSplitNoteId(null)
        setFocusedSide('right')
    }, [])

    const disable = useCallback(() => {
        setEnabled(false)
        setSplitNoteId(null)
        setFocusedSide('left')
    }, [])

    const value = useMemo(() => ({
        enabled,
        splitNoteId,
        focusedSide,
        enable,
        disable,
        setSplitNoteId,
        setFocusedSide,
    }), [enabled, splitNoteId, focusedSide, enable, disable])

    return (
        <NoteSplitContext.Provider value={value}>
            {children}
        </NoteSplitContext.Provider>
    )
}

export function useNoteSplit() {
    const ctx = useContext(NoteSplitContext)
    if (!ctx) throw new Error('useNoteSplit must be used within <NoteSplitProvider>')
    return ctx
}
