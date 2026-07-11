import { createContext, useCallback, useContext, useMemo, useState } from 'react'

// Mirrors SandboxViewContext (do NOT modify that file). Drives the Calendar peek drawer and its
// escalation to a half-split. Pin persists across navigation (provider lives at the app root);
// only close() clears it. `view` is persisted to localStorage so the last Day/Week/Month choice
// survives reloads, shared by the peek, the /calendar route, and the half-split pane.
const CalendarViewContext = createContext(null)

export const CAL_VIEW_MODES = {
    HIDDEN: 'hidden',
    PEEK: 'peek',
    HALF: 'half',
    FULL: 'full',
}

const VIEW_KEY = 'cinder_cal_last_view'
const TALL_KEY = 'cinder_cal_tall' // height mode: fill the viewport (true) vs fit/overview (false)
const DAY2COL_KEY = 'cinder_cal_day_2col'       // Day view: single timeline vs 2-column (morning/afternoon)
const DAY_BALANCED_KEY = 'cinder_cal_day_balanced' // 2-column: equal-height columns (rebalance) vs noon split
const VIEWS = ['day', 'week', 'month']

function todayISO() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function CalendarViewProvider({ children }) {
    const [mode, setMode] = useState(CAL_VIEW_MODES.HIDDEN)
    const [pinned, setPinned] = useState(false)
    const [focusedDay, setFocusedDay] = useState(todayISO)
    const [view, setViewState] = useState(() => {
        const v = localStorage.getItem(VIEW_KEY)
        return VIEWS.includes(v) ? v : 'month'
    })

    const setView = useCallback((v) => {
        if (!VIEWS.includes(v)) return
        setViewState(v)
        try { localStorage.setItem(VIEW_KEY, v) } catch { /* ignore */ }
    }, [])

    // Height mode: tall = views fill the viewport (generous, may scroll); false = fit/overview.
    const [tall, setTall] = useState(() => localStorage.getItem(TALL_KEY) !== 'false')
    const toggleTall = useCallback(() => {
        setTall(prev => {
            const next = !prev
            try { localStorage.setItem(TALL_KEY, String(next)) } catch { /* ignore */ }
            return next
        })
    }, [])

    // Day view: 2-column (morning / afternoon) layout, and whether the two columns are
    // rebalanced to equal height (vs the default noon split). Both persist across launches.
    const [day2col, setDay2col] = useState(() => localStorage.getItem(DAY2COL_KEY) === 'true')
    const toggleDay2col = useCallback(() => {
        setDay2col(prev => {
            const next = !prev
            try { localStorage.setItem(DAY2COL_KEY, String(next)) } catch { /* ignore */ }
            return next
        })
    }, [])
    const [dayBalanced, setDayBalanced] = useState(() => localStorage.getItem(DAY_BALANCED_KEY) === 'true')
    const toggleDayBalanced = useCallback(() => {
        setDayBalanced(prev => {
            const next = !prev
            try { localStorage.setItem(DAY_BALANCED_KEY, String(next)) } catch { /* ignore */ }
            return next
        })
    }, [])

    // Cmd/Ctrl+; — hidden ↔ peek (from half, collapse straight to hidden).
    const toggle = useCallback(() => {
        setMode(m => (m === CAL_VIEW_MODES.HIDDEN ? CAL_VIEW_MODES.PEEK : CAL_VIEW_MODES.HIDDEN))
        setPinned(false)
    }, [])

    const peek = useCallback(() => { setMode(CAL_VIEW_MODES.PEEK); setPinned(false) }, [])
    const pin = useCallback(() => { setMode(CAL_VIEW_MODES.HALF); setPinned(true) }, [])
    const unpin = useCallback(() => { setMode(CAL_VIEW_MODES.PEEK); setPinned(false) }, [])
    const close = useCallback(() => { setMode(CAL_VIEW_MODES.HIDDEN); setPinned(false) }, [])

    const value = useMemo(() => ({
        mode,
        pinned,
        focusedDay,
        view,
        tall,
        toggleTall,
        day2col,
        toggleDay2col,
        dayBalanced,
        toggleDayBalanced,
        setFocusedDay,
        setView,
        toggle,
        peek,
        pin,
        unpin,
        close,
        isHidden: mode === CAL_VIEW_MODES.HIDDEN,
        isPeek: mode === CAL_VIEW_MODES.PEEK,
        isHalf: mode === CAL_VIEW_MODES.HALF,
        isFull: mode === CAL_VIEW_MODES.FULL,
    }), [mode, pinned, focusedDay, view, tall, toggleTall, day2col, toggleDay2col, dayBalanced, toggleDayBalanced, setView, toggle, peek, pin, unpin, close])

    return (
        <CalendarViewContext.Provider value={value}>
            {children}
        </CalendarViewContext.Provider>
    )
}

export function useCalendarView() {
    const ctx = useContext(CalendarViewContext)
    if (!ctx) throw new Error('useCalendarView must be used within <CalendarViewProvider>')
    return ctx
}
