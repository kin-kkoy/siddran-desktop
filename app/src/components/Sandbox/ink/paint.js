/**
 * The paint bucket: click something to recolour it with the bucket's colour.
 *
 *  - a box shape or a frame → its fill ('transparent' empties it)
 *  - a sticky → its paper colour (a sticky can't be emptied)
 *  - a line / arrow shape, or a connector → its line colour
 *  - ink → its colour; a highlight keeps its own see-through-ness
 *
 * Returns the new payload, or null when the click changes nothing (images,
 * locked items, "no fill" on something that can't be empty).
 */
import { isLineKind } from '../shapes/registry'
import { withAlpha } from './presets'

const NONE = 'transparent'

function alphaOf(hex) {
    const m = /^#[0-9a-f]{6}([0-9a-f]{2})$/i.exec(hex || '')
    return m ? parseInt(m[1], 16) / 255 : 1
}

export function paintPayload(item, color) {
    const p = item?.payload || {}
    if (!item || p.locked || !color) return null
    const none = color === NONE
    if (item.type === 'stroke') {
        if (none) return null
        return { ...p, color: p.highlighter ? withAlpha(color, alphaOf(p.color)) : color }
    }
    if (item.type === 'connector') return none ? null : { ...p, stroke: color }
    if (item.type !== 'shape') return null
    const kind = p.kind
    if (isLineKind(kind)) return none ? null : { ...p, stroke: color }
    if (kind === 'sticky' && none) return null
    return { ...p, fill: color }
}
