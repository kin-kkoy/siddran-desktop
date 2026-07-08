import { Layer, Shape, Rect, Ellipse, Line, Arrow } from 'react-konva'
import { useCallback, useEffect, useRef, useState } from 'react'
import { strokeOutline, drawStrokePath } from './strokeOutline'
import { renderShape, isLineKind } from '../shapes/registry'
import { routeConnector } from '../connectors/geometry'

/**
 * Top layer holding only the in-progress previews (active stroke + active
 * shape). Its rAF loops re-render this tiny layer per frame; the heavy
 * committed GraphicsLayer below stays untouched while drawing.
 */
function ActiveShapePreview({ shape }) {
    if (!shape) return null
    const { kind, x0, y0, x1, y1, style } = shape
    const minX = Math.min(x0, x1), minY = Math.min(y0, y1)
    const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0)
    const common = {
        stroke: style.stroke, strokeWidth: style.strokeWidth,
        listening: false, perfectDrawEnabled: false, dash: [6, 4],
    }

    // ── ellipse ──
    if (kind === 'ellipse') {
        return <Ellipse x={minX + w / 2} y={minY + h / 2} radiusX={w / 2} radiusY={h / 2}
            fill={style.fill !== 'transparent' ? style.fill : undefined} {...common} />
    }

    // ── line-type: line, arrow, elbowArrow, divider ──
    if (isLineKind(kind)) {
        if (kind === 'line' || kind === 'divider') {
            const pts = kind === 'divider' ? [x0, y0, x1, y0] : [x0, y0, x1, y1]
            return <Line points={pts} lineCap="round" {...common} />
        }
        // arrow & elbowArrow
        const pts = kind === 'elbowArrow' ? [x0, y0, x1, y0, x1, y1] : [x0, y0, x1, y1]
        return <Arrow points={pts} fill={style.stroke} pointerLength={10} pointerWidth={10} {...common} />
    }

    // ── rect / roundedRect ──
    if (kind === 'rect' || kind === 'roundedRect') {
        return <Rect x={minX} y={minY} width={w} height={h}
            cornerRadius={style.radius || (kind === 'roundedRect' ? 12 : 0)}
            fill={style.fill !== 'transparent' ? style.fill : undefined} {...common} />
    }

    // ── registry polygon shapes ──
    return (
        <Shape
            x={minX} y={minY}
            sceneFunc={(ctx, sh) => {
                ctx.beginPath()
                renderShape(ctx, kind, w, h, style.radius || 0)
                ctx.fillStrokeShape(sh)
            }}
            fill={style.fill !== 'transparent' ? style.fill : undefined}
            {...common}
        />
    )
}

function ActiveConnectorPreview({ draft }) {
    if (!draft) return null
    const { fromPoint, toPoint, routing } = draft
    const pts = routeConnector(fromPoint, toPoint, routing || 'elbow')
    return (
        <Arrow points={pts} stroke="#f0b840" fill="#f0b840" strokeWidth={2}
            pointerLength={10} pointerWidth={10} dash={[6, 4]}
            lineCap="round" lineJoin="round" listening={false} perfectDrawEnabled={false} />
    )
}

function ActiveLayer({ activeStrokeRef, activeShapeRef, activeConnectorRef }) {
    const [, force] = useState(0)
    const strokeAlive = useRef(false)
    const shapeAlive = useRef(false)
    const connectorAlive = useRef(false)
    const rafStroke = useRef(0)
    const rafShape = useRef(0)
    const rafConnector = useRef(0)
    const lastLen = useRef(0)

    // active stroke loop — gated on point growth (stationary pen = no recompute)
    useEffect(() => {
        const startLoop = () => {
            if (strokeAlive.current) return
            strokeAlive.current = true
            lastLen.current = 0
            const tick = () => {
                if (!strokeAlive.current) return
                const a = activeStrokeRef.current
                if (a) {
                    if (a.points.length !== lastLen.current) { lastLen.current = a.points.length; force(n => n + 1) }
                    rafStroke.current = requestAnimationFrame(tick)
                } else { strokeAlive.current = false; force(n => n + 1) }
            }
            rafStroke.current = requestAnimationFrame(tick)
        }
        activeStrokeRef.startLoop = startLoop
        return () => { strokeAlive.current = false; cancelAnimationFrame(rafStroke.current); delete activeStrokeRef.startLoop }
    }, [activeStrokeRef])

    // active shape loop
    useEffect(() => {
        const startLoop = () => {
            if (shapeAlive.current) return
            shapeAlive.current = true
            const tick = () => {
                if (!shapeAlive.current) return
                if (activeShapeRef.current) { force(n => n + 1); rafShape.current = requestAnimationFrame(tick) }
                else { shapeAlive.current = false; force(n => n + 1) }
            }
            rafShape.current = requestAnimationFrame(tick)
        }
        activeShapeRef.startLoop = startLoop
        return () => { shapeAlive.current = false; cancelAnimationFrame(rafShape.current); delete activeShapeRef.startLoop }
    }, [activeShapeRef])

    // active connector-drag loop
    useEffect(() => {
        if (!activeConnectorRef) return undefined
        const startLoop = () => {
            if (connectorAlive.current) return
            connectorAlive.current = true
            const tick = () => {
                if (!connectorAlive.current) return
                if (activeConnectorRef.current) { force(n => n + 1); rafConnector.current = requestAnimationFrame(tick) }
                else { connectorAlive.current = false; force(n => n + 1) }
            }
            rafConnector.current = requestAnimationFrame(tick)
        }
        activeConnectorRef.startLoop = startLoop
        return () => { connectorAlive.current = false; cancelAnimationFrame(rafConnector.current); delete activeConnectorRef.startLoop }
    }, [activeConnectorRef])

    const active = activeStrokeRef.current
    const activeOutline = active ? strokeOutline(active.points, { ...active.options, last: false }) : null
    const activeSceneFunc = useCallback((ctx, shape) => {
        const outline = shape.getAttr('outline')
        if (!outline || outline.length === 0) return
        ctx.beginPath()
        drawStrokePath(ctx, outline)
        ctx.fillStrokeShape(shape)
    }, [])

    return (
        <Layer listening={false}>
            {active && activeOutline && (
                <Shape sceneFunc={activeSceneFunc} outline={activeOutline} fill={active.color}
                    listening={false} perfectDrawEnabled={false} />
            )}
            <ActiveShapePreview shape={activeShapeRef.current} />
            <ActiveConnectorPreview draft={activeConnectorRef?.current} />
        </Layer>
    )
}

export default ActiveLayer
