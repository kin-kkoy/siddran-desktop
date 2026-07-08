import { Layer, Group, Shape, Rect, Ellipse, Line, Arrow, Text, Image as KonvaImage } from 'react-konva'
import { memo, useCallback } from 'react'
import { drawStrokePath } from './strokeOutline'
import { useKonvaImage } from '../../../hooks/useKonvaImage'
import { resolveImageUrl } from '../../../utils/imageUpload'
import { renderShape, isLineKind } from '../shapes/registry'

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
    const textNode = (p.text && !hideText && !isLineKind(kind)) ? (
        <Text
            x={0} y={0} width={aw} height={ah}
            text={p.text}
            align={p.textAlign || 'center'}
            verticalAlign="middle"
            fontSize={p.fontSize || 16}
            fontFamily="Inter, system-ui, sans-serif"
            fontStyle={p.bold ? 'bold' : 'normal'}
            fill={p.textColor || '#ffffff'}
            padding={8}
            listening={false} perfectDrawEnabled={false}
        />
    ) : null

    // ── fast-path: ellipse ───────────────────────────────────────────────
    if (kind === 'ellipse') {
        return (
            <Group x={x} y={y} offsetX={aw / 2} offsetY={ah / 2} rotation={rotation}>
                <Ellipse
                    x={aw / 2} y={ah / 2} radiusX={aw / 2} radiusY={ah / 2}
                    fill={p.fill && p.fill !== 'transparent' ? p.fill : undefined}
                    stroke={p.stroke} strokeWidth={p.strokeWidth}
                    listening={false} perfectDrawEnabled={false}
                />
                {textNode}
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
                stroke={p.stroke} strokeWidth={p.strokeWidth}
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
                    stroke={p.stroke} strokeWidth={p.strokeWidth}
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
                stroke={p.stroke} strokeWidth={p.strokeWidth}
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
