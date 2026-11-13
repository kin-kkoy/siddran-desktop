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
// DOM card above) never covers it. Sizes are in board units, in proportion to
// the outlined item's own line width — so the glow zooms with the board, like
// the shape it outlines.

const GAP = 1.5         // between a box's edge and its ring, × the box's line width
const RING = 3          // the ring's width, × the box's line width
const HALO = 3.5        // how far a link's halo reaches past the line, each side, × its width
// Items without a border of their own (cards, widgets, borderless shapes)
// count as the default 2.
const lineWidth = (it) => Math.max(Number(it.payload?.strokeWidth) || 0, 2)

// Konva can't resolve CSS variables: a light theme is told by its black outline
// colour (SettingsContext: --outline-contrast is #000 on light, #fff on dark).
function glowColour() {
    try {
        const c = getComputedStyle(document.documentElement).getPropertyValue('--outline-contrast').trim().toLowerCase()
        if (c === '#000000' || c === '#000') return { colour: '#0d7f86', opacity: 0.4 }
    } catch { /* no DOM — keep the dark look */ }
    return { colour: '#22d3ee', opacity: 0.42 }
}

const GlowLayer = memo(function GlowLayer({ glow, byId, only }) {
    if (!glow) return null
    const { colour, opacity } = glowColour()
    const keep = (id) => !only || only.has(id)
    return (
        <Layer listening={false}>
            {[...glow.links].filter(keep).map(id => {
                const conn = byId.get(id)
                const pts = conn && connectorPoints(conn, byId)
                if (!pts) return null
                const lw = lineWidth(conn)
                const w = lw + 2 * HALO * lw
                return <Line key={`l${id}`} points={pts} stroke={colour} strokeWidth={w} opacity={opacity}
                    lineCap="round" lineJoin="round" listening={false} perfectDrawEnabled={false} />
            })}
            {[...glow.nodes].filter(keep).map(id => {
                const it = byId.get(id)
                if (!it || it.type === 'connector') return null
                const b = getItemBounds(it)
                const lw = lineWidth(it), ring = RING * lw
                const out = GAP * lw + ring / 2
                return (
                    <Group key={`n${id}`} x={b.x} y={b.y} rotation={b.rotation} listening={false}>
                        <Rect x={-out} y={-out} width={b.w + 2 * out} height={b.h + 2 * out}
                            cornerRadius={3 * lw + out} stroke={colour} strokeWidth={ring} opacity={opacity}
                            listening={false} perfectDrawEnabled={false} />
                    </Group>
                )
            })}
        </Layer>
    )
})

export default GlowLayer
