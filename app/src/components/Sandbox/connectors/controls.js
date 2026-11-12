// The choices a link offers, shared by the floating bar and the diagram editor
// so the two always show the same options the same way.

export const LINK_PALETTE = [
    '#e2ddf5', '#ffffff', '#9e9bb5', '#1f2430', '#f0b840', '#ffb84d', '#ff7a6b', '#e05c5c',
    '#ff9ec4', '#c39bff', '#5a9cf0', '#a9d8ff', '#6fd6c4', '#52c47a', '#d6e86b', '#000000',
]
export const ROUTINGS = [
    { v: 'straight', label: '╱', title: 'Straight' },
    { v: 'elbow', label: '⌐', title: 'Elbow' },
    { v: 'curved', label: '∿', title: 'Curved' },
]
export const LINE_GLYPH = { solid: '━', dashed: '┅', dotted: '┈' }
export const HEAD_GLYPH = { none: '—', arrow: '▶', open: '›', triangle: '▷', circle: '●', diamond: '◇', bar: '┃' }
