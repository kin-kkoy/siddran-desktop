/**
 * Starter templates (spec §14, a first slice of the catalogue). Each is a pure
 * builder: `build({ newId, style })` returns ordinary Sandbox items laid out
 * from (0, 0). The page offsets them to the middle of the view and inserts them
 * as ONE undo step, so a template is just a quick way to place things you could
 * have drawn by hand — nothing about it is special once it's on the board.
 *
 * Only existing item shapes are used (frames are shapes of kind 'frame',
 * stickies kind 'sticky'), so every template round-trips through siddran-cli
 * and opens, minus the new kinds' outlines, in an older build.
 */
import { parseFlow, flowToItems } from '../flow/flowText'
import { framePayload } from '../frames/frames'
import { STICKY_DEFAULT } from '../text/textStyle'

const Y = '#FFE45C', LY = '#FFF7B2', G = '#8FD98A', R = '#FF7A6B', B = '#7FB8FF', SKY = '#A9D8FF'
const P = '#C39BFF', O = '#FFB84D', PK = '#FF9EC4', T = '#6FD6C4', GR = '#C9CDD4'

function maker({ newId, style = {} }) {
    const stroke = style.stroke || '#e2ddf5'
    const items = []
    const add = (it) => { const full = { id: newId(), rotation: 0, ...it }; items.push(full); return full }
    return {
        items,
        frame: (x, y, w, h, title, fill) => add({ type: 'shape', x, y, w, h, payload: framePayload(title, fill) }),
        sticky: (x, y, text = '', fill = STICKY_DEFAULT, w = 192, h = 192) =>
            add({ type: 'shape', x, y, w, h, payload: { kind: 'sticky', fill, text, textAlign: 'center' } }),
        text: (x, y, w, text, fontSize = 18, extra = {}) =>
            add({ type: 'text', x, y, w, h: Math.round(fontSize * 1.6 + 14), payload: { text, fontSize, color: stroke, ...extra } }),
        shape: (x, y, w, h, kind, text = '', extra = {}) =>
            add({
                type: 'shape', x, y, w, h,
                payload: { kind, fill: 'transparent', stroke, strokeWidth: 2, radius: kind === 'roundedRect' ? 10 : 0, text, textAlign: 'center', textColor: stroke, fontSize: 16, ...extra },
            }),
        line: (x, y, w, h, extra = {}) =>
            add({ type: 'shape', x, y, w, h, payload: { kind: 'line', stroke, strokeWidth: 2, points: [0, 0, w, h], baseW: Math.max(1, w), baseH: Math.max(1, h), ...extra } }),
        connect: (a, aSide, b, bSide, extra = {}) =>
            add({ type: 'connector', x: 0, y: 0, w: 0, h: 0, payload: { from: { itemId: a.id, side: aSide }, to: { itemId: b.id, side: bSide }, routing: 'elbow', head: 'arrow', stroke, strokeWidth: 2, ...extra } }),
    }
}

// A row of titled frames with optional stickies in each.
function columns(m, titles, { x = 0, y = 80, w = 320, h = 560, gap = 32, fills = [], notes = [] } = {}) {
    titles.forEach((t, i) => {
        const fx = x + i * (w + gap)
        m.frame(fx, y, w, h, t)
        ;(notes[i] || []).forEach((n, j) => m.sticky(fx + (w - 192) / 2, y + 24 + j * 212, n, fills[i] || Y))
    })
}

export const TEMPLATES = [
    {
        id: 'flowchart', name: 'Flowchart', category: 'Diagrams',
        description: 'Start, steps, a decision and a loop back.',
        build(ctx) {
            const text = 'A([Start]) --> B[Gather what you need] --> C{Ready?}\nC -->|yes| D[Do the work] --> E([Done])\nC -->|no| F[Fix what is missing] --> B'
            const { shapes, connectors } = flowToItems(parseFlow(text).graph, { origin: { x: 0, y: 80 }, style: ctx.style ? { stroke: ctx.style.stroke, text: ctx.style.stroke, fill: 'transparent', font: 16 } : undefined, newId: ctx.newId })
            // Start/end read better as the flowchart terminator.
            for (const s of shapes) if (/^(Start|Done)$/.test(s.payload.text)) s.payload = { ...s.payload, kind: 'terminator' }
            const m = maker(ctx)
            m.text(0, 0, 360, 'Flowchart', 36, { bold: true })
            return [...m.items, ...shapes, ...connectors]
        },
    },
    {
        id: 'mindmap', name: 'Mind map', category: 'Brainstorming',
        description: 'A central idea with six branches.',
        build(ctx) {
            const m = maker(ctx)
            const c = m.shape(420, 300, 220, 110, 'ellipse', 'Central idea', { fontSize: 20, bold: true })
            const spots = [
                [80, 120, 'e'], [80, 300, 'e'], [80, 480, 'e'],
                [800, 120, 'w'], [800, 300, 'w'], [800, 480, 'w'],
            ]
            spots.forEach(([x, y, side], i) => {
                const b = m.shape(x, y, 180, 64, 'roundedRect', `Branch ${i + 1}`)
                m.connect(c, side === 'e' ? 'w' : 'e', b, side, { routing: 'curved', head: 'none' })
            })
            m.text(0, 0, 360, 'Mind map', 36, { bold: true })
            return m.items
        },
    },
    {
        id: 'kanban', name: 'Kanban board', category: 'Agile',
        description: 'To do, doing, done — move the stickies along.',
        build(ctx) {
            const m = maker(ctx)
            m.text(0, 0, 400, 'Kanban board', 36, { bold: true })
            columns(m, ['To do', 'Doing', 'Done'], { fills: [Y, SKY, G], notes: [['A task', 'Another task'], ['In progress'], ['Finished']] })
            return m.items
        },
    },
    {
        id: 'retro', name: 'Quick retrospective', category: 'Meetings',
        description: 'What went well, what didn’t, what we’ll change.',
        build(ctx) {
            const m = maker(ctx)
            m.text(0, 0, 500, 'Retrospective', 36, { bold: true })
            columns(m, ['What went well', 'What didn’t', 'Action items'], { fills: [G, R, B], notes: [['…'], ['…'], ['…']] })
            return m.items
        },
    },
    {
        id: 'swot', name: 'SWOT analysis', category: 'Strategy',
        description: 'Strengths, weaknesses, opportunities, threats.',
        build(ctx) {
            const m = maker(ctx)
            m.text(0, 0, 400, 'SWOT analysis', 36, { bold: true })
            const cells = [['Strengths', G], ['Weaknesses', R], ['Opportunities', SKY], ['Threats', O]]
            cells.forEach(([t, fill], i) => {
                const x = (i % 2) * 452, y = 80 + Math.floor(i / 2) * 372
                m.frame(x, y, 420, 340, t)
                m.sticky(x + 24, y + 24, '', fill)
            })
            return m.items
        },
    },
    {
        id: 'matrix', name: 'Priority matrix', category: 'Strategy',
        description: 'Urgent × important: do, schedule, delegate, drop.',
        build(ctx) {
            const m = maker(ctx)
            m.text(0, 0, 420, 'Priority matrix', 36, { bold: true })
            const cells = [['Do first', 'Urgent · Important'], ['Schedule', 'Not urgent · Important'], ['Delegate', 'Urgent · Not important'], ['Drop', 'Not urgent · Not important']]
            cells.forEach(([t, sub], i) => {
                const x = (i % 2) * 432, y = 80 + Math.floor(i / 2) * 332
                m.frame(x, y, 400, 300, t)
                m.text(x + 16, y + 16, 368, sub, 13, { color: '#9e9bb5' })
            })
            return m.items
        },
    },
    {
        id: 'bmc', name: 'Business Model Canvas', category: 'Strategy',
        description: 'The nine building blocks of a business model.',
        build(ctx) {
            const m = maker(ctx)
            m.text(0, 0, 600, 'Business Model Canvas', 36, { bold: true })
            const u = 220, top = 80, H = 520, g = 12
            const col = (i) => i * (u + g)
            m.frame(col(0), top, u, H, 'Key partners')
            m.frame(col(1), top, u, (H - g) / 2, 'Key activities')
            m.frame(col(1), top + (H + g) / 2, u, (H - g) / 2, 'Key resources')
            m.frame(col(2), top, u, H, 'Value propositions')
            m.frame(col(3), top, u, (H - g) / 2, 'Customer relationships')
            m.frame(col(3), top + (H + g) / 2, u, (H - g) / 2, 'Channels')
            m.frame(col(4), top, u, H, 'Customer segments')
            const half = (5 * u + 4 * g - g) / 2
            m.frame(0, top + H + g, half, 220, 'Cost structure')
            m.frame(half + g, top + H + g, half, 220, 'Revenue streams')
            return m.items
        },
    },
    {
        id: 'storymap', name: 'User story map', category: 'Agile',
        description: 'Activities across, stories down, sliced into releases.',
        build(ctx) {
            const m = maker(ctx)
            m.text(0, 0, 420, 'User story map', 36, { bold: true })
            const acts = ['Discover', 'Sign up', 'Use it', 'Get help']
            acts.forEach((a, i) => {
                const x = 160 + i * 212
                m.sticky(x, 80, a, B, 192, 120)
                m.sticky(x, 300, 'Story', LY, 192, 120)
                m.sticky(x, 560, 'Story', LY, 192, 120)
            })
            m.text(0, 300, 140, 'Release 1', 16, { bold: true })
            m.text(0, 560, 140, 'Release 2', 16, { bold: true })
            m.line(0, 260, 1000, 0, { lineStyle: 'dashed' })
            m.line(0, 520, 1000, 0, { lineStyle: 'dashed' })
            return m.items
        },
    },
    {
        id: 'week', name: 'Weekly planner', category: 'Planning',
        description: 'A frame for each day, plus notes.',
        build(ctx) {
            const m = maker(ctx)
            m.text(0, 0, 400, 'This week', 36, { bold: true })
            const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Notes']
            days.forEach((d, i) => {
                const x = (i % 4) * 292, y = 80 + Math.floor(i / 4) * 412
                m.frame(x, y, 272, 380, d)
            })
            return m.items
        },
    },
    {
        id: 'brainstorm', name: 'Brainstorm', category: 'Brainstorming',
        description: 'A question in the middle, ideas all around.',
        build(ctx) {
            const m = maker(ctx)
            m.frame(0, 60, 1100, 700, 'Ideas')
            m.shape(400, 340, 300, 100, 'roundedRect', 'What should we try?', { fontSize: 22, bold: true })
            const fills = [Y, PK, SKY, G, P, O, T, GR]
            const spots = [[40, 110], [260, 120], [760, 110], [880, 300], [60, 360], [80, 540], [420, 520], [800, 520]]
            spots.forEach(([x, y], i) => m.sticky(x, y, '', fills[i % fills.length], 180, 180))
            return m.items
        },
    },
]

export const findTemplate = (id) => TEMPLATES.find(t => t.id === id)
