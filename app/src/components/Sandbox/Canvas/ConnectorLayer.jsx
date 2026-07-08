import { Layer, Arrow, Line } from 'react-konva'
import { memo } from 'react'
import { connectorPoints } from '../connectors/geometry'

// Konva paints to <canvas>, which can't resolve CSS variables — use the concrete
// accent (var(--accent-warning) = #f0b840) for the selection halo.
const ACCENT = '#f0b840'

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
const CommittedConnector = memo(function CommittedConnector({ pts, stroke, strokeWidth, head, selected }) {
    const points = pts.split(',').map(Number)
    const hasHead = head !== 'none'
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
                    lineCap="round" lineJoin="round"
                    listening={false} perfectDrawEnabled={false}
                />
            ) : (
                <Line
                    points={points}
                    stroke={stroke} strokeWidth={strokeWidth}
                    lineCap="round" lineJoin="round"
                    listening={false} perfectDrawEnabled={false}
                />
            )}
        </>
    )
})

const ConnectorLayer = memo(function ConnectorLayer({ connectorItems, byId, selectedIds }) {
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
                    />
                )
            })}
        </Layer>
    )
})

export default ConnectorLayer
