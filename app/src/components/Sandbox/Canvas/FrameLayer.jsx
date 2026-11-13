import { Layer, Group, Rect, Text } from 'react-konva'
import { memo } from 'react'
import { FRAME_TITLE_PX, FRAME_TITLE_GAP, FRAME_DEFAULT_FILL } from '../frames/frames'

/**
 * Frames paint first — beneath connectors and shapes — so everything placed on
 * a frame sits on top of it. The title is sized in screen pixels (divided by
 * zoom) so it stays readable when zoomed far out, like a map label.
 */
const CommittedFrame = memo(function CommittedFrame({ item, zoom, hideTitle, cut = '', clip }) {
    const p = item.payload || {}
    const fs = FRAME_TITLE_PX / zoom
    return (
        <Group listening={false} {...(clip ? { clipX: clip.x, clipY: clip.y, clipWidth: clip.w, clipHeight: clip.h } : null)}>
            <Rect
                x={item.x} y={item.y} width={item.w} height={item.h}
                fill={p.fill || FRAME_DEFAULT_FILL}
                stroke={p.stroke || 'rgba(160,160,190,0.35)'} strokeWidth={(p.strokeWidth || 1) / zoom}
                cornerRadius={2 / zoom}
                perfectDrawEnabled={false}
            />
            {!hideTitle && (
                <Text
                    x={item.x} y={item.y - fs - FRAME_TITLE_GAP / zoom}
                    width={Math.max(item.w, 40 / zoom)}
                    // "Plan · 2 cropped" while it crops things attached to it.
                    text={cut ? `${p.title || 'Frame'}  ·  ${cut}` : (p.title || 'Frame')}
                    fontSize={fs}
                    fontFamily="Inter, system-ui, sans-serif"
                    fontStyle="600"
                    fill="#a9a6c4"
                    wrap="none" ellipsis
                    perfectDrawEnabled={false}
                />
            )}
        </Group>
    )
})

const FrameLayer = memo(function FrameLayer({ frameItems, zoom, editingFrameId, clips, cutLabels }) {
    if (!frameItems.length) return null
    return (
        <Layer listening={false}>
            {frameItems.map(f => (
                <CommittedFrame key={f.id} item={f} zoom={zoom} hideTitle={f.id === editingFrameId}
                    cut={cutLabels?.get(f.id) || ''} clip={clips?.get(f.id)} />
            ))}
        </Layer>
    )
})

export default FrameLayer
