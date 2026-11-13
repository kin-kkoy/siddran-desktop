/**
 * Ink tools and their presets (spec §10.1).
 *
 * The drawing flyout holds six tools. The pen and the highlighter each carry
 * three presets (a thickness plus a colour). Smart drawing draws with the pen's
 * active preset. Presets persist per user in localStorage, not in the board.
 */

// Tools that live in the drawing flyout. While one is active the flyout shows.
export const INK_TOOLS = ['pen', 'highlighter', 'smart', 'eraser', 'precisionEraser', 'lasso']
export const isInkTool = (t) => INK_TOOLS.includes(t)
// Tools that lay down ink (and so draw with a preset).
export const DRAWS_INK = new Set(['pen', 'highlighter', 'smart'])
// Which preset set a drawing tool uses.
export const presetGroupFor = (tool) => (tool === 'highlighter' ? 'highlighter' : 'pen')

/** The dock's shape colours. Cream first: the default border (decided 2026-11-12). */
export const SHAPE_COLORS = ['#e2ddf5', '#f0b840', '#5a9cf0', '#e05c5c', '#52c47a', '#000000']
export const PEN_COLORS = ['#e2ddf5', '#f0b840', '#5a9cf0', '#e05c5c', '#52c47a', '#b083f0', '#ffffff', '#000000']
export const HIGHLIGHTER_COLORS = ['#f5e050', '#7ee07e', '#ff8fc8', '#6cc8ff', '#ffa94d', '#c9a0ff']

export const HIGHLIGHTER_OPACITY = { min: 0.1, max: 0.6, default: 0.35 }

export const DEFAULT_INK = {
    pen: {
        active: 1,
        presets: [
            { size: 3, color: '#5a9cf0', smoothing: 0.6 },
            { size: 6, color: '#e2ddf5', smoothing: 0.6 },   // today's pen: 6 px cream
            { size: 12, color: '#e05c5c', smoothing: 0.6 },
        ],
    },
    highlighter: {
        active: 0,
        presets: [
            { size: 16, color: '#f5e050', smoothing: 0.7, opacity: 0.35 },
            { size: 24, color: '#7ee07e', smoothing: 0.7, opacity: 0.35 },
            { size: 36, color: '#ff8fc8', smoothing: 0.7, opacity: 0.35 },
        ],
    },
}

export const INK_KEY = 'siddran_sandbox_ink_v1'
const OLD_BRUSH_KEY = 'cinder_sandbox_brush_v3'

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

function cleanPreset(p, fallback) {
    const out = { ...fallback }
    if (p && typeof p === 'object') {
        if (Number.isFinite(p.size)) out.size = clamp(p.size, 1, 64)
        if (typeof p.color === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(p.color)) out.color = p.color
        if (Number.isFinite(p.smoothing)) out.smoothing = clamp(p.smoothing, 0, 1)
        if (fallback.opacity != null && Number.isFinite(p.opacity)) out.opacity = clamp(p.opacity, HIGHLIGHTER_OPACITY.min, HIGHLIGHTER_OPACITY.max)
    }
    return out
}

/** Merge whatever was stored over the defaults, dropping anything malformed. */
export function normalizeInk(raw) {
    const out = {}
    for (const g of ['pen', 'highlighter']) {
        const def = DEFAULT_INK[g]
        const src = raw?.[g]
        out[g] = {
            active: Number.isInteger(src?.active) ? clamp(src.active, 0, 2) : def.active,
            presets: def.presets.map((d, i) => cleanPreset(src?.presets?.[i], d)),
        }
    }
    return out
}

/**
 * Load the presets. First run after the upgrade: the old single brush (size +
 * smoothing) becomes the pen's middle preset, so a dialled-in pen survives.
 */
export function loadInk(storage = globalThis.localStorage) {
    try {
        const raw = storage?.getItem(INK_KEY)
        if (raw) return normalizeInk(JSON.parse(raw))
        const old = storage?.getItem(OLD_BRUSH_KEY)
        if (old) {
            const b = JSON.parse(old)
            const ink = normalizeInk(null)
            ink.pen.presets[1] = cleanPreset({ ...ink.pen.presets[1], size: b.size, smoothing: b.smoothing }, ink.pen.presets[1])
            return ink
        }
    } catch { /* private window or bad JSON — defaults */ }
    return normalizeInk(null)
}

export function saveInk(ink, storage = globalThis.localStorage) {
    try { storage?.setItem(INK_KEY, JSON.stringify(ink)) } catch { /* not remembered */ }
}

/** '#rrggbb' + 0–1 opacity → '#rrggbbaa'. An existing alpha is replaced. */
export function withAlpha(hex, opacity) {
    const base = /^#[0-9a-f]{6}/i.exec(hex || '')?.[0] || '#ffffff'
    const a = Math.round(clamp(opacity, 0, 1) * 255)
    return a >= 255 ? base : `${base}${a.toString(16).padStart(2, '0')}`
}

// The smoothing slider (0–1) maps onto perfect-freehand `streamline`, but its
// top end must stay BELOW 1.0 — at streamline 1.0 the low-pass never converges,
// so the stroke chases the cursor forever.
export const MAX_STREAMLINE = 0.8

/**
 * What a new stroke is drawn with: its fill colour and the perfect-freehand
 * options stored on the stroke. The highlighter is translucent, has a constant
 * width (no pressure) and flat, untapered ends.
 */
export function strokeStyleFor(tool, preset, { inputType = 'mouse', tiltMult = 1, minDist } = {}) {
    const streamline = (preset.smoothing ?? 0.6) * MAX_STREAMLINE
    if (tool === 'highlighter') {
        return {
            color: withAlpha(preset.color, preset.opacity ?? HIGHLIGHTER_OPACITY.default),
            highlighter: true,
            options: {
                size: preset.size, streamline, inputType, minDist,
                thinning: 0, simulatePressure: false,
                start: { taper: 0, cap: false }, end: { taper: 0, cap: false },
            },
        }
    }
    return {
        color: preset.color,
        highlighter: false,
        options: { size: preset.size * tiltMult, streamline, inputType, minDist },
    }
}
