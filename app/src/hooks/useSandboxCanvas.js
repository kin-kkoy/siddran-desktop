import { useCallback, useEffect, useRef, useState } from 'react'

// Re-export from the shape registry so existing imports from this module still work.
export { SHAPE_TOOLS, SHAPE_KEYS, isLineKind } from '../components/Sandbox/shapes/registry'

const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 }
const ZOOM_MIN = 0.1
const ZOOM_MAX = 8

// Key bumped to v3 (was v2) when the single `smoothing` control was
// reintroduced. `size` and `smoothing` are the only user-tunable knobs;
// `smoothing` maps to perfect-freehand's `streamline` (the strongest knob),
// overriding the per-device profile in strokeOutline.js. Other feel knobs
// still live in those profiles.
const BRUSH_KEY = 'cinder_sandbox_brush_v3'
export const DEFAULT_BRUSH = {
    size: 6,
    smoothing: 0.6,
}

const SHAPE_KEY = 'cinder_sandbox_shapestyle_v1'
export const DEFAULT_SHAPE_STYLE = {
    fill: 'transparent',
    stroke: '#e2ddf5',
    strokeWidth: 2,
    radius: 0,
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

/**
 * Owns the canvas viewport (pan/zoom), the active tool, and an imperative
 * activeStroke ref. The activeStroke is intentionally NOT React state — points
 * accumulate dozens of times per second during drawing and React reconciliation
 * would tank framerate. The DrawingLayer reads/writes the ref directly and
 * commits a finished stroke via endStroke() → useSandbox.addItem().
 */
export function useSandboxCanvas(initialTool = 'pointer') {
    const [viewport, setViewportState] = useState(DEFAULT_VIEWPORT)
    const [tool, setTool] = useState(initialTool)
    const [strokeColor, setStrokeColor] = useState('#e2ddf5') // var(--text-primary) cream
    const [spacePanning, setSpacePanning] = useState(false)
    // Snap-to-grid / snap-to-items toggle (magnet button); on by default.
    const [snapEnabled, setSnapEnabled] = useState(true)

    // Selection (a Set of item ids) — shared by the transform overlay across both
    // render worlds (Konva graphics + DOM cards). New Set on each change for
    // React identity.
    const [selectedIds, setSelectedIds] = useState(() => new Set())
    const setSelection = useCallback((ids) => {
        setSelectedIds(ids instanceof Set ? new Set(ids) : new Set(ids ?? []))
    }, [])
    const selectOnly = useCallback((id) => setSelectedIds(id == null ? new Set() : new Set([id])), [])
    const toggleSelection = useCallback((id) => setSelectedIds(prev => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id); else next.add(id)
        return next
    }), [])
    const clearSelection = useCallback(() => setSelectedIds(prev => (prev.size ? new Set() : prev)), [])

    // Marquee rectangle (world coords) during a drag-select; null when idle.
    const [marquee, setMarquee] = useState(null)
    // Freehand lasso path (array of world [x,y]) during a lasso drag; null idle.
    const [lasso, setLasso] = useState(null)

    // In-progress shape (rect/ellipse/line/arrow), imperative like activeStroke.
    const activeShapeRef = useRef(null)
    // In-progress connector drag preview ({ fromPoint, toPoint, routing }),
    // imperative like activeShape — ActiveLayer reads it on a rAF loop.
    const activeConnectorRef = useRef(null)

    // Shape currently hovered by the pointer tool — surfaces the 4 connection
    // dots in SelectionOverlay. null when not over a shape.
    const [hoverId, setHoverId] = useState(null)

    // Shape fill/stroke/width, persisted.
    const [shapeStyle, setShapeStyleState] = useState(() => {
        try {
            const raw = localStorage.getItem(SHAPE_KEY)
            return raw ? { ...DEFAULT_SHAPE_STYLE, ...JSON.parse(raw) } : DEFAULT_SHAPE_STYLE
        } catch { return DEFAULT_SHAPE_STYLE }
    })
    const setShapeStyle = useCallback((patch) => {
        setShapeStyleState(prev => {
            const next = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch }
            try { localStorage.setItem(SHAPE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
            return next
        })
    }, [])

    // Live-tunable brush options (currently just size). Persists to
    // localStorage so the user's dialed-in value survives reload.
    const [brush, setBrushState] = useState(() => {
        try {
            const raw = localStorage.getItem(BRUSH_KEY)
            return raw ? { ...DEFAULT_BRUSH, ...JSON.parse(raw) } : DEFAULT_BRUSH
        } catch { return DEFAULT_BRUSH }
    })
    const setBrush = useCallback((patch) => {
        setBrushState(prev => {
            const next = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch }
            try { localStorage.setItem(BRUSH_KEY, JSON.stringify(next)) } catch { /* ignore */ }
            return next
        })
    }, [])
    const resetBrush = useCallback(() => {
        setBrushState(DEFAULT_BRUSH)
        try { localStorage.removeItem(BRUSH_KEY) } catch { /* ignore */ }
    }, [])

    const activeStrokeRef = useRef(null)
    const viewportRef = useRef(viewport)
    viewportRef.current = viewport

    const setViewport = useCallback((next) => {
        setViewportState(prev => {
            const value = typeof next === 'function' ? next(prev) : next
            return { ...prev, ...value, zoom: clamp(value.zoom ?? prev.zoom, ZOOM_MIN, ZOOM_MAX) }
        })
    }, [])

    // Spacebar pan modifier — while pointer tool is active, holding space lets
    // you drag-pan without switching tools. Matches Figma/Miro muscle memory.
    useEffect(() => {
        const isEditable = (el) => {
            if (!el) return false
            const tag = el.tagName
            return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
        }
        const onKeyDown = (e) => {
            if (e.code === 'Space' && !isEditable(document.activeElement)) {
                e.preventDefault()
                setSpacePanning(true)
            }
        }
        const onKeyUp = (e) => {
            if (e.code === 'Space') setSpacePanning(false)
        }
        window.addEventListener('keydown', onKeyDown)
        window.addEventListener('keyup', onKeyUp)
        return () => {
            window.removeEventListener('keydown', onKeyDown)
            window.removeEventListener('keyup', onKeyUp)
        }
    }, [])

    const worldFromScreen = useCallback(({ x, y }) => {
        const v = viewportRef.current
        return { x: (x - v.x) / v.zoom, y: (y - v.y) / v.zoom }
    }, [])

    const screenFromWorld = useCallback(({ x, y }) => {
        const v = viewportRef.current
        return { x: x * v.zoom + v.x, y: y * v.zoom + v.y }
    }, [])

    // Zoom-to-cursor wheel handler. `pointer` is in screen coords relative to
    // the stage container.
    const zoomAt = useCallback((pointer, delta) => {
        setViewportState(prev => {
            const factor = delta < 0 ? 1.1 : 1 / 1.1
            const nextZoom = clamp(prev.zoom * factor, ZOOM_MIN, ZOOM_MAX)
            const worldX = (pointer.x - prev.x) / prev.zoom
            const worldY = (pointer.y - prev.y) / prev.zoom
            return {
                x: pointer.x - worldX * nextZoom,
                y: pointer.y - worldY * nextZoom,
                zoom: nextZoom,
            }
        })
    }, [])

    const panBy = useCallback((dx, dy) => {
        setViewportState(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }))
    }, [])

    // Combined pinch gesture (touch): zoom about a screen anchor by `factor`
    // AND pan by (dx, dy) screen px, in one viewport update so the centroid
    // tracks the fingers without a frame of jitter.
    const pinch = useCallback((centerScreen, factor, dx, dy) => {
        setViewportState(prev => {
            const nextZoom = clamp(prev.zoom * factor, ZOOM_MIN, ZOOM_MAX)
            const f = nextZoom / prev.zoom
            return {
                x: centerScreen.x - (centerScreen.x - prev.x) * f + dx,
                y: centerScreen.y - (centerScreen.y - prev.y) * f + dy,
                zoom: nextZoom,
            }
        })
    }, [])

    return {
        viewport, setViewport, zoomAt, panBy, pinch,
        tool, setTool,
        strokeColor, setStrokeColor,
        brush, setBrush, resetBrush,
        shapeStyle, setShapeStyle,
        snapEnabled, setSnapEnabled,
        spacePanning,
        activeStrokeRef,
        activeShapeRef,
        activeConnectorRef,
        hoverId, setHoverId,
        selectedIds, setSelection, selectOnly, toggleSelection, clearSelection,
        marquee, setMarquee,
        lasso, setLasso,
        worldFromScreen, screenFromWorld,
    }
}
