import { Layer, Group, Shape, Rect, Ellipse, Line, Arrow, Text, Image as KonvaImage } from 'react-konva'
import { memo, useCallback } from 'react'
import { drawStrokePath } from './strokeOutline'
import { useKonvaImage } from '../../../hooks/useKonvaImage'
import { resolveImageUrl } from '../../../utils/imageUpload'
import { renderShape, isLineKind } from '../shapes/registry'
import { dashFor } from '../connectors/lineStyle'
import { taperedArrowPolygon } from '../connectors/heads'
import { konvaTextProps, fitFontSize, contrastText, STICKY_DEFAULT } from '../text/textStyle'

/**
 * ONE Konva layer for ALL committed graphics (strokes + shapes + images),
 * painted in z_index order — so bring-to-front / send-to-back works across
 * every graphic type. (Cards are DOM and always composite above; that's the
 * documented per-layer limit.) In-progress previews live in ActiveLayer above
 * this one, so this heavy layer only re-renders when items change — not on every
 * drawing frame.
 *
 * Rotation is about each item's CENTRE (offset = half-size, position = centre),
 * matching getItemBounds and the transform overlay. Strokes scale the cached
 * outline by w/baseW so the polygon is never mutated; everything sets
 * listening={false} (selection uses the manual world-space hit-test).
 */

function outlineExtent(flat) {
    let w = 0, h = 0
    for (let i = 0; i < flat.length; i += 2) {
        if (flat[i] > w) w = flat[i]
        if (flat[i + 1] > h) h = flat[i + 1]
    }
    return { w, h }
}

const CommittedStroke = memo(function CommittedStroke({ item }) {
    const sceneFunc = useCallback((ctx, shape) => {
        ctx.beginPath()
        drawStrokePath(ctx, item.payload.flatOutline)
        ctx.fillStrokeShape(shape)
    }, [item.payload.flatOutline])

    const p = item.payload
    const ext = (p.baseW == null || p.baseH == null) ? outlineExtent(p.flatOutline) : null
    const baseW = p.baseW ?? ext.w ?? 1
    const baseH = p.baseH ?? ext.h ?? 1
    const renderW = item.w ?? baseW
    const renderH = item.h ?? baseH

    return (
        <Shape
            x={item.x + renderW / 2}
            y={item.y + renderH / 2}
            offsetX={baseW / 2}
            offsetY={baseH / 2}
            scaleX={baseW ? renderW / baseW : 1}
            scaleY={baseH ? renderH / baseH : 1}
            rotation={item.rotation || 0}
            sceneFunc={sceneFunc}
            fill={item.payload.color}
            listening={false}
            perfectDrawEnabled={false}
        />
    )
})

// Lighten (amt > 0) or darken (amt < 0) a #rrggbb[aa] colour, keeping alpha.
function shade(hex, amt) {
    const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex || '')
    if (!m) return hex
    const n = parseInt(m[1], 16)
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
        const t = amt > 0 ? v + (255 - v) * amt : v * (1 + amt)
        return Math.max(0, Math.min(255, Math.round(t))).toString(16).padStart(2, '0')
    })
    return `#${ch.join('')}${m[2] || ''}`
}

const centerProps = (item) => {
    const w = item.w ?? 0
    const h = item.h ?? 0
    return { x: item.x + w / 2, y: item.y + h / 2, rotation: item.rotation || 0, w, h }
}

const CommittedShape = memo(function CommittedShape({ item, hideText = false }) {
    const p = item.payload || {}
    const kind = p.kind || 'rect'
    const { x, y, rotation, w, h } = centerProps(item)
    const aw = Math.abs(w), ah = Math.abs(h)

    // Text label — shared by all filled (non-line) shapes. Hidden while this
    // shape is being edited so the live DOM editor doesn't double up with the
    // committed Konva text (which looked like a shadow/glitch).
    const isSticky = kind === 'sticky'
    const pad = isSticky ? Math.max(12, Math.min(aw, ah) * 0.12) : 8
    const fontSize = p.fontSize || (isSticky ? fitFontSize(p.text, aw - pad * 2, ah - pad * 2, p, 28, 10) : 16)
    const textNode = (p.text && !hideText && !isLineKind(kind)) ? (
        <Text
            x={0} y={0} width={aw} height={ah}
            text={p.text}
            {...konvaTextProps(p)}
            fontSize={fontSize}
            fill={p.textColor || (isSticky ? contrastText(p.fill || STICKY_DEFAULT) : '#ffffff')}
            padding={pad}
            wrap="word"
            ellipsis={isSticky}
            listening={false} perfectDrawEnabled={false}
        />
    ) : null

    // ── sticky note: looks like paper, not a box — a gentle top-to-bottom
    // shade, the faint adhesive strip along the top, a lifted shadow, and the
    // bottom-right corner folded over. No border (spec §7.3).
    if (isSticky) {
        const base = p.fill && p.fill !== 'transparent' ? p.fill : STICKY_DEFAULT
        const fold = Math.min(aw, ah) * 0.12
        return (
            <Group x={x} y={y} offsetX={aw / 2} offsetY={ah / 2} rotation={rotation}>
                <Shape
                    sceneFunc={(ctx, shape) => {
                        ctx.beginPath()
                        ctx.moveTo(0, 0); ctx.lineTo(aw, 0); ctx.lineTo(aw, ah - fold)
                        ctx.lineTo(aw - fold, ah); ctx.lineTo(0, ah); ctx.closePath()
                        ctx.fillStrokeShape(shape)
                    }}
                    fillLinearGradientStartPoint={{ x: 0, y: 0 }}
                    fillLinearGradientEndPoint={{ x: 0, y: ah }}
                    fillLinearGradientColorStops={[0, shade(base, 0.10), 1, shade(base, -0.04)]}
                    shadowColor="#000" shadowOpacity={0.32} shadowBlur={12} shadowOffsetX={1} shadowOffsetY={5}
                    listening={false} perfectDrawEnabled={false}
                />
                {/* adhesive strip */}
                <Rect x={0} y={0} width={aw} height={Math.max(6, ah * 0.1)} fill="#000" opacity={0.05} listening={false} perfectDrawEnabled={false} />
                {/* the folded-over corner */}
                <Line points={[aw - fold, ah, aw, ah - fold, aw - fold, ah - fold]} closed
                    fill={shade(base, -0.18)} shadowColor="#000" shadowOpacity={0.25} shadowBlur={3} shadowOffsetX={-1} shadowOffsetY={-1}
                    listening={false} perfectDrawEnabled={false} />
                {textNode}
            </Group>
        )
    }

    // ── fast-path: ellipse (native Konva <Ellipse>; the registry has no path
    // for it). Lost once in the sticky rework (816e3ae), which made every
    // ellipse on the board invisible. ──
    if (kind === 'ellipse') {
        return (
            <Group x={x} y={y} offsetX={aw / 2} offsetY={ah / 2} rotation={rotation}>
                <Ellipse
                    x={aw / 2} y={ah / 2} radiusX={aw / 2} radiusY={ah / 2}
                    fill={p.fill && p.fill !== 'transparent' ? p.fill : undefined}
                    stroke={p.stroke} strokeWidth={p.strokeWidth} dash={dashFor(p)} lineCap="round"
                    listening={false} perfectDrawEnabled={false}
                />
                {textNode}
            </Group>
        )
    }

    // ── tapered arrow: a filled polygon between the two stored endpoints ──
    if (kind === 'taperedArrow') {
        const baseW = p.baseW || w || 1, baseH = p.baseH || h || 1
        const pts = p.points || [0, 0, baseW, baseH]
        const sx = w / baseW, sy = h / baseH
        // Scale the endpoints, not the polygon, so the arrow keeps its thickness.
        const poly = taperedArrowPolygon({ x: pts[0] * sx, y: pts[1] * sy }, { x: pts[2] * sx, y: pts[3] * sy }, p.strokeWidth || 2)
        if (!poly) return null
        return (
            <Group x={x} y={y} offsetX={aw / 2} offsetY={ah / 2} rotation={rotation}>
                <Line points={poly} closed fill={p.stroke} stroke={p.stroke} strokeWidth={1.5}
                    lineJoin="round" listening={false} perfectDrawEnabled={false} />
            </Group>
        )
    }

    // ── fast-path: line-type shapes (line, arrow, elbowArrow, divider) ──
    if (isLineKind(kind)) {
        const baseW = p.baseW || w || 1
        const baseH = p.baseH || h || 1
        const isArrow = kind === 'arrow' || kind === 'elbowArrow'
        const Comp = isArrow ? Arrow : Line
        return (
            <Comp
                x={x} y={y}
                offsetX={baseW / 2} offsetY={baseH / 2}
                scaleX={baseW ? w / baseW : 1}
                scaleY={baseH ? h / baseH : 1}
                rotation={rotation}
                points={p.points}
                // A line bent from its middle handle: a smooth curve through the
                // middle point (selection/lineHandles.js). Older builds draw it
                // as a two-segment line, which is still the right shape roughly.
                tension={p.curved && p.points?.length >= 6 ? 0.5 : 0}
                stroke={p.stroke} strokeWidth={p.strokeWidth} dash={dashFor(p)}
                fill={isArrow ? p.stroke : undefined}
                pointerLength={isArrow ? 10 : undefined}
                pointerWidth={isArrow ? 10 : undefined}
                lineCap="round" lineJoin="round"
                listening={false} perfectDrawEnabled={false}
            />
        )
    }

    // ── fast-path: rect / roundedRect (native Konva <Rect>) ─────────────
    if (kind === 'rect' || kind === 'roundedRect') {
        return (
            <Group x={x} y={y} offsetX={aw / 2} offsetY={ah / 2} rotation={rotation}>
                <Rect
                    x={0} y={0} width={aw} height={ah}
                    cornerRadius={p.radius || (kind === 'roundedRect' ? 12 : 0)}
                    fill={p.fill && p.fill !== 'transparent' ? p.fill : undefined}
                    stroke={p.stroke} strokeWidth={p.strokeWidth} dash={dashFor(p)} lineCap="round"
                    listening={false} perfectDrawEnabled={false}
                />
                {textNode}
            </Group>
        )
    }

    // ── registry-driven sceneFunc for all other polygon shapes ──────────
    return (
        <Group x={x} y={y} offsetX={aw / 2} offsetY={ah / 2} rotation={rotation}>
            <Shape
                x={0} y={0}
                sceneFunc={(ctx, shape) => {
                    ctx.beginPath()
                    renderShape(ctx, kind, aw, ah, p.radius || 0)
                    ctx.fillStrokeShape(shape)
                }}
                fill={p.fill && p.fill !== 'transparent' ? p.fill : undefined}
                stroke={p.stroke} strokeWidth={p.strokeWidth} dash={dashFor(p)} lineCap="round" lineJoin="round"
                listening={false} perfectDrawEnabled={false}
            />
            {textNode}
        </Group>
    )
})

const CommittedImage = memo(function CommittedImage({ item }) {
    const p = item.payload || {}
    // payload.url is the R2 path; p.src is the legacy base64 fallback for items not
    // yet migrated. resolveImageUrl passes data:/blob:/http through untouched.
    const img = useKonvaImage(resolveImageUrl(p.url ?? p.src))
    const { x, y, rotation, w, h } = centerProps(item)
    if (!img) return null
    return (
        <KonvaImage
            image={img}
            x={x} y={y} width={Math.abs(w)} height={Math.abs(h)}
            offsetX={Math.abs(w) / 2} offsetY={Math.abs(h) / 2}
            rotation={rotation}
            listening={false} perfectDrawEnabled={false}
        />
    )
})

const GraphicsLayer = memo(function GraphicsLayer({ graphicItems, editingShapeId = null }) {
    return (
        // listening=false: every child already opts out, and selection uses the
        // manual world-space hit-test — so Konva skips building/redrawing the hit
        // canvas, ~halving paint cost when panning a dense board.
        <Layer listening={false}>
            {graphicItems.map(item => {
                if (item.type === 'image') return <CommittedImage key={item.id} item={item} />
                if (item.type === 'shape') return <CommittedShape key={item.id} item={item} hideText={item.id === editingShapeId} />
                return <CommittedStroke key={item.id} item={item} />
            })}
        </Layer>
    )
})

export default GraphicsLayer
