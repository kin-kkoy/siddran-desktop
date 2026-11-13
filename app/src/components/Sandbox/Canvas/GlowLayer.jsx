import { Layer, Shape } from 'react-konva'
import { memo, useEffect, useRef } from 'react'
import { connectorPoints } from '../connectors/geometry'
import { renderShape } from '../shapes/registry'
import { getItemBounds } from '../selection/itemBounds'

// Connection outlines: click a box and its links, plus the boxes at their other
// ends, get a second, cyan outline. Click a link and its two end boxes get it.
//
// The outline hugs each box's own border (its real shape: rounded corners,
// ellipse, diamond…), with no gap, and runs along each link as a band. It is
// ONE outline, not layers:
//   - everything is drawn at full strength on this layer's own canvas, and
//     the canvas as a whole is faded (CSS opacity), so where a link's band
//     meets a box's band the two merge instead of darkening each other;
//   - each box's inside is then cut out (destination-out), so a band stops
//     exactly at a box's border and never shows through a box without a fill.
// The layer sits under the links and shapes, so their own lines draw on top.
// Widths are in board units, in proportion to each item's line width, so the
// outline zooms with the board like the shape it outlines.

const BAND = 1.5        // the outline's width past the item's own line, × that line's width
const OPACITY = 0.55
const CARD_RADIUS = 10  // DOM cards and widgets: their CSS corner radius
// Items without a border of their own (cards, widgets, borderless shapes)
// count as the default 2.
const lineWidth = (it) => Math.max(Number(it.payload?.strokeWidth) || 0, 2)

// Konva can't resolve CSS variables: a light theme is told by its black outline
// colour (SettingsContext: --outline-contrast is #000 on light, #fff on dark).
function glowColour() {
    try {
        const c = getComputedStyle(document.documentElement).getPropertyValue('--outline-contrast').trim().toLowerCase()
        if (c === '#000000' || c === '#000') return '#0d7f86'
    } catch { /* no DOM — keep the dark look */ }
    return '#22d3ee'
}

function roundRect(c, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2))
    c.moveTo(r, 0); c.lineTo(w - r, 0); c.arcTo(w, 0, w, r, r); c.lineTo(w, h - r); c.arcTo(w, h, w - r, h, r)
    c.lineTo(r, h); c.arcTo(0, h, 0, h - r, r); c.lineTo(0, r); c.arcTo(0, 0, r, 0, r); c.closePath()
}

// A box's outline, in its own frame (rotated about its centre, as drawn on the board).
function traceBox(c, it) {
    const b = getItemBounds(it)
    const w = Math.abs(b.w), h = Math.abs(b.h)
    c.translate(b.x + w / 2, b.y + h / 2)
    if (b.rotation) c.rotate((b.rotation * Math.PI) / 180)
    c.translate(-w / 2, -h / 2)
    c.beginPath()
    const p = it.payload || {}
    if (it.type !== 'shape') { roundRect(c, w, h, CARD_RADIUS); return }
    if (p.kind === 'ellipse') { c.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); return }
    if (p.kind === 'rect' || p.kind === 'roundedRect' || !renderShape(c, p.kind, w, h, p.radius || 0)) {
        roundRect(c, w, h, p.radius || (p.kind === 'roundedRect' ? 12 : 0))
    }
}

const GlowLayer = memo(function GlowLayer({ glow, byId, only, cutIds }) {
    const layerRef = useRef(null)
    // Fade the canvas as a whole, so overlapping bands merge (see above).
    useEffect(() => {
        const el = layerRef.current?.getCanvas?.()?._canvas
        if (el) el.style.opacity = String(OPACITY)
    })
    if (!glow) return null
    const keep = (id) => !only || only.has(id)
    const links = [...glow.links].filter(keep).map(id => byId.get(id)).filter(Boolean)
    const boxes = [...glow.nodes].filter(keep).map(id => byId.get(id)).filter(it => it && it.type !== 'connector')
    // Cut out the inside of every box a band touches: the glowing ones and the
    // selected one the links start from.
    const cuts = [...boxes, ...[...(cutIds || [])].map(id => byId.get(id)).filter(it => it && it.type !== 'connector')]
    const colour = glowColour()

    const sceneFunc = (kctx) => {
        const c = kctx._context
        c.save()
        c.strokeStyle = colour
        c.lineCap = 'round'
        c.lineJoin = 'round'
        for (const conn of links) {
            const pts = connectorPoints(conn, byId)
            if (!pts || pts.length < 4) continue
            const lw = lineWidth(conn)
            c.lineWidth = lw + 2 * BAND * lw
            c.beginPath()
            c.moveTo(pts[0], pts[1])
            for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1])
            c.stroke()
        }
        for (const it of boxes) {
            const lw = lineWidth(it)
            c.save()
            traceBox(c, it)
            // Centred on the border: half under the item's own line, the band
            // outside it, and the inner half cut away below.
            c.lineWidth = lw + 2 * BAND * lw
            c.stroke()
            c.restore()
        }
        c.globalCompositeOperation = 'destination-out'
        c.fillStyle = '#000'
        for (const it of cuts) {
            c.save()
            traceBox(c, it)
            c.fill()
            c.restore()
        }
        c.restore()
    }

    return (
        <Layer ref={layerRef} name="sb-glow" listening={false}>
            <Shape sceneFunc={sceneFunc} listening={false} perfectDrawEnabled={false} />
        </Layer>
    )
})

export default GlowLayer
