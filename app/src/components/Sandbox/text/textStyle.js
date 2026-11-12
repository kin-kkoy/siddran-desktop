/**
 * Typography shared by every place Sandbox text is drawn: the Konva label inside
 * a shape, the DOM text card, the live shape editor, and the note SVG.
 *
 * All fields are optional payload keys, so a board written by an older build (or
 * by siddran-cli, which only knows `text` / `fontSize` / `color` / `textAlign`)
 * still reads exactly as it did:
 *
 *   fontFamily    'sans' | 'serif' | 'mono' | 'hand'     (default 'sans')
 *   bold, italic, underline, strike                      booleans
 *   textAlign     'left' | 'center' | 'right' | 'justify'
 *   verticalAlign 'top' | 'middle' | 'bottom'            (shapes only)
 *   lineHeight    number, 1.0–2.0
 *   bg            highlight colour behind a text card, or absent
 *
 * Fonts are system stacks — nothing is bundled — so they work offline.
 */

export const FONT_FAMILIES = {
    sans: { label: 'Sans', css: 'Inter, system-ui, sans-serif' },
    serif: { label: 'Serif', css: 'Lora, Georgia, "Noto Serif", "DejaVu Serif", serif' },
    mono: { label: 'Mono', css: '"JetBrains Mono", "Fira Code", "DejaVu Sans Mono", monospace' },
    hand: { label: 'Hand', css: 'Caveat, "Comic Neue", "Comic Sans MS", "Segoe Print", cursive' },
}

export const FONT_SIZES = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64, 72, 96, 144]
export const MIN_FONT = 6
export const MAX_FONT = 288

/** Six named styles (spec §8.4), scaled down to Sandbox sizes. */
export const TEXT_PRESETS = {
    title: { label: 'Title', fontSize: 48, bold: true },
    heading: { label: 'Heading', fontSize: 32, bold: true },
    subheading: { label: 'Subheading', fontSize: 24, bold: true },
    body: { label: 'Body', fontSize: 18, bold: false },
    caption: { label: 'Caption', fontSize: 13, bold: false },
    code: { label: 'Code', fontSize: 15, bold: false, fontFamily: 'mono' },
}

export const fontCss = (p) => (FONT_FAMILIES[p?.fontFamily] || FONT_FAMILIES.sans).css

/** Next size up/down the preset ladder (Ctrl+Shift+> / <). */
export function stepFontSize(size, dir) {
    const s = Number(size) || 16
    if (dir > 0) return FONT_SIZES.find(v => v > s) ?? Math.min(MAX_FONT, s + 24)
    const lower = [...FONT_SIZES].reverse().find(v => v < s)
    return lower ?? Math.max(MIN_FONT, s - 2)
}

export const clampFont = (n) => Math.max(MIN_FONT, Math.min(MAX_FONT, Math.round(Number(n) || 16)))

/** Konva <Text> props for a payload. */
export function konvaTextProps(p) {
    const style = [p.italic && 'italic', p.bold && 'bold'].filter(Boolean).join(' ') || 'normal'
    const deco = [p.underline && 'underline', p.strike && 'line-through'].filter(Boolean).join(' ')
    return {
        fontFamily: fontCss(p),
        fontStyle: style,
        textDecoration: deco || undefined,
        align: p.textAlign === 'justify' ? 'justify' : (p.textAlign || 'center'),
        verticalAlign: p.verticalAlign || 'middle',
        lineHeight: p.lineHeight || 1.2,
    }
}

/** CSS for a DOM text surface (text card, editors). `size` is already zoomed when needed. */
export function cssTextStyle(p, size) {
    const deco = [p.underline && 'underline', p.strike && 'line-through'].filter(Boolean).join(' ')
    return {
        fontSize: size,
        fontFamily: fontCss(p),
        fontWeight: p.bold ? 700 : 400,
        fontStyle: p.italic ? 'italic' : 'normal',
        textDecoration: deco || 'none',
        textAlign: p.textAlign || 'left',
        lineHeight: p.lineHeight || 1.35,
    }
}

/** Relative luminance → readable text colour on a fill (WCAG-ish). */
export function contrastText(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
    if (!m) return '#1f2430'
    const n = parseInt(m[1], 16)
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
        const c = v / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    const L = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
    return L > 0.4 ? '#1f2430' : '#f5f5f7'
}

// ── fitting text into a box (sticky auto-size) ──────────────────────────────
let measureCtx = null
function measurer() {
    if (measureCtx) return measureCtx
    try {
        measureCtx = document.createElement('canvas').getContext('2d')
    } catch { measureCtx = null }
    return measureCtx
}

/** Lines `text` wraps to inside `width` (word wrap, like Konva's). */
function wrappedLineCount(ctx, text, width) {
    let lines = 0
    for (const para of String(text).split('\n')) {
        let line = ''
        let count = 1
        for (const word of para.split(/\s+/).filter(Boolean)) {
            const next = line ? `${line} ${word}` : word
            if (ctx.measureText(next).width <= width) { line = next; continue }
            if (line) count++
            // A word wider than the box breaks across as many lines as it needs.
            const ww = ctx.measureText(word).width
            if (ww > width) { count += Math.ceil(ww / width) - 1; line = '' } else line = word
        }
        lines += count
    }
    return lines
}

const fitCache = new Map()

/**
 * Largest font size in [min, max] at which `text` fits a w×h box (spec R9.3:
 * auto-shrink before overflowing). Cached — stickies re-render on every drag.
 */
export function fitFontSize(text, w, h, p = {}, max = 24, min = 10) {
    if (!text) return max
    const key = `${text}|${Math.round(w)}|${Math.round(h)}|${p.fontFamily}|${p.bold}|${p.italic}|${max}|${min}`
    const hit = fitCache.get(key)
    if (hit) return hit
    const ctx = measurer()
    if (!ctx) return max
    const lh = p.lineHeight || 1.2
    let size = max
    for (; size > min; size--) {
        ctx.font = `${p.italic ? 'italic ' : ''}${p.bold ? '700 ' : ''}${size}px ${fontCss(p)}`
        if (wrappedLineCount(ctx, text, w) * size * lh <= h) break
    }
    if (fitCache.size > 2000) fitCache.clear()
    fitCache.set(key, size)
    return size
}

export const STICKY_COLORS = [
    '#FFF7B2', '#FFE45C', '#FFB84D', '#FF7A6B', '#FF9EC4', '#C39BFF',
    '#D9CCFF', '#7FB8FF', '#A9D8FF', '#6FD6C4', '#8FD98A', '#C9CDD4',
]
export const STICKY_DEFAULT = '#FFE45C'
export const STICKY_SIZE = 192
