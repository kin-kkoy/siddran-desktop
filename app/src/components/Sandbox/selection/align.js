/**
 * Alignment & distribution for a multi-selection. Pure: each function takes the
 * selected items and returns position patches `[{ id, x?, y? }]` to feed through
 * the history-wrapped updateItem in one transaction.
 *
 * Everything works on each item's axis-aligned bbox (itemAABB, covers rotation).
 * Because moving item.x/item.y translates the whole item — and thus its AABB —
 * by the same delta, a patch is just `item.x + (targetEdge - aabbEdge)`.
 */
import { itemAABB } from './hitTest'
import { unionAABB } from './snapping'

// op → how to derive the target value and the moving item's reference value.
const X_OPS = {
    left: (sel) => sel.x,
    centerX: (sel) => sel.x + sel.w / 2,
    right: (sel) => sel.x + sel.w,
}
const Y_OPS = {
    top: (sel) => sel.y,
    middle: (sel) => sel.y + sel.h / 2,
    bottom: (sel) => sel.y + sel.h,
}
const X_REF = {
    left: (b) => b.x,
    centerX: (b) => b.x + b.w / 2,
    right: (b) => b.x + b.w,
}
const Y_REF = {
    top: (b) => b.y,
    middle: (b) => b.y + b.h / 2,
    bottom: (b) => b.y + b.h,
}

export function alignPatches(items, op) {
    if (!items || items.length < 2) return []
    const sel = unionAABB(items)
    if (!sel) return []

    if (op in X_OPS) {
        const target = X_OPS[op](sel)
        return items.map(it => ({ id: it.id, x: it.x + (target - X_REF[op](itemAABB(it))) }))
    }
    if (op in Y_OPS) {
        const target = Y_OPS[op](sel)
        return items.map(it => ({ id: it.id, y: it.y + (target - Y_REF[op](itemAABB(it))) }))
    }
    if (op === 'distH') return distribute(items, 'x')
    if (op === 'distV') return distribute(items, 'y')
    return []
}

// Even gaps between item CENTRES along one axis; the two extreme items stay put.
function distribute(items, axis) {
    if (items.length < 3) return []
    const w = axis === 'x' ? 'w' : 'h'
    const rows = items.map(it => {
        const b = itemAABB(it)
        return { it, b, center: b[axis] + b[w] / 2 }
    }).sort((a, b) => a.center - b.center)

    const first = rows[0].center
    const last = rows[rows.length - 1].center
    const step = (last - first) / (rows.length - 1)

    const patches = []
    for (let i = 1; i < rows.length - 1; i++) {
        const r = rows[i]
        const targetCenter = first + step * i
        const delta = targetCenter - r.center
        patches.push({ id: r.it.id, [axis]: r.it[axis] + delta })
    }
    return patches
}
