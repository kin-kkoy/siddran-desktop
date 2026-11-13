/**
 * Slides (spec §11.8, §13.9). A slide is its own thing to the user — made
 * from the Insert menu, numbered "Slide 1, 2…", sized for a display — but on
 * disk it is a frame with `payload.slide: true` (no new item type: frames
 * already clip, carry what's on them, and the CLI and older builds know them).
 * Only slides are in the deck; a plain frame can be converted either way.
 *
 * Optional slide payload fields (absent = old behaviour):
 *   - `slide`       (true)   — this frame is a slide.
 *   - `slideOrder`  (number) — position in the deck. Slides without one follow
 *     the ordered ones, in reading order (rows top to bottom, then left to right).
 *   - `slideHidden` (true)   — skipped when presenting; still on the board.
 *
 * Reordering never moves a slide on the canvas (spec R11.11).
 */
import { isFrame, framePayload, nextFrameTitle } from '../frames/frames'
import { isFormat } from '../formats/formats'
import { itemAABB } from '../selection/hitTest'

export const CARD_TYPES = new Set(['note', 'task', 'text', 'pdf'])

const hasOrder = (f) => Number.isFinite(f.payload?.slideOrder)

/**
 * Reading order: frames whose tops lie within half the row's first frame's
 * height of it share a row; rows go top to bottom, each left to right.
 */
export function readingOrder(frames) {
    const byY = [...frames].sort((a, b) => a.y - b.y || a.x - b.x)
    const rows = []
    for (const f of byY) {
        const row = rows[rows.length - 1]
        if (row && f.y < row.top + row.h / 2) row.frames.push(f)
        else rows.push({ top: f.y, h: Math.max(1, f.h), frames: [f] })
    }
    return rows.flatMap(r => r.frames.sort((a, b) => a.x - b.x || a.y - b.y))
}

export const isSlide = (it) => isFrame(it) && it.payload?.slide === true

/** Every slide, in deck order (hidden ones included). */
export function deckOrder(items) {
    const frames = items.filter(isSlide)
    const ordered = frames.filter(hasOrder)
    const rest = frames.filter(f => !hasOrder(f))
    // Ties (two frames with the same number, e.g. after a merge) fall back to
    // reading order so the deck is stable.
    const reading = new Map(readingOrder(frames).map((f, i) => [f.id, i]))
    ordered.sort((a, b) => a.payload.slideOrder - b.payload.slideOrder || reading.get(a.id) - reading.get(b.id))
    return [...ordered, ...readingOrder(rest)]
}

export const isHiddenSlide = (f) => f.payload?.slideHidden === true

/** The frames a presentation walks through. */
export function presentedFrames(items) {
    return deckOrder(items).filter(f => !isHiddenSlide(f))
}

/**
 * Move frame `id` to position `to` (0-based, in deck order). Returns
 * `[{ id, slideOrder }]` for every frame whose number changes — numbering
 * all of them 1…n, so the order is explicit from then on.
 */
export function reorderPatches(items, id, to) {
    const deck = deckOrder(items)
    const from = deck.findIndex(f => f.id === id)
    if (from < 0) return []
    const next = [...deck]
    const [moved] = next.splice(from, 1)
    next.splice(Math.max(0, Math.min(to, next.length)), 0, moved)
    const out = []
    next.forEach((f, i) => { if (f.payload?.slideOrder !== i + 1) out.push({ id: f.id, slideOrder: i + 1 }) })
    return out
}

/**
 * The viewport that shows `frame` as large as fits in a `w`×`h` screen,
 * centred (letterboxed). `pad` is screen px kept free on every side. The
 * zoom stays inside the board's limits (useSandboxCanvas clamps to 0.1–8),
 * so the centring is computed for the zoom actually used.
 */
export function fitFrameViewport(frame, w, h, pad = 0, minZoom = 0.1, maxZoom = 8) {
    const fw = Math.max(1, frame.w), fh = Math.max(1, frame.h)
    const zoom = Math.max(minZoom, Math.min(maxZoom, (w - pad * 2) / fw, (h - pad * 2) / fh))
    return {
        x: Math.round(w / 2 - (frame.x + fw / 2) * zoom),
        y: Math.round(h / 2 - (frame.y + fh / 2) * zoom),
        zoom,
    }
}

/**
 * Where "Present from here" starts: the selected frame if one is selected
 * (a hidden one starts at the next shown slide), else the frame under the
 * view's centre (the smallest, for nested frames), else the first slide.
 * Returns an index into `shown`.
 */
export function startIndex(items, shown, { selectedIds, center } = {}) {
    if (!shown.length) return -1
    const deck = deckOrder(items)
    const pick = (id) => {
        const at = shown.findIndex(f => f.id === id)
        if (at >= 0) return at
        // A hidden frame: the next shown one after it in deck order.
        const d = deck.findIndex(f => f.id === id)
        for (let i = d + 1; i < deck.length; i++) {
            const s = shown.findIndex(f => f.id === deck[i].id)
            if (s >= 0) return s
        }
        return -1
    }
    for (const id of selectedIds || []) {
        const it = items.find(i => i.id === id)
        if (it && isSlide(it)) { const at = pick(id); if (at >= 0) return at }
    }
    if (center) {
        const under = deck
            .filter(f => center.x >= f.x && center.x <= f.x + f.w && center.y >= f.y && center.y <= f.y + f.h)
            .sort((a, b) => a.w * a.h - b.w * b.h)
        for (const f of under) { const at = pick(f.id); if (at >= 0) return at }
    }
    return 0
}

/** Index after a navigation key, clamped to the deck. */
export function stepIndex(index, delta, count) {
    if (count <= 0) return -1
    return Math.max(0, Math.min(count - 1, index + delta))
}

/** Items that meet `frame`, in paint order: frames, links, graphics, then DOM (cards/widgets). */
export function frameContents(frame, items) {
    const fx = frame.x, fy = frame.y, fx2 = frame.x + frame.w, fy2 = frame.y + frame.h
    const meets = (it) => {
        if (it.type === 'connector') return true   // filtered by its points when drawn
        const b = itemAABB(it)
        return b.x < fx2 && b.x + b.w > fx && b.y < fy2 && b.y + b.h > fy
    }
    const rank = (it) => isFrame(it) ? 0 : it.type === 'connector' ? 1 : (CARD_TYPES.has(it.type) || isFormat(it)) ? 3 : 2
    return items
        .filter(it => it.id !== frame.id && meets(it))
        .sort((a, b) => rank(a) - rank(b) || (a.z_index ?? 0) - (b.z_index ?? 0))
}

// ── making slides ──

export const DEFAULT_SLIDE_SIZE = { w: 1920, h: 1080 }
const SLIDE_GAP = 120

/** Next default slide title: "Slide 1", "Slide 2", … */
export function nextSlideTitle(items) {
    let n = 0
    for (const it of items) {
        const m = isSlide(it) && /^Slide (\d+)$/.exec(it.payload?.title || '')
        if (m) n = Math.max(n, Number(m[1]))
    }
    return `Slide ${n + 1}`
}

export function slidePayload(title) {
    return { ...framePayload(title), slide: true }
}

/** The size a new slide gets: the deck's last slide's, else `fallback` (the laptop display). */
export function newSlideSize(items, fallback = DEFAULT_SLIDE_SIZE) {
    const deck = deckOrder(items)
    const last = deck[deck.length - 1]
    return last ? { w: last.w, h: last.h } : { w: fallback.w, h: fallback.h }
}

const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

/**
 * Where a new slide goes: to the right of `after` (default: the deck's last
 * slide), past any frame in the way; the first slide goes centred on `center`.
 */
export function newSlideRect(items, { w, h }, { after = null, center = { x: 0, y: 0 } } = {}) {
    const deck = deckOrder(items)
    const ref = after ? items.find(i => i.id === after) : deck[deck.length - 1]
    if (!ref) return { x: Math.round(center.x - w / 2), y: Math.round(center.y - h / 2), w, h }
    const frames = items.filter(isFrame)
    const r = { x: ref.x + ref.w + SLIDE_GAP, y: ref.y, w, h }
    for (let guard = 0; guard < 500; guard++) {
        const hit = frames.find(f => overlaps(r, f))
        if (!hit) break
        r.x = hit.x + hit.w + SLIDE_GAP
    }
    return { x: Math.round(r.x), y: Math.round(r.y), w, h }
}

/**
 * A plain frame turned into a slide, or back. Default titles follow the
 * kind ("Frame 2" ⇄ "Slide 3"); a title the user typed stays. Returns the new payload.
 */
export function convertPayload(item, items) {
    const p = item.payload || {}
    const title = p.title || ''
    if (isSlide(item)) {
        const rest = { ...p }
        delete rest.slide; delete rest.slideOrder; delete rest.slideHidden
        return { ...rest, title: !title || /^Slide \d+$/.test(title) ? nextFrameTitle(items) : title }
    }
    return { ...p, slide: true, title: !title || /^Frame \d+$/.test(title) ? nextSlideTitle(items) : title }
}

/**
 * Titles for duplicated frames and slides: a default title ("Frame 1",
 * "Slide 2") gets the next free number, one per copy, so copies never share a
 * name. Returns Map(originalId → title); typed titles are left alone.
 */
export function duplicateTitles(originals, items) {
    const out = new Map()
    let pool = items
    for (const it of originals) {
        if (!isFrame(it)) continue
        const t = it.payload?.title || ''
        const slide = isSlide(it)
        if (!(slide ? /^Slide \d+$/ : /^Frame \d+$/).test(t) && t) continue
        const title = slide ? nextSlideTitle(pool) : nextFrameTitle(pool)
        out.set(it.id, title)
        pool = [...pool, { ...it, id: `dup-${it.id}`, payload: { ...it.payload, title } }]
    }
    return out
}

// ── display presets ──

/**
 * Size choices for a slide: each display ("Display 1 (laptop)", …) at its
 * native resolution, then the common shapes. `displays` comes from the shell
 * (src-tauri slides.rs `list_displays`), laptop first.
 */
export function sizePresets(displays = []) {
    const out = displays.map((d, i) => ({
        key: `display-${i + 1}`,
        label: `Display ${i + 1}${d.kind ? ` (${d.kind})` : ''}`,
        w: d.width, h: d.height,
    }))
    const seen = new Set(out.map(p => `${p.w}x${p.h}`))
    for (const p of [
        { key: '16:9', label: 'Widescreen 16:9', w: 1920, h: 1080 },
        { key: '4:3', label: 'Standard 4:3', w: 1440, h: 1080 },
    ]) if (!seen.has(`${p.w}x${p.h}`) || !out.length) out.push(p)
    return out
}

/** The size new slides default to: Display 1 (the laptop), else 1920×1080. */
export function defaultSlideSize(displays = []) {
    const d = displays[0]
    return d ? { w: d.width, h: d.height } : { ...DEFAULT_SLIDE_SIZE }
}
