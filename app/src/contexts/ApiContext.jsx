import { createContext, useContext, useMemo } from 'react'

const ApiContext = createContext(null)

export function ApiProvider({ authFetch, API, isAuthed, children }) {
    const value = useMemo(() => ({ authFetch, API, isAuthed }), [authFetch, API, isAuthed])
    return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>
}

export function useApi() {
    const ctx = useContext(ApiContext)
    if (!ctx) throw new Error('useApi must be used within ApiProvider')
    return ctx
}
