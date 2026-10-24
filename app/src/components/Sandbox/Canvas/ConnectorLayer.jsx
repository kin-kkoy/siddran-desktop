import { Layer, Arrow, Line, Rect, Text, Group } from 'react-konva'
import { memo } from 'react'
import { connectorPoints, labelBox, LABEL_FONT } from '../connectors/geometry'

// Konva paints to <canvas>, which can't resolve CSS variables — use the concrete
// accent (var(--accent-warning) = #f0b840) for the selection halo.
const ACCENT = '#f0b840'
const DASH = [8, 6]

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
const CommittedConnector = memo(function CommittedConnector({ pts, stroke, strokeWidth, head, selected, label, dash, bg }) {
    const points = pts.split(',').map(Number)
    const hasHead = head !== 'none'
    const box = labelBox(points, label)
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
            {hasHead ? (
                <Arrow
                    points={points}
                    stroke={stroke} fill={stroke} strokeWidth={strokeWidth}
                    pointerLength={10} pointerWidth={10}
                    dash={dash ? DASH : undefined}
                    lineCap="round" lineJoin="round"
                    listening={false} perfectDrawEnabled={false}
                />
            ) : (
                <Line
                    points={points}
                    stroke={stroke} strokeWidth={strokeWidth}
                    dash={dash ? DASH : undefined}
                    lineCap="round" lineJoin="round"
                    listening={false} perfectDrawEnabled={false}
                />
            )}
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
                        selected={selectedIds.has(conn.id)}
                        label={typeof p.label === 'string' ? p.label : ''}
                        dash={!!p.dash}
                        bg={bg}
                    />
                )
            })}
        </Layer>
    )
})

export default ConnectorLayer
