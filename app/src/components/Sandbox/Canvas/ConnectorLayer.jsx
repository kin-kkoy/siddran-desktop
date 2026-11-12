import { Layer, Line, Rect, Text, Group, Circle } from 'react-konva'
import { memo } from 'react'
import { connectorPoints, labelBox, LABEL_FONT } from '../connectors/geometry'
import { headGeometry, headInset, pathEnds, trimPath, taperedArrowPolygon } from '../connectors/heads'
import { dashFor } from '../connectors/lineStyle'

// Konva paints to <canvas>, which can't resolve CSS variables — use the concrete
// accent (var(--accent-warning) = #f0b840) for the selection halo.
const ACCENT = '#f0b840'

// The canvas background, read from the theme once per paint — a label's pill has
// to match it so the line looks like it passes *behind* the words.
const canvasBg = () => {
    try { return getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim() || '#09090f' } catch { return '#09090f' }
}

/**
 * Committed connectors, painted in their own Konva layer BELOW the shapes layer
 * (so links sit behind the boxes they join). Each connector resolves its path
 * from the *current* referenced item boxes, so moving a shape reroutes its
 * connectors automatically.
 *
 * Smoothness: each connector is memoized on its resolved geometry (a points
 * string) + style + selected flag, so during a shape drag only the connectors
 * touching that shape recompute — the rest skip, mirroring CommittedShape.
 */
// One end marker. Hollow heads are filled with the canvas colour so the line
// doesn't show through them.
function Head({ g, stroke, strokeWidth, bg }) {
    if (!g) return null
    if (g.shape === 'circle') {
        return <Circle x={g.cx} y={g.cy} radius={g.r} fill={g.filled ? stroke : bg} stroke={stroke}
            strokeWidth={strokeWidth} listening={false} perfectDrawEnabled={false} />
    }
    return (
        <Line points={g.pts} closed={g.closed} stroke={stroke} strokeWidth={strokeWidth}
            fill={g.closed ? (g.filled ? stroke : bg) : undefined}
            lineCap="round" lineJoin="round" listening={false} perfectDrawEnabled={false} />
    )
}

const CommittedConnector = memo(function CommittedConnector({ pts, stroke, strokeWidth, head, headStart, selected, label, lineStyle, dash, bg, tapered }) {
    const points = pts.split(',').map(Number)
    const box = labelBox(points, label)
    // Tapered body: one filled arrow from the first point to the last (its own
    // head, so the head settings don't apply).
    const taper = tapered && points.length >= 4
        ? taperedArrowPolygon({ x: points[0], y: points[1] }, { x: points[points.length - 2], y: points[points.length - 1] }, strokeWidth)
        : null
    if (taper) {
        return (
            <>
                {selected && <Line points={points} stroke={ACCENT} strokeWidth={strokeWidth + 10} opacity={0.3} lineCap="round" listening={false} perfectDrawEnabled={false} />}
                <Line points={taper} closed fill={stroke} stroke={stroke} strokeWidth={1.5} lineJoin="round" listening={false} perfectDrawEnabled={false} />
                {box && (
                    <Group listening={false}>
                        <Rect x={box.x} y={box.y} width={box.w} height={box.h} cornerRadius={box.h / 2}
                            fill={bg} stroke={stroke} strokeWidth={1} opacity={0.95} perfectDrawEnabled={false} />
                        <Text x={box.x} y={box.y} width={box.w} height={box.h} text={label}
                            align="center" verticalAlign="middle" fontSize={LABEL_FONT} fill={stroke} perfectDrawEnabled={false} />
                    </Group>
                )}
            </>
        )
    }
    const ends = pathEnds(points)
    const gEnd = ends && headGeometry(head, ends.end.tip, ends.end.prev, strokeWidth)
    const gStart = ends && headGeometry(headStart, ends.start.tip, ends.start.prev, strokeWidth)
    const body = trimPath(points, gStart ? headInset(headStart, strokeWidth) : 0, gEnd ? headInset(head, strokeWidth) : 0)
    const dashArr = dashFor({ lineStyle, dash, strokeWidth })
    return (
        <>
            {selected && (
                <Line
                    points={points}
                    stroke={ACCENT}
                    strokeWidth={strokeWidth + 6}
                    opacity={0.35}
                    lineCap="round" lineJoin="round"
                    listening={false} perfectDrawEnabled={false}
                />
            )}
            <Line
                points={body}
                stroke={stroke} strokeWidth={strokeWidth}
                dash={dashArr}
                lineCap="round" lineJoin="round"
                listening={false} perfectDrawEnabled={false}
            />
            <Head g={gStart} stroke={stroke} strokeWidth={strokeWidth} bg={bg} />
            <Head g={gEnd} stroke={stroke} strokeWidth={strokeWidth} bg={bg} />
            {box && (
                <Group listening={false}>
                    <Rect x={box.x} y={box.y} width={box.w} height={box.h} cornerRadius={box.h / 2}
                        fill={bg} stroke={stroke} strokeWidth={1} opacity={0.95} perfectDrawEnabled={false} />
                    <Text x={box.x} y={box.y} width={box.w} height={box.h} text={label}
                        align="center" verticalAlign="middle" fontSize={LABEL_FONT} fill={stroke} perfectDrawEnabled={false} />
                </Group>
            )}
        </>
    )
})

const ConnectorLayer = memo(function ConnectorLayer({ connectorItems, byId, selectedIds }) {
    const bg = canvasBg()
    return (
        <Layer listening={false}>
            {connectorItems.map(conn => {
                const points = connectorPoints(conn, byId)
                if (!points) return null   // endpoint item gone this frame
                const p = conn.payload || {}
                return (
                    <CommittedConnector
                        key={conn.id}
                        pts={points.join(',')}
                        stroke={p.stroke || '#e2ddf5'}
                        strokeWidth={p.strokeWidth || 2}
                        head={p.head || 'arrow'}
                        headStart={p.headStart || 'none'}
                        selected={selectedIds.has(conn.id)}
                        label={typeof p.label === 'string' ? p.label : ''}
                        lineStyle={p.lineStyle}
                        tapered={p.body === 'tapered'}
                        dash={!!p.dash}
                        bg={bg}
                    />
                )
            })}
        </Layer>
    )
})

export default ConnectorLayer
