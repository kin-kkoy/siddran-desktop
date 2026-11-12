/**
 * Line style shared by shape borders and connectors. `lineStyle` is the new key;
 * a connector's older `dash: true` (still written by siddran-cli) means dashed.
 * The pattern scales with the stroke width so a thick dotted line still reads
 * as dots (spec R9.13: consistent regardless of the shape's size).
 */
export const LINE_STYLES = ['solid', 'dashed', 'dotted']

export function lineStyleOf(p = {}) {
    if (p.lineStyle && LINE_STYLES.includes(p.lineStyle)) return p.lineStyle
    return p.dash ? 'dashed' : 'solid'
}

/** Konva `dash` array, or undefined for solid. */
export function dashFor(p = {}) {
    const w = Math.max(1, p.strokeWidth || 2)
    const s = lineStyleOf(p)
    if (s === 'dashed') return [w * 4, w * 3]
    if (s === 'dotted') return [0.01, w * 2.2]
    return undefined
}

/** SVG stroke-dasharray, or null for solid. */
export function svgDashFor(p = {}) {
    const d = dashFor(p)
    return d ? d.map(v => Math.round(v * 100) / 100).join(' ') : null
}
