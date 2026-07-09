import { createContext, useCallback, useContext, useMemo, useState } from 'react'

// EXPERIMENTAL split view: two notes side by side on NotePage. The left pane is
// always the route note (/notes/:id); the right pane is `splitTarget` (null until
// the user picks a note/sandbox from the picker). `focusedSide` decides which pane
// shows the focus ring.
const NoteSplitContext = createContext(null)

export function NoteSplitProvider({ children }) {
    const [enabled, setEnabled] = useState(false)
    const [splitTarget, setSplitTarget] = useState(null)
    const [focusedSide, setFocusedSide] = useState('left')

    // Turn split on with an empty, focused right pane — the user fills it from the picker.
    const enable = useCallback(() => {
        setEnabled(true)
        setSplitTarget(null)
        setFocusedSide('right')
    }, [])

    const disable = useCallback(() => {
        setEnabled(false)
        setSplitTarget(null)
        setFocusedSide('left')
    }, [])

    const value = useMemo(() => ({
        enabled,
        splitTarget,
        focusedSide,
        enable,
        disable,
        setSplitTarget,
        setFocusedSide,
    }), [enabled, splitTarget, focusedSide, enable, disable])

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
