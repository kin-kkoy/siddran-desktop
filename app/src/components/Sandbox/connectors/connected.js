/**
 * What a selection touches through its links — shared by the board's
 * connection outlines (Canvas/GlowLayer.jsx) and the node editor's focus
 * (flow/NodeEditor.jsx), so the two always agree.
 *
 * `links` is any list of { id, from, to } (from/to: node ids, or null for a
 * free end). `nodes` / `selLinks` are the selected node ids and link ids.
 *
 * A selected node brings in every link on it and the node at each link's
 * other end; a selected link brings in its two ends. The result includes the
 * selection itself.
 */
export function connectedTo(links, nodes, selLinks = []) {
    const selN = nodes instanceof Set ? nodes : new Set(nodes)
    const selL = selLinks instanceof Set ? selLinks : new Set(selLinks)
    const outNodes = new Set(selN), outLinks = new Set(selL)
    for (const l of links) {
        const on = selL.has(l.id) || (l.from != null && selN.has(l.from)) || (l.to != null && selN.has(l.to))
        if (!on) continue
        outLinks.add(l.id)
        if (l.from != null) outNodes.add(l.from)
        if (l.to != null) outNodes.add(l.to)
    }
    return { nodes: outNodes, links: outLinks }
}

/** A board connector as a link: its id and the items its two ends sit on. */
export const boardLink = (conn) => ({ id: conn.id, from: conn.payload?.from?.itemId ?? null, to: conn.payload?.to?.itemId ?? null })

/**
 * What glows for this selection: { nodes, links } minus the selection itself;
 * null when nothing does. Only ONE selected item glows its neighbours (a click
 * on a box or a link): selecting a whole diagram or the board would light up
 * everything and say nothing.
 */
export function glowFor(items, selectedIds) {
    if (selectedIds?.size !== 1) return null
    const conns = items.filter(it => it.type === 'connector')
    if (!conns.length) return null
    const selNodes = [], selLinks = []
    for (const it of items) {
        if (!selectedIds.has(it.id)) continue
        if (it.type === 'connector') selLinks.push(it.id); else selNodes.push(it.id)
    }
    const { nodes, links } = connectedTo(conns.map(boardLink), selNodes, selLinks)
    for (const id of selectedIds) { nodes.delete(id); links.delete(id) }
    if (!nodes.size && !links.size) return null
    return { nodes, links }
}
