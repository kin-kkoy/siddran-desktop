import { useCallback, useEffect, useRef, useState } from 'react'
import { loadInk, saveInk, isInkTool } from '../components/Sandbox/ink/presets'

// Re-export from the shape registry so existing imports from this module still work.
export { SHAPE_TOOLS, SHAPE_KEYS, isLineKind } from '../components/Sandbox/shapes/registry'

const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 }
const ZOOM_MIN = 0.1
const ZOOM_MAX = 8

const SHAPE_KEY = 'cinder_sandbox_shapestyle_v1'
export const DEFAULT_SHAPE_STYLE = {
    fill: 'transparent',
    stroke: '#e2ddf5',
    strokeWidth: 2,
    radius: 0,
}

const PAINT_KEY = 'siddran_sandbox_paint_v1'

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
    const [tool, setToolState] = useState(initialTool)
    // The ink tool the dock's draw button returns to.
    const [lastInkTool, setLastInkTool] = useState(isInkTool(initialTool) ? initialTool : 'pen')
    const setTool = useCallback((t) => {
        setToolState(t)
        if (isInkTool(t)) setLastInkTool(t)
    }, [])
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
    // Which of the hovered shape's dots the pointer is magnetised to (n/e/s/w),
    // so a press anywhere in that dot's catch radius starts an arrow.
    const [hoverSide, setHoverSide] = useState(null)
    // SelectionOverlay publishes imperative gestures here (begin a move / an
    // arrow from a given press) so the canvas can start them on pointerdown.
    const overlayApiRef = useRef(null)

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

    // Ink presets: three per pen and per highlighter, each a size + colour +
    // smoothing (+ opacity for the highlighter). Persisted per user. See
    // components/Sandbox/ink/presets.js.
    const [ink, setInkState] = useState(loadInk)
    const updateInk = useCallback((fn) => {
        setInkState(prev => { const next = fn(prev); saveInk(next); return next })
    }, [])
    const selectPreset = useCallback((group, index) => {
        updateInk(prev => ({ ...prev, [group]: { ...prev[group], active: index } }))
    }, [updateInk])
    const updatePreset = useCallback((group, index, patch) => {
        updateInk(prev => ({
            ...prev,
            [group]: { ...prev[group], presets: prev[group].presets.map((p, i) => (i === index ? { ...p, ...patch } : p)) },
        }))
    }, [updateInk])

    // The paint bucket's colour ('transparent' = empty a fill). Separate from
    // the default fill for new shapes, which the shape picker sets.
    const [paintColor, setPaintColorState] = useState(() => {
        try { return localStorage.getItem(PAINT_KEY) || '#5a9cf0' } catch { return '#5a9cf0' }
    })
    const setPaintColor = useCallback((c) => {
        setPaintColorState(c)
        try { localStorage.setItem(PAINT_KEY, c) } catch { /* not remembered */ }
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
        // Text boxes and connectors take the shapes' border colour (the pen's
        // colour now lives in its presets).
        strokeColor: shapeStyle.stroke,
        ink, selectPreset, updatePreset,
        lastInkTool,
        paintColor, setPaintColor,
        shapeStyle, setShapeStyle,
        snapEnabled, setSnapEnabled,
        spacePanning,
        activeStrokeRef,
        activeShapeRef,
        activeConnectorRef,
        hoverId, setHoverId,
        hoverSide, setHoverSide,
        overlayApiRef,
        selectedIds, setSelection, selectOnly, toggleSelection, clearSelection,
        marquee, setMarquee,
        lasso, setLasso,
        worldFromScreen, screenFromWorld,
    }
}
