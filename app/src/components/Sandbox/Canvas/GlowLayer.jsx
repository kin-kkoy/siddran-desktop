import { Layer, Line, Rect, Group } from 'react-konva'
import { memo } from 'react'
import { connectorPoints } from '../connectors/geometry'
import { getItemBounds } from '../selection/itemBounds'

// Connection outlines: select a box (or several) and its links, plus the boxes
// at their other ends, get a soft cyan glow — a ring just outside each box and
// a halo under each link. Select a link and its two end boxes get it. What you
// selected keeps its usual handles / halo instead, so it isn't glowed too.
//
// ONE layer, drawn from item bounds and connector points, under the links and
// shapes: the ring sits outside each box's edge, so the box itself (Konva or a
// DOM card above) never covers it. Sizes are in screen px (÷ zoom), so the glow
// keeps its width at any zoom.

const GAP_PX = 4        // between a box's edge and its ring
const RING_PX = 8       // the ring's width
const HALO_PX = 7       // how far a link's halo reaches past the line, each side

// Konva can't resolve CSS variables: a light theme is told by its black outline
// colour (SettingsContext: --outline-contrast is #000 on light, #fff on dark).
function glowColour() {
    try {
        const c = getComputedStyle(document.documentElement).getPropertyValue('--outline-contrast').trim().toLowerCase()
        if (c === '#000000' || c === '#000') return { colour: '#0d7f86', opacity: 0.4 }
    } catch { /* no DOM — keep the dark look */ }
    return { colour: '#22d3ee', opacity: 0.42 }
}

const GlowLayer = memo(function GlowLayer({ glow, byId, zoom, only }) {
    if (!glow) return null
    const { colour, opacity } = glowColour()
    const z = zoom || 1
    const keep = (id) => !only || only.has(id)
    const out = GAP_PX / z + RING_PX / z / 2
    return (
        <Layer listening={false}>
            {[...glow.links].filter(keep).map(id => {
                const conn = byId.get(id)
                const pts = conn && connectorPoints(conn, byId)
                if (!pts) return null
                const w = (conn.payload?.strokeWidth || 2) + (2 * HALO_PX) / z
                return <Line key={`l${id}`} points={pts} stroke={colour} strokeWidth={w} opacity={opacity}
                    lineCap="round" lineJoin="round" listening={false} perfectDrawEnabled={false} />
            })}
            {[...glow.nodes].filter(keep).map(id => {
                const it = byId.get(id)
                if (!it || it.type === 'connector') return null
                const b = getItemBounds(it)
                return (
                    <Group key={`n${id}`} x={b.x} y={b.y} rotation={b.rotation} listening={false}>
                        <Rect x={-out} y={-out} width={b.w + 2 * out} height={b.h + 2 * out}
                            cornerRadius={6 / z + out} stroke={colour} strokeWidth={RING_PX / z} opacity={opacity}
                            listening={false} perfectDrawEnabled={false} />
                    </Group>
                )
            })}
        </Layer>
    )
})

export default GlowLayer
