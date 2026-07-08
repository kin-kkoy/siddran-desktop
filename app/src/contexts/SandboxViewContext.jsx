import { createContext, useCallback, useContext, useMemo, useState } from 'react'

const SandboxViewContext = createContext(null)

export const SANDBOX_VIEW_MODES = {
    HIDDEN: 'hidden',
    PIP: 'pip',
    HALF: 'half',
    FULL: 'full',
}

export function SandboxViewProvider({ children }) {
    const [mode, setMode] = useState(SANDBOX_VIEW_MODES.HIDDEN)
    const [activeSandboxId, setActiveSandboxId] = useState(null)

    const open = useCallback((sandboxId, nextMode = SANDBOX_VIEW_MODES.PIP) => {
        setActiveSandboxId(sandboxId ?? null)
        setMode(nextMode)
    }, [])

    const close = useCallback(() => {
        setMode(SANDBOX_VIEW_MODES.HIDDEN)
    }, [])

    const value = useMemo(() => ({
        mode,
        setMode,
        activeSandboxId,
        setActiveSandboxId,
        open,
        close,
        isHidden: mode === SANDBOX_VIEW_MODES.HIDDEN,
        isPiP:    mode === SANDBOX_VIEW_MODES.PIP,
        isHalf:   mode === SANDBOX_VIEW_MODES.HALF,
        isFull:   mode === SANDBOX_VIEW_MODES.FULL,
    }), [mode, activeSandboxId, open, close])

    return (
        <SandboxViewContext.Provider value={value}>
            {children}
        </SandboxViewContext.Provider>
    )
}

export function useSandboxView() {
    const ctx = useContext(SandboxViewContext)
    if (!ctx) throw new Error('useSandboxView must be used within <SandboxViewProvider>')
    return ctx
}
