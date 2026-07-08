/**
 * Z-order helpers. Items carry a numeric `z_index`; render buckets sort by it.
 * Each op rebuilds a dense ordering of ALL item ids, moves the selected ones,
 * then re-assigns `z_index = position`. Returns only the changed `{id,z_index}`
 * patches so the caller can route them through one history transaction.
 *
 * Note: this orders within each render layer — DOM cards always composite above
 * Konva graphics (a structural constraint), so a card can't be sent behind a
 * stroke. Within a layer, ordering is exact.
 */

function currentOrder(items) {
    return items
        .map((it, i) => ({ id: it.id, z: it.z_index ?? 0, i }))
        .sort((a, b) => a.z - b.z || a.i - b.i)
        .map(x => x.id)
}

export function reorder(items, selectedIds, op) {
    const sel = selectedIds
    const order = currentOrder(items)
    let next

    if (op === 'front') {
        next = [...order.filter(id => !sel.has(id)), ...order.filter(id => sel.has(id))]
    } else if (op === 'back') {
        next = [...order.filter(id => sel.has(id)), ...order.filter(id => !sel.has(id))]
    } else if (op === 'forward') {
        next = order.slice()
        for (let i = next.length - 2; i >= 0; i--) {
            if (sel.has(next[i]) && !sel.has(next[i + 1])) {
                const t = next[i]; next[i] = next[i + 1]; next[i + 1] = t
            }
        }
    } else if (op === 'backward') {
        next = order.slice()
        for (let i = 1; i < next.length; i++) {
            if (sel.has(next[i]) && !sel.has(next[i - 1])) {
                const t = next[i]; next[i] = next[i - 1]; next[i - 1] = t
            }
        }
    } else {
        return []
    }

    const byId = new Map(items.map(it => [it.id, it]))
    const patches = []
    next.forEach((id, idx) => {
        const it = byId.get(id)
        if ((it?.z_index ?? 0) !== idx) patches.push({ id, z_index: idx })
    })
    return patches
}

/** Sort a bucket of items for rendering (low z first → painted underneath). */
export function sortByZ(items) {
    return items
        .map((it, i) => ({ it, i }))
        .sort((a, b) => (a.it.z_index ?? 0) - (b.it.z_index ?? 0) || a.i - b.i)
        .map(x => x.it)
}
