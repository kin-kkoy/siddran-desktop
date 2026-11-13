// Dev-only probes, loaded by main.jsx only when VITE_PERF_PROBE is set, so
// they never ship:
//   drag:<boardId>   — drag smoothness (below)
//   format:<boardId> — a scripted walk through a Format widget (runFormat; drives
//                      the plain list, which a Table widget no longer shows — use table:)
//   attach:<boardId> — sticky attachment, clipping and text size (runAttach)
//   frames:<boardId> — sticky attachment on frames (runFrames)
//   top:<boardId>    — things drawn on a widget, on the top canvas (runTop)
//   table:<boardId>  — the Table view: fields, cells, sort, filter, group (runTable)
//   grid:<boardId>   — Table selection, cell fonts, row/column drag, long tables (runGrid)
//   extras:<boardId> — formulas, totals, detail panel, paste, CSV import, attachments (runExtras)
//
// It opens a board, then drives drags with synthetic pointer events (headless
// Hyprland has no click/move dispatcher) and samples, per frame:
//   dt   — time between animation frames (16.7 ms = smooth at 60 Hz)
//   busy — from the frame's start until the main thread is free again
//          (rAF callbacks + React render + Konva draw), via a MessageChannel ping
// Results are POSTed as JSON to a local sink (VITE_PERF_SINK, default :8799).

const SINK = import.meta.env.VITE_PERF_SINK || 'http://127.0.0.1:8799/'
const spec = String(import.meta.env.VITE_PERF_PROBE || '')
const [, boardId] = spec.split(':')

const send = (name, data) => fetch(SINK, { method: 'POST', body: JSON.stringify({ name, data }) }).catch(() => {})
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
// A frame — or 50 ms, for a window that isn't on screen (no frames come then).
const frame = () => Promise.race([new Promise(r => requestAnimationFrame(r)), sleep(50)])
async function waitFor(fn, ms = 30000) {
    const t0 = performance.now()
    for (;;) {
        const v = fn()
        if (v) return v
        if (performance.now() - t0 > ms) return null
        await sleep(100)
    }
}
function go(path) {
    history.pushState({}, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
}
const ptr = (type, x, y, extra = {}) => new PointerEvent(type, {
    clientX: x, clientY: y, screenX: x, screenY: y, bubbles: true, cancelable: true, composed: true,
    pointerId: 1, pointerType: 'mouse', isPrimary: true, button: type === 'pointermove' ? -1 : 0,
    buttons: type === 'pointerup' ? 0 : 1, ...extra,
})
// Time spent inside Konva layer draws and inside every rAF callback, summed
// between samples (Konva draws in its own rAF, which the busy window misses).
const acc = { konva: 0, raf: 0 }
function instrument() {
    const L = window.Konva?.Layer?.prototype
    if (L && !L.__probe) {
        const orig = L.drawScene
        L.drawScene = function (...a) { const t = performance.now(); try { return orig.apply(this, a) } finally { acc.konva += performance.now() - t } }
        L.__probe = true
    }
    if (!window.__probeRaf) {
        const raf = window.requestAnimationFrame.bind(window)
        window.requestAnimationFrame = (cb) => raf((ts) => { const t = performance.now(); try { cb(ts) } finally { acc.raf += performance.now() - t } })
        window.__probeRaf = true
    }
}
const key = (k, opts = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...opts }))

// One drag: press `target` at (x, y), move along a circle for `frames` frames
// (one move per frame, like a 60 Hz mouse), release. Returns per-frame samples.
async function drag(target, x, y, frames = 180, radius = 160) {
    target.dispatchEvent(ptr('pointerdown', x, y))
    acc.konva = 0; acc.raf = 0
    const samples = []
    const ch = new MessageChannel()
    let last = performance.now()
    for (let i = 1; i <= frames; i++) {
        const ts = await frame()
        const start = performance.now()
        const a = (i / frames) * Math.PI * 2
        const px = x + Math.sin(a) * radius, py = y + (1 - Math.cos(a)) * radius * 0.5
        window.dispatchEvent(ptr('pointermove', px, py))
        // When does the main thread get free after this frame's work?
        const free = await new Promise(r => { ch.port1.onmessage = () => r(performance.now()); ch.port2.postMessage(0) })
        samples.push({ dt: ts - last, busy: free - start, konva: acc.konva, raf: acc.raf })
        acc.konva = 0; acc.raf = 0
        last = ts
    }
    window.dispatchEvent(ptr('pointerup', x, y))
    return samples
}

function stats(samples) {
    const dts = samples.slice(2).map(s => s.dt).sort((a, b) => a - b)
    const busy = samples.slice(2).map(s => s.busy).sort((a, b) => a - b)
    const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))]
    const r = (v) => Math.round(v * 10) / 10
    return {
        frames: dts.length,
        dt_median: r(q(dts, 0.5)), dt_p90: r(q(dts, 0.9)), dt_max: r(dts[dts.length - 1]),
        over20ms: dts.filter(d => d > 20).length, over33ms: dts.filter(d => d > 33).length,
        busy_median: r(q(busy, 0.5)), busy_p90: r(q(busy, 0.9)), busy_max: r(busy[busy.length - 1]),
        konva_median: r(q(samples.slice(2).map(s => s.konva).sort((a, b) => a - b), 0.5)),
        raf_median: r(q(samples.slice(2).map(s => s.raf).sort((a, b) => a - b), 0.5)),
    }
}

async function run() {
    await waitFor(() => document.querySelector('#root')?.children.length)
    await sleep(3000)
    go(`/sandboxes/${boardId}`)
    const stage = await waitFor(() => window.Konva?.stages?.find(s => s.container()?.isConnected))
    if (!stage) { send('error', 'no stage'); return }
    await sleep(1500)
    instrument()
    const container = stage.container().parentElement   // SandboxCanvas's root (native listeners)
    key('Escape')
    key('1')   // fit everything in view
    await sleep(800)
    const out = { env: { mode: import.meta.env.MODE, ua: navigator.userAgent, dpr: devicePixelRatio, w: innerWidth, h: innerHeight } }

    // Idle baseline: frames with nothing happening.
    {
        const s = []
        let last = performance.now()
        for (let i = 0; i < 90; i++) { const ts = await frame(); s.push({ dt: ts - last, busy: 0 }); last = ts }
        out.idle = stats(s)
    }

    // The items the board holds, to aim presses at a real shape.
    let items = []
    try { items = JSON.parse(localStorage.getItem(`cinder_sandbox_${boardId}`) || '{}').items || [] } catch { /* none */ }
    const rect = container.getBoundingClientRect()
    const toClient = (wx, wy) => ({ x: rect.left + stage.x() + wx * stage.scaleX(), y: rect.top + stage.y() + wy * stage.scaleY() })
    const shapes = items.filter(i => i.type === 'shape' && i.payload?.kind && !['frame', 'line', 'arrow', 'elbowArrow', 'divider'].includes(i.payload.kind) && !i.payload.locked)
        .sort((a, b) => (b.z_index ?? 0) - (a.z_index ?? 0))
    out.board = { items: items.length, shapes: shapes.length, zoom: Math.round(stage.scaleX() * 100) / 100 }

    for (let rep = 0; rep < 3; rep++) {
        // 1. Press-and-drag one unselected shape.
        const sh = shapes[rep % Math.max(1, shapes.length)]
        if (sh) {
            key('Escape'); await sleep(300)
            const c = toClient(sh.x + sh.w / 2, sh.y + sh.h / 2)
            const target = document.elementFromPoint(c.x, c.y) || container
            out[`one_${rep}`] = stats(await drag(target, c.x, c.y))
            await sleep(700)
            key('z', { ctrlKey: true }); await sleep(500)
        }
        // 2. Select everything and drag it by the selection box.
        key('Escape'); key('a', { ctrlKey: true }); await sleep(500)
        const move = document.querySelector('[data-sb-move="true"]')
        if (move) {
            const b = move.getBoundingClientRect()
            const at = { x: b.left + b.width / 2, y: b.top + b.height / 2 }
            const target = document.elementFromPoint(at.x, at.y) || move
            out[`all_${rep}`] = stats(await drag(target, at.x, at.y))
            await sleep(700)
            key('z', { ctrlKey: true }); await sleep(500)
        }
        key('Escape'); await sleep(500)
    }
    send('result', out)
    await sleep(500)
    send('done', true)
}

// ── format:<boardId> — a scripted walk through a Format widget, for headless
// screenshots: each `step` is posted, then the probe holds still for 3 s.
const setInput = (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
}
const enter = (el) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
const cached = () => { try { return JSON.parse(localStorage.getItem(`cinder_sandbox_${boardId}`) || '{}').items || [] } catch { return [] } }
const boxOf = (it) => it && { x: Math.round(it.x), y: Math.round(it.y), w: Math.round(it.w), h: Math.round(it.h), z: it.z_index }
async function step(name, data) { send('step', { name, ...data }); await sleep(Number(import.meta.env.VITE_PERF_STEP_MS ?? 3000)) }

async function runFormat() {
    await waitFor(() => document.querySelector('#root')?.children.length)
    await sleep(3000)
    go(`/sandboxes/${boardId}`)
    const stage = await waitFor(() => window.Konva?.stages?.find(s => s.container()?.isConnected))
    await sleep(1500)
    key('Escape')
    const before = cached().length
    document.querySelector('button[title="Media"]')?.click()
    await sleep(500)
    ;[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Table')?.click()
    await sleep(1000)
    // The widget this run inserted: the newest one (the Bag may hold others).
    const fmt = () => cached().filter(i => i.payload?.kind === 'format').sort((a, b) => (b.z_index ?? 0) - (a.z_index ?? 0))[0]
    const widget = () => document.querySelector(`[data-sb-id="${fmt()?.id}"]`)
    await step('inserted', { items: cached().length - before, format: fmt()?.payload, box: boxOf(fmt()) })

    const add = widget().querySelector('input[placeholder="+ Add a record"]')
    for (const t of ['Plan the week', 'Make the stock', 'Write the tracker']) { add.focus(); setInput(add, t); enter(add); await sleep(350) }
    widget().querySelectorAll('button[aria-label="Mark done"]')[1]?.click()
    await sleep(600)
    add.blur()
    await step('records', { records: fmt()?.payload?.records?.map(r => r.values) })

    // A text card dropped on the widget (above it), to ride along.
    const wr = widget().getBoundingClientRect()
    const konvaCanvas = stage.content.querySelector('canvas')
    key('t')
    await sleep(300)
    konvaCanvas.dispatchEvent(ptr('pointerdown', wr.left + 30, wr.bottom - 40))
    konvaCanvas.dispatchEvent(ptr('pointerup', wr.left + 30, wr.bottom - 40))
    await sleep(600)
    document.activeElement?.blur?.()
    key('Escape')
    await sleep(500)
    const text = cached().filter(i => i.type === 'text').sort((a, b) => (b.z_index ?? 0) - (a.z_index ?? 0))[0]
    const t0 = boxOf(text), f0 = boxOf(fmt())

    // Drag the widget by its title bar.
    const bar = widget().querySelector('header')
    const br = bar.getBoundingClientRect()
    const sx = br.left + 60, sy = br.top + br.height / 2
    bar.dispatchEvent(ptr('pointerdown', sx, sy))
    for (let i = 1; i <= 30; i++) { await frame(); window.dispatchEvent(ptr('pointermove', sx + i * 8, sy + i * 3)) }
    window.dispatchEvent(ptr('pointerup', sx + 240, sy + 90))
    await sleep(800)
    const t1 = boxOf(cached().find(i => i.id === text?.id)), f1 = boxOf(fmt())
    await step('moved', { widgetMoved: f1 && f0 && [f1.x - f0.x, f1.y - f0.y], textMoved: t1 && t0 && [t1.x - t0.x, t1.y - t0.y] })

    // Resize from the bottom-right handle (selected after the drag).
    const wr2 = widget().getBoundingClientRect()
    const se = [...document.querySelectorAll('svg rect')].find(r => r.style.cursor === 'nwse-resize' && r.getBoundingClientRect().top > wr2.top + wr2.height / 2)
    if (se) {
        const r = se.getBoundingClientRect(), x = r.left + 4, y = r.top + 4
        se.dispatchEvent(ptr('pointerdown', x, y))
        for (let i = 1; i <= 20; i++) { await frame(); window.dispatchEvent(ptr('pointermove', x + i * 6, y + i * 5)) }
        window.dispatchEvent(ptr('pointerup', x + 120, y + 100))
        await sleep(800)
    }
    await step('resized', { box: boxOf(fmt()), rotateKnob: [...document.querySelectorAll('svg circle')].some(c => c.style.cursor === 'grab') })

    // Full screen with Enter; Esc back.
    key('Enter')
    await sleep(800)
    await step('focus', { open: !!document.querySelector('[role="dialog"]') })
    key('Escape')
    await sleep(600)

    // Point it at the Bag's tasks, tick one, then back to own records.
    widget().querySelector('button[aria-label="Data source"]').click()
    await sleep(500)
    ;[...document.querySelectorAll('[data-sb-handle="true"] button')].find(b => b.textContent.includes('All tasks'))?.click()
    await sleep(1200)
    const firstTask = widget().querySelector('button[aria-label="Mark done"]')
    const taskTitle = firstTask?.parentElement?.querySelector('input')?.value
    firstTask?.click()
    await sleep(800)
    await step('linked', { source: fmt()?.payload?.source, rows: widget().querySelectorAll('input:not([placeholder^="+"])').length, ticked: taskTitle })

    widget().querySelector('button[aria-label="Data source"]').click()
    await sleep(500)
    // The menu's entry (portalled, data-sb-handle) — not another widget's "Own records" chip.
    ;[...document.querySelectorAll('[data-sb-handle="true"] button')].find(b => b.textContent.includes('Own records'))?.click()
    await sleep(1000)
    await step('own-again', { records: fmt()?.payload?.records?.length })

    // Undo walks back: source → … ; redo restores.
    // Read the live store (the localStorage cache lags, more so in a hidden window).
    const store = await import('../hooks/sandboxItemsStore')
    const liveSource = () => store.getSnapshot(boardId).find(i => i.id === fmt()?.id)?.payload?.source
    const beforeUndo = liveSource()
    key('z', { ctrlKey: true }); await sleep(300)
    const undone = liveSource()
    key('y', { ctrlKey: true }); await sleep(300)
    await step('undo', { beforeUndo, afterUndo: undone, afterRedo: liveSource() })
    send('done', true)
}

// ── attach:<boardId> — sticky attachment + clipping + text size (session 5 follow-up).
async function dragEl(el, x, y, dx, dy, n = 20) {
    el.dispatchEvent(ptr('pointerdown', x, y))
    for (let i = 1; i <= n; i++) { await frame(); const e = ptr('pointermove', x + dx * i / n, y + dy * i / n); el.dispatchEvent(e); window.dispatchEvent(e) }
    const up = ptr('pointerup', x + dx, y + dy)
    el.dispatchEvent(up); window.dispatchEvent(up)
    await sleep(700)
}
async function runAttach() {
    await waitFor(() => document.querySelector('#root')?.children.length)
    await sleep(3000)
    go(`/sandboxes/${boardId}`)
    const stage = await waitFor(() => window.Konva?.stages?.find(s => s.container()?.isConnected))
    await sleep(1500)
    key('Escape')
    document.querySelector('button[title="Media"]')?.click(); await sleep(500)
    ;[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Table')?.click(); await sleep(1000)
    // The widget this run inserted: the newest one (the Bag may hold others).
    const fmt = () => cached().filter(i => i.payload?.kind === 'format').sort((a, b) => (b.z_index ?? 0) - (a.z_index ?? 0))[0]
    const widget = () => document.querySelector(`[data-sb-id="${fmt()?.id}"]`)
    const add = widget().querySelector('input[placeholder="+ Add a record"]')
    for (const t of ['Plan the week', 'Make the stock', 'Write the tracker']) { add.focus(); setInput(add, t); enter(add); await sleep(300) }
    add.blur()
    // A text card placed on the widget's lower right — attaches as it lands.
    let wr = widget().getBoundingClientRect()
    key('t'); await sleep(300)
    const kc = stage.content.querySelector('canvas')
    kc.dispatchEvent(ptr('pointerdown', wr.right - 170, wr.bottom - 60)); kc.dispatchEvent(ptr('pointerup', wr.right - 170, wr.bottom - 60))
    await sleep(500)
    const ta = document.activeElement
    if (ta && ta.tagName === 'TEXTAREA') { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, 'A note pinned here'); ta.dispatchEvent(new Event('input', { bubbles: true })) }
    ta?.blur?.(); key('Escape'); await sleep(600)
    const text = () => cached().filter(i => i.type === 'text').sort((a, b) => (b.z_index ?? 0) - (a.z_index ?? 0))[0]
    await step('placed', { attachedTo: text()?.payload?.attachedTo, widget: fmt()?.id })

    // Magnet: drag the card so its left edge lands 3 screen px right of the widget's left edge.
    {
        const z = stage.scaleX()
        const T = text(), W = fmt()
        const el = document.querySelector(`[data-sb-id="${T.id}"]`)
        const r = el.getBoundingClientRect()
        const dxs = (W.x + 3 / z - T.x) * z
        // Watch for the board's drag shield: proof the card moved through the board's own move.
        let shield = false
        const mo = new MutationObserver(() => { if ([...document.body.children].some(c => c.style?.zIndex === '9998')) shield = true })
        mo.observe(document.body, { childList: true })
        await dragEl(el, r.left + 20, r.top + 10, dxs, 12)
        mo.disconnect()
        await step('snapped', { zoom: z, before: [T.x, T.y, T.w, T.h], wanted: W.x + 3 / z, cardX: Math.round(text().x * 100) / 100, cardY: text().y, widget: [W.x, W.y, W.w, W.h], shield, stillAttached: text()?.payload?.attachedTo === W.id })
    }

    // Shrink the widget from its bottom-right corner past the card.
    widget().querySelector('header').dispatchEvent(ptr('pointerdown', wr.left + 60, wr.top + 10)); window.dispatchEvent(ptr('pointerup', wr.left + 60, wr.top + 10))
    await sleep(500)
    wr = widget().getBoundingClientRect()
    let se = [...document.querySelectorAll('svg rect')].find(r => r.style.cursor === 'nwse-resize' && r.getBoundingClientRect().top > wr.top + wr.height / 2)
    let r0 = se.getBoundingClientRect()
    await dragEl(se, r0.left + 4, r0.top + 4, -150, -110)
    await step('shrunk', { box: boxOf(fmt()), stillAttached: text()?.payload?.attachedTo === fmt()?.id, badge: widget()?.querySelector('[class*="hiddenBadge"]')?.textContent })

    // Move the shrunk widget: the clipped card rides along.
    const t0 = boxOf(text()), f0 = boxOf(fmt())
    const hb = widget().querySelector('header').getBoundingClientRect()
    await dragEl(widget().querySelector('header'), hb.left + 40, hb.top + 10, -200, 60)
    const t1 = boxOf(text()), f1 = boxOf(fmt())
    await step('moved', { widgetMoved: [f1.x - f0.x, f1.y - f0.y], textMoved: [t1.x - t0.x, t1.y - t0.y], stillAttached: text()?.payload?.attachedTo === fmt()?.id, badge: widget()?.querySelector('[class*="hiddenBadge"]')?.textContent || null })

    // Zoomed out, the clip still lines up.
    stage.container().parentElement.dispatchEvent(new WheelEvent('wheel', { deltaY: 240, clientX: hb.left, clientY: hb.top, bubbles: true, cancelable: true }))
    await sleep(600)
    await step('zoomed', { zoom: stage.scaleX() })
    stage.container().parentElement.dispatchEvent(new WheelEvent('wheel', { deltaY: -240, clientX: hb.left, clientY: hb.top, bubbles: true, cancelable: true }))
    await sleep(600)

    // Grow it back: the card shows whole again.
    wr = widget().getBoundingClientRect()
    se = [...document.querySelectorAll('svg rect')].find(r => r.style.cursor === 'nwse-resize' && r.getBoundingClientRect().top > wr.top + wr.height / 2)
    r0 = se.getBoundingClientRect()
    await dragEl(se, r0.left + 4, r0.top + 4, 220, 160)
    await step('grown', { box: boxOf(fmt()), stillAttached: text()?.payload?.attachedTo === fmt()?.id, badge: widget()?.querySelector('[class*="hiddenBadge"]')?.textContent || null })

    // Bigger text, twice (Ctrl+Shift+>).
    key('>', { ctrlKey: true, shiftKey: true, code: 'Period' }); await sleep(300)
    key('>', { ctrlKey: true, shiftKey: true, code: 'Period' }); await sleep(500)
    await step('bigger-text', { fontSize: fmt()?.payload?.fontSize })

    // Drag the card off the widget: it detaches.
    const card = document.querySelector(`[data-sb-id="${text()?.id}"]`)
    const cr = card.getBoundingClientRect()
    await dragEl(card, cr.left + 10, cr.top + 10, wr.width + 200, 0)
    await step('dragged-off', { attachedTo: text()?.payload?.attachedTo ?? null, box: boxOf(text()), active: document.activeElement?.tagName })
    const store = await import('../hooks/sandboxItemsStore')
    const live = () => store.getSnapshot(boardId).find(i => i.id === text()?.id)?.payload?.attachedTo ?? null
    const trail = [live()]
    key('z', { ctrlKey: true })
    trail.push(live())
    for (let i = 0; i < 8; i++) { await sleep(75); trail.push(live()) }
    await step('undo-trail', { trail })
    await step('undo-drag', { attachedTo: text()?.payload?.attachedTo ?? null, box: boxOf(text()), active: document.activeElement?.tagName })
    send('done', true)
}

// ── frames:<boardId> — sticky attachment on frames (legacy stamping, shrink,
// crop toggle, drag off), read from the live store. No screenshots needed.
async function runFrames() {
    await waitFor(() => document.querySelector('#root')?.children.length)
    await sleep(3000)
    go(`/sandboxes/${boardId}`)
    const stage = await waitFor(() => window.Konva?.stages?.find(s => s.container()?.isConnected))
    await sleep(1500)
    key('Escape')
    const store = await import('../hooks/sandboxItemsStore')
    const live = () => store.getSnapshot(boardId)
    const frameOf = () => live().find(i => i.payload?.kind === 'frame' && i.payload?.title === 'Frame 1')
    const F = frameOf()
    const kids0 = live().filter(i => i.type !== 'connector' && i.id !== F.id && (() => { const cx = i.x + i.w / 2, cy = i.y + i.h / 2; return cx >= F.x && cx <= F.x + F.w && cy >= F.y && cy <= F.y + F.h })())
    const rect = stage.container().getBoundingClientRect()
    const toClient = (wx, wy) => ({ x: rect.left + stage.x() + wx * stage.scaleX(), y: rect.top + stage.y() + wy * stage.scaleY() })
    await step('before', { frame: boxOf(F), kids: kids0.map(k => [k.type, k.payload?.attachedTo ?? null]) })

    // Grab the frame by its title and drag it.
    const t = toClient(F.x + 12 / stage.scaleX(), F.y - 10 / stage.scaleX())
    const kc = stage.content.querySelector('canvas')
    kc.dispatchEvent(ptr('pointerdown', t.x, t.y))
    for (let i = 1; i <= 10; i++) { await frame(); window.dispatchEvent(ptr('pointermove', t.x + i * 6, t.y + i * 4)) }
    window.dispatchEvent(ptr('pointerup', t.x + 60, t.y + 40)); await sleep(600)
    const F1 = frameOf()
    const kids1 = kids0.map(k => live().find(i => i.id === k.id))
    await step('moved', { frameMoved: [Math.round(F1.x - F.x), Math.round(F1.y - F.y)], kidsMoved: kids1.map((k, i) => [Math.round(k.x - kids0[i].x), Math.round(k.y - kids0[i].y)]), stamped: kids1.map(k => k.payload?.attachedTo === F.id) })

    // Shrink it from the bottom-right handle to a quarter.
    const se = [...document.querySelectorAll('svg rect')].find(r => r.style.cursor === 'nwse-resize' && r.getBoundingClientRect().top > toClient(0, F1.y + F1.h / 2).y)
    const r0 = se.getBoundingClientRect()
    const dx = -F1.w * 0.75 * stage.scaleX(), dy = -F1.h * 0.75 * stage.scaleY()
    se.dispatchEvent(ptr('pointerdown', r0.left + 4, r0.top + 4))
    for (let i = 1; i <= 10; i++) { await frame(); window.dispatchEvent(ptr('pointermove', r0.left + 4 + dx * i / 10, r0.top + 4 + dy * i / 10)) }
    window.dispatchEvent(ptr('pointerup', r0.left + 4 + dx, r0.top + 4 + dy)); await sleep(600)
    const clipGroups = () => stage.find(n => typeof n.clipWidth === 'function' && n.clipWidth() > 0).length
    await step('shrunk', { frame: boxOf(frameOf()), stillAttached: kids0.map(k => live().find(i => i.id === k.id)?.payload?.attachedTo === F.id), clipGroups: clipGroups() })

    // Crop on, from the floating bar.
    const crop = document.querySelector('button[aria-label="Crop at the edge"]')
    const pressedBefore = crop?.getAttribute('aria-pressed')
    crop?.click(); await sleep(700)
    const title = stage.find('Text').map(n => n.text()).find(x => x.startsWith('Frame 1'))
    await step('crop-on', { pressedBefore, overflow: frameOf().payload?.overflow, clipGroups: clipGroups(), title })

    // Undo back to the start: crop, shrink, move.
    for (let i = 0; i < 3; i++) { key('z', { ctrlKey: true }); await sleep(400) }
    const F2 = frameOf()
    await step('undone', { frame: boxOf(F2), overflow: F2.payload?.overflow ?? null, kids: kids0.map(k => live().find(i => i.id === k.id)?.payload?.attachedTo ?? null) })
    send('done', true)
}

// ── top:<boardId> — things drawn on a widget live on the top canvas.
async function runTop() {
    await waitFor(() => document.querySelector('#root')?.children.length)
    await sleep(3000)
    go(`/sandboxes/${boardId}`)
    const stage = await waitFor(() => window.Konva?.stages?.find(s => s.container()?.isConnected))
    await sleep(1500)
    key('Escape')
    const store = await import('../hooks/sandboxItemsStore')
    const live = () => store.getSnapshot(boardId)
    document.querySelector('button[title="Media"]')?.click(); await sleep(500)
    ;[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Table')?.click(); await sleep(800)
    const W = () => live().filter(i => i.payload?.kind === 'format').sort((a, b) => (b.z_index ?? 0) - (a.z_index ?? 0))[0]
    const wEl = () => document.querySelector(`[data-sb-id="${W().id}"]`)
    const kc = stage.content.querySelector('canvas')
    const top = window.Konva.stages.find(s => s !== stage && s.container()?.isConnected)
    const topShapes = () => top ? top.find('Shape').length : -1
    key('Escape'); await sleep(200)

    // Pen: a squiggle across the widget's body.
    let r = wEl().getBoundingClientRect()
    key('p'); await sleep(300)
    const x0 = r.left + 60, y0 = r.top + 120
    kc.dispatchEvent(ptr('pointerdown', x0, y0))
    for (let i = 1; i <= 20; i++) { kc.dispatchEvent(ptr('pointermove', x0 + i * 8, y0 + Math.sin(i / 2) * 20)) ; await sleep(10) }
    kc.dispatchEvent(ptr('pointerup', x0 + 160, y0)); await sleep(600)
    const ink = () => live().filter(i => i.type === 'stroke').sort((a, b) => (b.z_index ?? 0) - (a.z_index ?? 0))[0]
    await step('inked', { attachedTo: ink()?.payload?.attachedTo === W().id, topStage: !!top, topShapes: topShapes() })

    // Sticky tool: a click on the widget places one on it.
    key('n'); await sleep(300)
    kc.dispatchEvent(ptr('pointerdown', r.right - 120, r.top + 200)); kc.dispatchEvent(ptr('pointerup', r.right - 120, r.top + 200)); await sleep(600)
    document.activeElement?.blur?.(); key('Escape'); await sleep(300)
    const sticky = () => live().filter(i => i.payload?.kind === 'sticky').sort((a, b) => (b.z_index ?? 0) - (a.z_index ?? 0))[0]
    await step('sticky', { attachedTo: sticky()?.payload?.attachedTo === W().id, topShapes: topShapes() })

    // Select tool: a press on the ink, over the widget, selects the ink — Delete removes it, not the widget.
    key('v'); await sleep(200); key('Escape'); await sleep(200)
    const inkId = ink().id
    const p0 = { x: x0 + 8 * 10, y: y0 + Math.sin(5) * 20 }
    const target = document.elementFromPoint(p0.x, p0.y)
    target.dispatchEvent(ptr('pointerdown', p0.x, p0.y)); window.dispatchEvent(ptr('pointerup', p0.x, p0.y)); await sleep(400)
    const widgetSelected = /selected/.test(wEl().className)
    key('Delete'); await sleep(500)
    await step('click-through', { pressedOn: target.tagName + '.' + (target.className?.baseVal ?? target.className).toString().slice(0, 30), widgetSelected, inkGone: !live().some(i => i.id === inkId), widgetThere: !!W() })
    key('z', { ctrlKey: true }); await sleep(500)

    // Move the widget: the ink and the sticky ride along.
    const i0 = ink(), s0 = sticky(), w0 = W()
    r = wEl().getBoundingClientRect()
    const bar = wEl().querySelector('header')
    await dragEl(bar, r.left + 40, r.top + 10, -150, 80)
    await step('moved', { widget: [W().x - w0.x, W().y - w0.y], ink: [ink().x - i0.x, ink().y - i0.y], sticky: [sticky().x - s0.x, sticky().y - s0.y] })

    // Eraser on the sticky (over the widget) erases the sticky, not the widget.
    const sid = sticky().id
    r = wEl().getBoundingClientRect()
    const sc = { x: r.left + (sticky().x - W().x + sticky().w / 2) * stage.scaleX(), y: r.top + (sticky().y - W().y + sticky().h / 2) * stage.scaleY() }
    key('e'); await sleep(300)
    const t2 = document.elementFromPoint(sc.x, sc.y)
    t2.dispatchEvent(ptr('pointerdown', sc.x, sc.y)); window.dispatchEvent(ptr('pointerup', sc.x, sc.y)); kc.dispatchEvent(ptr('pointerup', sc.x, sc.y)); await sleep(500)
    await step('erased', { stickyGone: !live().some(i => i.id === sid), widgetThere: live().some(i => i.id === w0.id) })
    send('done', true)
}

// ── table:<boardId> — the Table view (section 6). Drives the DOM with synthetic
// events (keys go to the element, not the focus, so a hidden window works) and
// reads the live store.
async function runTable() {
    const ce = console.error.bind(console)
    console.error = (...a) => { send('console-error', a.map(String).join(' ').slice(0, 400)); ce(...a) }
    window.addEventListener('error', (e) => send('window-error', String(e.message)))
    await waitFor(() => document.querySelector('#root')?.children.length)
    await sleep(3000)
    go(`/sandboxes/${boardId}`)
    const stage = await waitFor(() => window.Konva?.stages?.find(s => s.container()?.isConnected))
    await sleep(1500)
    key('Escape')
    const store = await import('../hooks/sandboxItemsStore')
    const live = () => store.getSnapshot(boardId)
    document.querySelector('button[title="Media"]')?.click()
    await sleep(500)
    ;[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Table')?.click()
    await sleep(1000)
    const fid = live().filter(i => i.payload?.kind === 'format').sort((a, b) => (b.z_index ?? 0) - (a.z_index ?? 0))[0]?.id
    const P = () => live().find(i => i.id === fid)?.payload
    const W = () => document.querySelector(`[data-sb-id="${fid}"]`)
    const pop = () => [...document.querySelectorAll('[role="dialog"][data-sb-handle="true"]')].at(-1)
    const popBtn = (txt) => [...(pop()?.querySelectorAll('button') || [])].find(b => b.textContent.trim().startsWith(txt))
    const setSel = (el, v) => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('change', { bubbles: true })) }
    const kd = (el, k, o = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }))
    const heads = () => [...W().querySelectorAll('[role="columnheader"] button:first-child')].map(b => b.textContent.trim())
    const dataRows = () => [...W().querySelectorAll('[role="row"]')].filter(r => r.querySelector('[role="gridcell"]'))
    const cellOf = (row, name) => row.children[1 + heads().findIndex(h => h.replace(/ [↑↓]$/, '') === name)]
    const texts = (name) => dataRows().map(r => cellOf(r, name)?.textContent.trim())
    const tool = (label) => W().querySelector(`button[aria-label="${label}"]`)
    const values = () => P()?.records?.map(r => r.values)
    await step('inserted', { fid, view: P()?.view, heads: heads() })

    const add = W().querySelector('input[aria-label="New record"]')
    for (const t of ['Plan the week', 'Make the stock', 'Write the tracker']) { setInput(add, t); kd(add, 'Enter'); await sleep(300) }
    await step('records', { titles: texts('Title') })

    // Two new fields from the + header: a number and a multi-select.
    for (const [name, type] of [['Points', 'Number'], ['Tags', 'Multi-select']]) {
        W().querySelector('button[aria-label="Add a field"]').click(); await sleep(300)
        setInput(pop().querySelector('input'), name); await sleep(50)
        popBtn(type).click(); await sleep(400)
    }
    await step('fields', { heads: heads(), fields: P()?.fields?.map(f => [f.name, f.type]) })

    // Points: select a cell, type (the key starts the edit), Enter commits and moves down; Tab moves right.
    const grid = () => W().querySelector('[role="grid"]')
    const press = (el) => { const r = el.getBoundingClientRect(); el.dispatchEvent(ptr('pointerdown', r.left + 4, r.top + 4)); window.dispatchEvent(ptr('pointerup', r.left + 4, r.top + 4)) }
    const dbl = (el) => el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    const ptsCell = (ri) => cellOf(dataRows()[ri], 'Points').querySelector('button')
    // A filled cell: one click selects, typing does nothing, a double-click edits (caret at the end).
    const titleCell = () => cellOf(dataRows()[0], 'Title').querySelector('button')
    press(titleCell()); await sleep(200)
    kd(grid(), 'Q'); await sleep(200)
    const typeIgnored = !W().querySelector('input[aria-label="Title"]')
    dbl(titleCell()); await sleep(200)
    let inp = W().querySelector('input[aria-label="Title"]')
    const caretAtEnd = !!inp && inp.selectionStart === inp.value.length
    kd(inp, 'Escape'); await sleep(200)
    // Empty Points cells: one click edits.
    press(ptsCell(0)); await sleep(250)
    inp = W().querySelector('input[aria-label="Points"]')
    setInput(inp, '5'); kd(inp, 'Enter'); await sleep(300)
    press(ptsCell(1)); await sleep(250)
    inp = W().querySelector('input[aria-label="Points"]'); const downOk = dataRows()[1].contains(inp)
    setInput(inp, '1,200'); kd(inp, 'Enter'); await sleep(300)
    press(ptsCell(2)); await sleep(250)
    inp = W().querySelector('input[aria-label="Points"]'); setInput(inp, '3'); kd(inp, 'Tab'); await sleep(300)
    kd(grid(), 'Enter'); await sleep(400)
    const picker = pop()
    const tabToTags = !!picker && picker.getAttribute('aria-label') === 'Tags options'
    if (picker) { const q = picker.querySelector('input'); setInput(q, 'ui'); kd(q, 'Enter'); await sleep(300); setInput(q, 'api'); kd(q, 'Enter'); await sleep(300) }
    key('Escape'); await sleep(300)
    // Status of row 1 → Done (select, Enter, pick).
    press(cellOf(dataRows()[0], 'Status').querySelector('button')); await sleep(200)
    kd(grid(), 'Enter'); await sleep(300)
    ;[...pop().querySelectorAll('button')].find(b => b.textContent.trim() === 'Done')?.click(); await sleep(300)
    await step('cells', { typeIgnored, caretAtEnd, downOk, tabToTags, values: values(), points: texts('Points'), tagOptions: P()?.fields?.find(f => f.name === 'Tags')?.options })

    // Sort by Points, descending.
    tool('Sort').click(); await sleep(300)
    popBtn('Add sort').click(); await sleep(300)
    const pts = P().fields.find(f => f.name === 'Points').id
    setSel(pop().querySelector('select'), pts); await sleep(300)
    popBtn('Ascending').click(); await sleep(300)
    key('Escape'); await sleep(200)
    await step('sorted', { sorts: P()?.table?.sorts, titles: texts('Title'), points: texts('Points') })

    // Filter: Points > 4.
    tool('Filter').click(); await sleep(300)
    popBtn('Add filter').click(); await sleep(300)
    let sels = pop().querySelectorAll('select'); setSel(sels[0], pts); await sleep(300)
    sels = pop().querySelectorAll('select'); setSel(sels[1], 'gt'); await sleep(300)
    const val = pop().querySelector('input[placeholder="Value"]'); setInput(val, '4'); val.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); await sleep(300)
    key('Escape'); await sleep(200)
    await step('filtered', { filters: P()?.table?.filters, titles: texts('Title'), count: [...W().querySelectorAll('span')].find(x => / of \d+$/.test(x.textContent))?.textContent })
    // A record added under the filter stays shown until the filter changes.
    setInput(add, 'Tiny'); kd(add, 'Enter'); await sleep(400)
    await step('added-under-filter', { titles: texts('Title') })

    // Group by Status; a Sum under Points.
    tool('Group').click(); await sleep(300)
    popBtn('Status').click(); await sleep(400)
    const groups = [...W().querySelectorAll('[class*="groupHead"]')].map(b => b.textContent.trim())
    const calc = [...W().querySelectorAll('[class*="calcRow"]')].at(-1)
    calc.children[1 + heads().findIndex(h => h.startsWith('Points'))].click(); await sleep(300)
    popBtn('Sum').click(); await sleep(300)
    const sums = [...W().querySelectorAll('[class*="calcRow"]')].map(r => r.children[1 + heads().findIndex(h => h.startsWith('Points'))].textContent.trim())
    await step('grouped', { groupBy: P()?.table?.groupBy, groups, calcs: P()?.table?.calcs, sums })

    // Points → Text: values convert, the filter on it goes, the sort stays.
    W().querySelector('[role="columnheader"] button[aria-label="Points settings"]').click(); await sleep(300)
    setSel(pop().querySelector('select[aria-label="Field type"]'), 'text'); await sleep(400)
    key('Escape'); await sleep(200)
    await step('retyped', { type: P()?.fields?.find(f => f.id === pts)?.type, values: values().map(v => v[pts]), filters: P()?.table?.filters, sorts: P()?.table?.sorts })

    // Resize the Title column by +60 px, then undo it.
    const rz = W().querySelector('[role="columnheader"] [title="Drag to resize"]')
    const rr = rz.getBoundingClientRect(), x = rr.left + 3, y = rr.top + 5
    rz.dispatchEvent(ptr('pointerdown', x, y))
    for (let i = 1; i <= 10; i++) { await frame(); rz.dispatchEvent(ptr('pointermove', x + i * 6 * stage.scaleX(), y)) }
    rz.dispatchEvent(ptr('pointerup', x + 60 * stage.scaleX(), y)); await sleep(400)
    const widths = P()?.table?.widths
    key('z', { ctrlKey: true }); await sleep(400)
    await step('resized', { widths, afterUndo: P()?.table?.widths || null })

    // Wheel over the table scrolls it, not the board.
    const sc = W().querySelector('[role="grid"]'), z0 = stage.scaleX()
    const sr = sc.getBoundingClientRect()
    sc.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, shiftKey: true, clientX: sr.left + 20, clientY: sr.top + 20, bubbles: true, cancelable: true }))
    await sleep(200)
    await step('wheel', { zoomSame: stage.scaleX() === z0, scrollLeft: sc.scrollLeft, wide: sc.scrollWidth > sc.clientWidth })

    // Linked to the Bag's tasks: task columns, no "+ field", the view settings kept.
    W().querySelector('button[aria-label="Data source"]').click(); await sleep(400)
    ;[...document.querySelectorAll('[data-sb-handle="true"] button')].find(b => b.textContent.includes('All tasks'))?.click(); await sleep(1200)
    await step('linked', { heads: heads(), addField: !!W().querySelector('button[aria-label="Add a field"]'), rows: dataRows().length, table: P()?.table })
    W().querySelector('button[aria-label="Data source"]').click(); await sleep(400)
    ;[...document.querySelectorAll('[data-sb-handle="true"] button')].find(b => b.textContent.includes('Own records'))?.click(); await sleep(800)
    await step('own-again', { records: P()?.records?.length, heads: heads() })
    send('done', true)
}

// ── grid:<boardId> — checkpoint 1 of the Table follow-up: selection, cell
// fonts, Delete, dragging rows and columns, long tables drawing only what's
// in view. Same conventions as table: (hidden window, live store).
async function runGrid() {
    const ce = console.error.bind(console)
    console.error = (...a) => { send('console-error', a.map(String).join(' ').slice(0, 400)); ce(...a) }
    window.addEventListener('error', (e) => send('window-error', String(e.message)))
    await waitFor(() => document.querySelector('#root')?.children.length)
    await sleep(3000)
    go(`/sandboxes/${boardId}`)
    await waitFor(() => window.Konva?.stages?.find(s => s.container()?.isConnected))
    await sleep(1500)
    key('Escape')
    const store = await import('../hooks/sandboxItemsStore')
    const live = () => store.getSnapshot(boardId)
    document.querySelector('button[title="Media"]')?.click(); await sleep(500)
    ;[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Table')?.click(); await sleep(1000)
    const fid = live().filter(i => i.payload?.kind === 'format').sort((a, b) => (b.z_index ?? 0) - (a.z_index ?? 0))[0]?.id
    const P = () => live().find(i => i.id === fid)?.payload
    const W = () => document.querySelector(`[data-sb-id="${fid}"]`)
    const G = () => W().querySelector('[role="grid"]')
    const kd = (el, k, o = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }))
    const rows = () => [...W().querySelectorAll('[role="row"][data-ri]')]
    const heads = () => [...W().querySelectorAll('[role="columnheader"]')]
    const cell = (ri, ci) => rows()[ri]?.children[1 + ci]
    const center = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] }
    const press = (el, o = {}) => { const [x, y] = center(el); el.dispatchEvent(ptr('pointerdown', x, y, o)); window.dispatchEvent(ptr('pointerup', x, y, o)) }
    const nSel = () => W().querySelectorAll('[class*="cellSel"]').length
    const titles = () => rows().map(r => r.children[1].textContent.trim())
    const add = W().querySelector('input[aria-label="New record"]')
    for (const t of ['Alpha', 'Bravo', 'Charlie', 'Delta']) { setInput(add, t); kd(add, 'Enter'); await sleep(250) }

    // Select a cell, extend with Shift+click, drag-select, arrows.
    press(cell(0, 0).querySelector('button')); await sleep(150)
    const one = nSel()
    press(cell(2, 1).querySelector('button'), { shiftKey: true }); await sleep(150)
    const block = nSel()
    const a = cell(1, 0).querySelector('button'), b = cell(3, 2).querySelector('button')
    const [ax, ay] = center(a)
    a.dispatchEvent(ptr('pointerdown', ax, ay))
    b.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerId: 1, pointerType: 'mouse' })); await sleep(100)
    window.dispatchEvent(ptr('pointerup', ax, ay)); await sleep(150)
    const dragged = nSel()
    kd(G(), 'ArrowUp'); await sleep(150)
    const afterArrow = nSel()
    await step('select', { one, block, dragged, afterArrow })

    // A whole row (grip) and a whole column (header click), then bold on the column.
    press(rows()[1].querySelector('button[aria-label="Select row"]')); await sleep(200)
    const rowCells = nSel(), rowMarked = rows()[1].className.includes('rowSel')
    press(heads()[0].querySelector('button')); await sleep(200)
    const colCells = nSel(), colMarked = heads()[0].className.includes('headSel')
    W().querySelector('button[aria-label^="Bold"]').click(); await sleep(300)
    const boldCol = P()?.table?.styles?.col
    const weight = getComputedStyle(cell(0, 0).querySelector('button')).fontWeight
    // A block of cells → Serif + a fill; Ctrl+I on it.
    press(cell(0, 1).querySelector('button')); await sleep(100)
    press(cell(1, 2).querySelector('button'), { shiftKey: true }); await sleep(150)
    const fsel = W().querySelector('select[aria-label="Font"]')
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(fsel, 'serif'); fsel.dispatchEvent(new Event('change', { bubbles: true })); await sleep(300)
    kd(G(), 'i', { ctrlKey: true }); await sleep(300)
    const cellsStyled = Object.keys(P()?.table?.styles?.cell || {}).length
    const family = getComputedStyle(cell(0, 1).querySelector('button')).fontFamily
    await step('styles', { rowCells, rowMarked, colCells, colMarked, boldCol, weight, cellsStyled, family, sample: Object.values(P()?.table?.styles?.cell || {})[0] })

    // Type into a selected status cell? No — Delete clears a block of titles.
    press(cell(2, 0).querySelector('button')); await sleep(100)
    press(cell(3, 0).querySelector('button'), { shiftKey: true }); await sleep(100)
    kd(G(), 'Delete'); await sleep(300)
    const cleared = P().records.map(r => r.values.title ?? null)
    key('z', { ctrlKey: true }); await sleep(300)
    await step('delete', { cleared, afterUndo: P().records.map(r => r.values.title ?? null) })

    // Drag row 4 (Delta) above row 1 by its grip.
    const grip = rows()[3].querySelector('button[aria-label="Select row"]')
    const [gx, gy] = center(grip)
    const t0 = rows()[0].getBoundingClientRect()
    grip.dispatchEvent(ptr('pointerdown', gx, gy))
    for (let i = 1; i <= 8; i++) { await frame(); grip.dispatchEvent(ptr('pointermove', gx, gy + (t0.top + 3 - gy) * i / 8)) }
    grip.dispatchEvent(ptr('pointerup', gx, t0.top + 3)); await sleep(400)
    const rowOrder = titles()
    // Drag the Due column (3rd) before Title (1st) by its header.
    const due = heads()[2].querySelector('button'), h0 = heads()[0].getBoundingClientRect()
    const [dx, dy] = center(due)
    due.dispatchEvent(ptr('pointerdown', dx, dy))
    for (let i = 1; i <= 8; i++) { await frame(); due.dispatchEvent(ptr('pointermove', dx + (h0.left + 4 - dx) * i / 8, dy)) }
    due.dispatchEvent(ptr('pointerup', h0.left + 4, dy)); await sleep(400)
    await step('reorder', { rowOrder, orders: P().records.map(r => [r.values.title, r.order]), fieldOrder: P()?.table?.fieldOrder, heads: heads().map(h => h.textContent.trim()) })

    // A long table: 400 records, only the rows in view drawn; an edit still lands.
    const t1 = performance.now()
    for (let i = 0; i < 400; i++) { setInput(add, `Row ${i + 1}`); kd(add, 'Enter'); if (i % 25 === 0) await sleep(30) }
    await sleep(1500)
    const addMs = Math.round(performance.now() - t1)
    const drawn = rows().length
    const sc = G()
    sc.scrollTop = sc.scrollHeight; sc.dispatchEvent(new Event('scroll')); await sleep(600)
    const lastTitles = rows().slice(-2).map(r => r.children[1 + heads().findIndex(h => h.textContent.trim().startsWith('Title'))]?.textContent.trim())
    sc.scrollTop = 0; sc.dispatchEvent(new Event('scroll')); await sleep(600)
    const ti = heads().findIndex(h => h.textContent.trim().startsWith('Title'))
    press(cell(0, ti).querySelector('button')); await sleep(100)
    const e0 = performance.now()
    cell(0, ti).querySelector('button').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })); await sleep(50)
    const inp = W().querySelector('input[aria-label="Title"]'); setInput(inp, 'Edited'); kd(inp, 'Enter')
    await frame(); await frame()
    const editMs = Math.round(performance.now() - e0)
    await sleep(300)
    // The eraser passes through the widget (and cards) to the board: the widget stays.
    key('Escape'); await sleep(100)
    key('e'); await sleep(300)
    const [ex, ey] = center(W().querySelector('header'))
    const under = document.elementFromPoint(ex, ey)
    const passes = !W().contains(under)
    under.dispatchEvent(ptr('pointerdown', ex, ey)); under.dispatchEvent(ptr('pointerup', ex, ey)); window.dispatchEvent(ptr('pointerup', ex, ey)); await sleep(400)
    const widgetKept = live().some(i => i.id === fid)
    key('v'); await sleep(200)
    await step('long', { passes, under: under?.tagName, widgetKept, records: P().records.length, drawn, addMs, lastTitles, editMs, firstTitle: rows()[0].children[1 + ti]?.textContent.trim(), spacers: [...W().querySelectorAll('[aria-hidden="true"]')].length })
    send('done', true)
}

// ── extras:<boardId> — checkpoint 2: formula column, totals hint, detail
// panel, paste (one value; rows with the preview), CSV import, attaching a note.
async function runExtras() {
    const ce = console.error.bind(console)
    console.error = (...a) => { send('console-error', a.map(String).join(' ').slice(0, 400)); ce(...a) }
    window.addEventListener('error', (e) => send('window-error', String(e.message)))
    await waitFor(() => document.querySelector('#root')?.children.length)
    await sleep(3000)
    go(`/sandboxes/${boardId}`)
    await waitFor(() => window.Konva?.stages?.find(s => s.container()?.isConnected))
    await sleep(1500)
    key('Escape')
    const store = await import('../hooks/sandboxItemsStore')
    const live = () => store.getSnapshot(boardId)
    document.querySelector('button[title="Media"]')?.click(); await sleep(500)
    ;[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Table')?.click(); await sleep(1000)
    const fid = live().filter(i => i.payload?.kind === 'format').sort((a, b) => (b.z_index ?? 0) - (a.z_index ?? 0))[0]?.id
    const P = () => live().find(i => i.id === fid)?.payload
    const W = () => document.querySelector(`[data-sb-id="${fid}"]`)
    const G = () => W().querySelector('[role="grid"]')
    const kd = (el, k, o = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }))
    const pop = () => [...document.querySelectorAll('[role="dialog"][data-sb-handle="true"]')].at(-1)
    const popBtn = (txt) => [...(pop()?.querySelectorAll('button') || [])].find(b => b.textContent.trim().startsWith(txt))
    const rows = () => [...W().querySelectorAll('[role="row"][data-ri]')]
    const heads = () => [...W().querySelectorAll('[role="columnheader"]')].map(h => h.querySelector('button').textContent.trim().replace(/ [↑↓]$/, ''))
    const col = (name) => heads().indexOf(name)
    const cell = (ri, name) => rows()[ri]?.children[1 + col(name)]
    const texts = (name) => rows().map(r => r.children[1 + col(name)]?.textContent.trim())
    const center = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] }
    const press = (el, o = {}) => { const [x, y] = center(el); el.dispatchEvent(ptr('pointerdown', x, y, o)); window.dispatchEvent(ptr('pointerup', x, y, o)) }
    const dbl = (el) => el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    const setArea = (el, v) => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }
    const blur = (el) => el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    const paste = (el, text) => { const ev = new Event('paste', { bubbles: true, cancelable: true }); Object.defineProperty(ev, 'clipboardData', { value: { getData: () => text } }); el.dispatchEvent(ev) }
    const add = W().querySelector('input[aria-label="New record"]')
    for (const t of ['Pens', 'Paper', 'Ink']) { setInput(add, t); kd(add, 'Enter'); await sleep(250) }
    for (const name of ['Price', 'Qty']) {
        W().querySelector('button[aria-label="Add a field"]').click(); await sleep(300)
        setInput(pop().querySelector('input'), name); await sleep(50)
        popBtn('Number').click(); await sleep(400)
    }
    const typeIn = async (ri, name, v) => { dbl(cell(ri, name).querySelector('button')); await sleep(150); const i = W().querySelector(`input[aria-label="${name}"]`); setInput(i, v); kd(i, 'Enter'); await sleep(250) }
    await typeIn(0, 'Price', '2'); await typeIn(0, 'Qty', '10'); await typeIn(1, 'Price', '5'); await typeIn(1, 'Qty', '3'); await typeIn(2, 'Price', '1/2')

    // A formula column: + → Formula opens its settings with the editor.
    W().querySelector('button[aria-label="Add a field"]').click(); await sleep(300)
    setInput(pop().querySelector('input'), 'Total'); await sleep(50)
    popBtn('Formula').click(); await sleep(600)
    const area = pop()?.querySelector('textarea[aria-label="Formula"]')
    const editorOpened = !!area
    setArea(area, '{Price} * {Cost}'); await sleep(200)
    const liveError = pop().textContent.match(/No field named “Cost”/)?.[0] || null
    setArea(area, '{Price} * {Qty}'); await sleep(100)
    kd(area, 'Enter'); await sleep(400)
    key('Escape'); await sleep(200)
    const totals = texts('Total')
    const fx = P().fields.find(f => f.name === 'Total')
    // Rename Price → Cost: the formula follows.
    W().querySelector('button[aria-label="Price settings"]').click(); await sleep(300)
    const nameIn = pop().querySelector('input[aria-label="Field name"]'); setInput(nameIn, 'Cost'); blur(nameIn); await sleep(300)
    key('Escape'); await sleep(200)
    const exprAfter = P().fields.find(f => f.id === fx.id)?.expr
    // A formula cell can't be edited; 1/0 shows #DIV/0.
    dbl(cell(0, 'Total').querySelector('button')); await sleep(200)
    const fxEditable = !!W().querySelector('input[aria-label="Total"]')
    await step('formula', { editorOpened, liveError, expr: fx?.expr, totals, exprAfter, fxEditable, stored: P().records.map(r => r.values[fx.id] ?? null) })

    // Totals row: the hint shows without hovering; Sum under Total.
    const hint = [...W().querySelectorAll('[class*="calcHint"]')][0]
    const hintText = hint?.textContent, hintOpacity = hint && getComputedStyle(hint).opacity
    const calcRow = [...W().querySelectorAll('[class*="calcRow"]')].at(-1)
    calcRow.children[1 + col('Total')].click(); await sleep(300)
    popBtn('Sum').click(); await sleep(300)
    const sum = [...W().querySelectorAll('[class*="calcRow"]')].at(-1).children[1 + col('Total')].textContent.trim()
    await step('totals', { hintText, hintOpacity, sum })

    // Detail panel: open row 1, change Qty there, step to the next record.
    rows()[0].querySelector('button[aria-label="Open record"]').click(); await sleep(400)
    const panel = () => document.querySelector('[role="dialog"][aria-label^="Record:"]')
    const title0 = panel()?.getAttribute('aria-label')
    const highlighted = rows().map(r => r.className.includes('rowCurrent'))
    const qty = panel().querySelector('input[aria-label="Qty"]'); setInput(qty, '4'); blur(qty); await sleep(300)
    const totalInPanel = [...panel().querySelectorAll('[class*="detailRead"]')].map(x => x.textContent.trim())
    kd(panel(), 'ArrowDown'); await sleep(300)
    const title1 = panel()?.getAttribute('aria-label')
    const highlighted1 = rows().map(r => r.className.includes('rowCurrent'))
    kd(panel(), 'Escape'); await sleep(300)
    await step('detail', { highlighted, highlighted1, title0, title1, qtyNow: P().records[0].values[P().fields.find(f => f.name === 'Qty').id], totalInPanel, closed: !panel() })

    // Paste one value into a selected block (Qty of rows 2–3).
    press(cell(1, 'Qty').querySelector('button')); await sleep(100)
    press(cell(2, 'Qty').querySelector('button'), { shiftKey: true }); await sleep(100)
    paste(G(), '7'); await sleep(400)
    const qtyCol = texts('Qty')
    // Paste rows from a spreadsheet → the preview → Import.
    paste(G(), 'Item\tCost\tQty\tColour\nGlue\t3\t2\tRed\nTape\t1,5\t4\tBlue\n'); await sleep(500)
    const dlg = () => document.querySelector('[role="dialog"][aria-label="Import rows"]')
    const opened = !!dlg()
    const sels = dlg().querySelectorAll('thead select[aria-label$="goes to"]')
    const guessed = [...sels].map(s => s.value)
    const Sel = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
    Sel.call(sels[0], 'title'); sels[0].dispatchEvent(new Event('change', { bubbles: true })); await sleep(200)
    ;[...dlg().querySelectorAll('button')].find(b => b.textContent.trim() === 'Import').click(); await sleep(600)
    await step('paste', { qtyCol, opened, guessed, titles: texts('Title'), heads: heads(), colour: P().fields.find(f => f.name === 'Colour')?.type, total: texts('Total') })

    // CSV import through the toolbar's file input.
    let csv = null
    try {
        const dt = new DataTransfer()
        dt.items.add(new File(['Title,Cost\n"Stapler, red",12\nClips,0.5\n'], 'supplies.csv', { type: 'text/csv' }))
        const fi = W().querySelector('input[type="file"]'); fi.files = dt.files; fi.dispatchEvent(new Event('change', { bubbles: true })); await sleep(800)
        const from = dlg()?.textContent.includes('supplies.csv')
        ;[...dlg().querySelectorAll('button')].find(b => b.textContent.trim() === 'Import').click(); await sleep(600)
        csv = { from, titles: texts('Title') }
    } catch (e) { csv = { error: String(e) } }
    await step('csv', csv)

    // An attachment field; attach a note from the Bag (files go through the native picker, not drivable here).
    W().querySelector('button[aria-label="Add a field"]').click(); await sleep(300)
    setInput(pop().querySelector('input'), 'Files'); await sleep(50)
    popBtn('Attachment').click(); await sleep(400)
    // One click on a filled cell selects it only; one click on an empty cell edits it.
    press(cell(0, 'Title').querySelector('button')); await sleep(250)
    const filledOneClick = !!W().querySelector('input[aria-label="Title"]')
    press(cell(1, 'Due').querySelector('button')); await sleep(250)
    const emptyOneClick = !!W().querySelector('input[aria-label="Due"]')
    key('Escape'); await sleep(150)
    press(cell(0, 'Files').querySelector('button')); await sleep(400)
    const pr = pop()?.getBoundingClientRect()
    const onScreen = !!pr && pr.top >= 0 && pr.left >= 0 && pr.bottom <= innerHeight + 1 && pr.width > 0
    popBtn('Attach a note').click(); await sleep(300)
    const noteBtn = [...pop().querySelectorAll('button')].find(b => b.className.includes('popItem'))
    const noteName = noteBtn?.textContent.trim()
    noteBtn?.click(); await sleep(400)
    key('Escape'); await sleep(300)
    const filesF = P().fields.find(f => f.name === 'Files')
    await step('attach', { filledOneClick, emptyOneClick, popRect: pr && [Math.round(pr.left), Math.round(pr.top)], onScreen, type: filesF?.type, value: P().records[0].values[filesF?.id], noteName, chip: cell(0, 'Files')?.textContent.trim() })
    send('done', true)
}

// Kanban and Matrix (section 7): insert, add cards, drag between columns and within one, one undo step,
// edit rules, detail panel and menus on screen, view switching, the Matrix's cells and tray.
async function runCards() {
    const ce = console.error.bind(console)
    console.error = (...a) => { send('console-error', a.map(String).join(' ').slice(0, 400)); ce(...a) }
    window.addEventListener('error', (e) => send('window-error', String(e.message)))
    await waitFor(() => document.querySelector('#root')?.children.length)
    await sleep(3000)
    go(`/sandboxes/${boardId}`)
    await waitFor(() => window.Konva?.stages?.find(s => s.container()?.isConnected))
    await sleep(1500)
    key('Escape')
    const store = await import('../hooks/sandboxItemsStore')
    const live = () => store.getSnapshot(boardId)
    const insert = async (label) => {
        document.querySelector('button[title="Media"]')?.click(); await sleep(500)
        ;[...document.querySelectorAll('button')].find(b => b.textContent.trim() === label)?.click(); await sleep(1000)
        return live().filter(i => i.payload?.kind === 'format').sort((a, b) => (b.z_index ?? 0) - (a.z_index ?? 0))[0]?.id
    }
    const onScreen = (el) => { const r = el?.getBoundingClientRect(); return !!r && r.width > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1 }
    const setArea = (el, v) => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }
    const kd = (el, k, o = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }))
    const pop = () => [...document.querySelectorAll('[role="dialog"][data-sb-handle="true"]')].at(-1)
    const center = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] }
    const dbl = (el) => el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    const click = (el) => { const [x, y] = center(el); el.dispatchEvent(ptr('pointerdown', x, y)); window.dispatchEvent(ptr('pointerup', x, y)) }
    // Scroll a view's own scroller (not the board) so `el` shows inside it.
    const reveal = (el) => {
        const sc = el.closest('[class*="kscroll"], [class*="mscroll"]')
        if (!sc) return
        const r = el.getBoundingClientRect(), s = sc.getBoundingClientRect()
        if (r.right > s.right) sc.scrollLeft += r.right - s.right + 10
        if (r.left < s.left) sc.scrollLeft -= s.left - r.left + 10
        if (r.bottom > s.bottom) sc.scrollTop += r.bottom - s.bottom + 10
        if (r.top < s.top) sc.scrollTop -= s.top - r.top + 10
    }
    // Press a card, move in steps to (x, y), release there.
    const dragTo = async (el, x, y) => {
        const [x0, y0] = center(el)
        send('trace', { drag: el.textContent.slice(0, 20), from: [Math.round(x0), Math.round(y0)], to: [Math.round(x), Math.round(y)], win: [innerWidth, innerHeight] })
        el.dispatchEvent(ptr('pointerdown', x0, y0)); await sleep(30)
        for (let i = 1; i <= 8; i++) { window.dispatchEvent(ptr('pointermove', x0 + (x - x0) * i / 8, y0 + (y - y0) * i / 8)); await sleep(30) }
        const chain = []; for (let n = document.elementFromPoint(x, y); n && chain.length < 5; n = n.parentElement) chain.push(`${n.tagName}.${String(n.className?.baseVal ?? n.className).slice(0, 30)}`)
        const wr = el.closest('[data-sb-id]')?.getBoundingClientRect()
        send('trace', { moved: true, chain, widget: wr && [Math.round(wr.left), Math.round(wr.top), Math.round(wr.right), Math.round(wr.bottom)] })
        await sleep(100)
        window.dispatchEvent(ptr('pointerup', x, y)); await sleep(400)
        send('trace', { released: true })
    }

    // ---- Kanban ----
    const kid = await insert('Kanban')
    const P = () => live().find(i => i.id === kid)?.payload
    const W = () => document.querySelector(`[data-sb-id="${kid}"]`)
    const heads = () => [...W().querySelectorAll('[class*="khead"]')].map(h => h.textContent.trim())
    const cellOf = (col) => [...W().querySelectorAll('[data-cell]')].find(c => c.getAttribute('data-cell') === `*\u0001${col}`)
    const cardsIn = (col) => [...(cellOf(col)?.querySelectorAll('[data-rid]') || [])].map(c => c.textContent.trim())
    const card = (name) => [...W().querySelectorAll('[data-rid]')].find(c => c.querySelector('[class*="cardTitle"]')?.textContent.trim() === name)
    const addIn = async (col, names) => {
        [...cellOf(col).querySelectorAll('button')].find(b => b.textContent.includes('Add a card')).click(); await sleep(250)
        for (const n of names) { const ta = W().querySelector('textarea[aria-label="New card"]'); setArea(ta, n); kd(ta, 'Enter'); await sleep(250) }
        kd(W().querySelector('textarea[aria-label="New card"]'), 'Escape'); await sleep(250)
    }
    await step('kanban-insert', { view: P()?.view, w: live().find(i => i.id === kid)?.w, heads: heads(), fields: P()?.fields.map(f => f.id) })
    await addIn('To do', ['Alpha', 'Bravo'])
    await addIn('Done', ['Charlie'])
    await step('kanban-added', { todo: cardsIn('To do'), doneCol: cardsIn('Done'), statuses: P().records.map(r => `${r.values.title}:${r.values.status}`) })

    // Alpha → Done, above Charlie: status and order in one step.
    reveal(card('Charlie')); await sleep(200)
    const ch = card('Charlie').getBoundingClientRect()
    const before = live().length
    await dragTo(card('Alpha'), ch.left + ch.width / 2, ch.top + 4)
    const afterMove = { todo: cardsIn('To do'), doneCol: cardsIn('Done'), alpha: P().records.find(r => r.values.title === 'Alpha')?.values.status }
    key('z', { ctrlKey: true }); await sleep(500)
    const undone = { todo: cardsIn('To do'), doneCol: cardsIn('Done') }
    key('y', { ctrlKey: true }); await sleep(500)
    await step('kanban-drag', { afterMove, undone, redoneCol: cardsIn('Done'), itemsSame: live().length === before })

    // Within a column: Delta added under Bravo, dragged above it.
    await addIn('To do', ['Delta'])
    const br = card('Bravo').getBoundingClientRect()
    await dragTo(card('Delta'), br.left + br.width / 2, br.top + 3)
    await step('kanban-reorder', { todo: cardsIn('To do'), orders: P().records.map(r => `${r.values.title}:${r.order ?? '-'}`) })

    // Edit rules: one click on a filled title selects only; a double-click edits.
    click(card('Bravo').querySelector('[class*="cardTitle"]')); await sleep(250)
    const oneClick = { editing: !!W().querySelector('textarea[aria-label="Card title"]'), selected: card('Bravo').getAttribute('aria-selected') }
    dbl(card('Bravo')); await sleep(250)
    const ta = W().querySelector('textarea[aria-label="Card title"]')
    const dblEdit = !!ta
    if (ta) { setArea(ta, 'Bravo two'); kd(ta, 'Enter'); await sleep(300) }
    await step('kanban-edit', { oneClick, dblEdit, renamed: P().records.some(r => r.values.title === 'Bravo two') })

    // Detail panel from ⤢; Space too.
    card('Delta').querySelector('button[aria-label="Open the record"]').click(); await sleep(400)
    const panel = document.querySelector('[role="dialog"][aria-label^="Record:"]')
    const panelInfo = { label: panel?.getAttribute('aria-label'), onScreen: onScreen(panel) }
    kd(panel, 'ArrowDown'); await sleep(250)
    panelInfo.stepped = document.querySelector('[role="dialog"][aria-label^="Record:"]')?.getAttribute('aria-label')
    kd(document.querySelector('[role="dialog"][aria-label^="Record:"]'), 'Escape'); await sleep(300)
    panelInfo.closed = !document.querySelector('[role="dialog"][aria-label^="Record:"]')
    await step('kanban-detail', panelInfo)

    // Column menu: on screen; a limit of 1 on To do (it has 2) shows over the limit; collapse; add a column.
    const todoHead = [...W().querySelectorAll('[class*="khead"]')].find(h => h.textContent.includes('To do'))
    todoHead.querySelector('button[aria-label$="settings"]').click(); await sleep(400)
    const menuOn = onScreen(pop())
    const lim = pop().querySelector('input[aria-label="Card limit"]')
    setInput(lim, '1'); kd(lim, 'Enter'); lim.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); await sleep(400)
    const over = !!todoHead.querySelector('[class*="overLimit"]')
    key('Escape'); await sleep(200)
    W().querySelector('button[aria-label="Collapse Doing"]').click(); await sleep(300)
    // Folded: the whole strip opens it again — a click low down on a cell, far from the name.
    const strip = [...W().querySelectorAll('[data-cell]')].find(c => c.getAttribute('data-cell') === '*\u0001Doing')
    const sr = strip.getBoundingClientRect()
    const foldW = Math.round(sr.width), foldH = Math.round(sr.height)
    strip.click(); await sleep(300)
    const reopened = !(P().kanban?.collapsed || []).includes('Doing')
    W().querySelector('button[aria-label="Collapse Doing"]').click(); await sleep(300)
    W().querySelector('button[aria-label="Add a column"]').click(); await sleep(300)
    // The style bar: nothing selected → every card; a selected card → just it.
    const sbtn = (label) => W().querySelector(`[role="toolbar"] button[aria-label="${label}"]`)
    // A press on empty space in the view lets go of the selected card.
    const empty = cellOf('Done'); const er = empty.getBoundingClientRect()
    empty.dispatchEvent(ptr('pointerdown', er.left + 4, er.bottom - 4)); window.dispatchEvent(ptr('pointerup', er.left + 4, er.bottom - 4)); await sleep(250)
    const sbLabel1 = [...W().querySelectorAll('[class*="count"]')].map(x => x.textContent.trim()).find(x => /cards?$/.test(x))
    sbtn('Bold (Ctrl+B)').click(); await sleep(300)
    const allBold = P().kanban?.styles?.all
    click(card('Delta').querySelector('[class*="cardTitle"]')); await sleep(250)
    const sbLabel2 = [...W().querySelectorAll('[class*="count"]')].map(x => x.textContent.trim()).find(x => /card$/.test(x))
    sbtn('Bigger text').click(); await sleep(300); sbtn('Bigger text').click(); await sleep(300)
    const did = P().records.find(r => r.values.title === 'Delta')?.id
    const deltaFont = parseFloat(getComputedStyle(card('Delta')).fontSize), bravoFont = parseFloat(getComputedStyle(card('Bravo two')).fontSize)
    const deltaWeight = getComputedStyle(card('Delta').querySelector('[class*="cardTitle"]')).fontWeight
    const bravoWeight = getComputedStyle(card('Bravo two').querySelector('[class*="cardTitle"]')).fontWeight
    key('Escape'); await sleep(200)
    await step('kanban-style', { sbLabel1, allBold, sbLabel2, card: P().kanban?.styles?.card?.[did], deltaFont, bravoFont, deltaWeight, bravoWeight })
    await step('kanban-columns', { foldW, foldH, reopened, menuOn, wip: P().kanban?.wip, over, collapsed: P().kanban?.collapsed, options: P().fields.find(f => f.id === 'status').options, heads: heads() })

    // View settings: Priority as swimlanes needs a second select — add one via the Table, then come back.
    const switchTo = async (label) => {
        W().querySelector('button[aria-label="View"]').click(); await sleep(400)
        const on = onScreen(pop())
        ;[...pop().querySelectorAll('button')].find(b => b.textContent.trim() === label).click(); await sleep(600)
        return on
    }
    const viewMenuOn = await switchTo('Matrix')
    const setupText = W().textContent.includes('two Select fields')
    ;[...W().querySelectorAll('button')].find(b => b.textContent.includes('Add an Effort field'))?.click(); await sleep(600)
    await step('matrix-from-kanban', { viewMenuOn, view: P().view, setupText, fields: P().fields.map(f => `${f.id}:${f.type}`), matrix: P().matrix, kanbanKept: !!P().kanban?.wip })

    // Every card is in the tray (no Effort yet). Drag Alpha into Done × High; name that cell.
    const MW = W
    const mcell = (a, b) => [...MW().querySelectorAll('[data-cell]')].find(c => c.getAttribute('data-cell') === `${a}\u0001${b}`)
    const trayCount = MW().querySelector('[data-cell="tray"]').querySelectorAll('[data-rid]').length
    const target = mcell('Done', 'High')
    // The tray sits below the grid: scroll so the target cell's foot and the tray's top both show.
    MW().querySelector('[class*="mscroll"]').scrollTop = target.offsetTop + target.offsetHeight - 120; await sleep(200)
    const tr = target.getBoundingClientRect()
    await dragTo(card('Alpha'), tr.left + tr.width / 2, tr.top + tr.height * 0.7)
    const alpha = P().records.find(r => r.values.title === 'Alpha')?.values
    const effortId = P().fields.find(f => f.name === 'Effort')?.id
    const nameBtn = mcell('Done', 'High').querySelector('[class*="mlabel"]')
    click(nameBtn); await sleep(300)
    const ni = MW().querySelector('input[aria-label="Cell name"]')
    if (ni) { setInput(ni, 'Shipped big'); kd(ni, 'Enter'); await sleep(300) }
    mcell('Done', 'High').querySelector('button[aria-label="Cell colour"]').click(); await sleep(400)
    const huesOn = onScreen(pop())
    pop().querySelector('button[aria-label="Hue 140"]')?.click(); await sleep(300)
    key('Escape'); await sleep(200)
    // Back to the tray clears both.
    reveal(MW().querySelector('[data-cell="tray"]')); await sleep(200)
    const trayEl = MW().querySelector('[data-cell="tray"]').getBoundingClientRect()
    await dragTo(card('Alpha'), trayEl.left + 20, trayEl.top + 12)
    const cleared = P().records.find(r => r.values.title === 'Alpha')?.values
    await step('matrix-cells', { trayCount, alpha: { status: alpha?.status, effort: alpha?.[effortId] }, cell: P().matrix?.cells?.Done?.High, huesOn, cleared: { status: cleared?.status, effort: cleared?.[effortId] } })

    await switchTo('Table')
    const tableRows = [...W().querySelectorAll('[role="row"][data-ri]')].length
    await switchTo('Kanban')
    await step('views-round-trip', { view: P().view, tableRows, kanbanWip: P().kanban?.wip, cards: W().querySelectorAll('[data-rid]').length })

    // ---- a fresh Matrix ----
    const mid = await insert('Matrix')
    const M = () => document.querySelector(`[data-sb-id="${mid}"]`)
    const MP = () => live().find(i => i.id === mid)?.payload
    const labels = [...M().querySelectorAll('[class*="mlabel"]')].map(l => l.textContent.trim())
    const tray = M().querySelector('[data-cell="tray"]')
    ;[...tray.querySelectorAll('button')].find(b => b.textContent.includes('Add a card')).click(); await sleep(250)
    const tta = M().querySelector('textarea[aria-label="New card"]'); setArea(tta, 'Fix login'); kd(tta, 'Enter'); await sleep(300)
    kd(M().querySelector('textarea[aria-label="New card"]'), 'Escape'); await sleep(250)
    const qw = [...M().querySelectorAll('[data-cell]')].find(c => c.getAttribute('data-cell') === 'High\u0001Low').getBoundingClientRect()
    const fix = [...M().querySelectorAll('[data-rid]')].find(c => c.textContent.includes('Fix login'))
    await dragTo(fix, qw.left + qw.width / 2, qw.top + qw.height * 0.7)
    const v = MP().records[0]?.values
    key('z', { ctrlKey: true }); await sleep(500)
    const u = MP().records[0]?.values
    await step('matrix-fresh', { w: live().find(i => i.id === mid)?.w, labels, placed: { impact: v?.impact, effort: v?.effort }, undoneOneStep: { impact: u?.impact ?? null, effort: u?.effort ?? null } })

    // Linked: the Kanban over All tasks — columns To do / Done; only To do offers to add.
    const src = W().querySelector('button[aria-label="Data source"]')
    src.click(); await sleep(400)
    const all = [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('All tasks'))
    all?.click(); await sleep(800)
    await step('kanban-linked', { source: P().source, heads: heads(), addIn: [...W().querySelectorAll('[data-cell]')].filter(c => [...c.querySelectorAll('button')].some(b => b.textContent.includes('Add a card'))).map(c => c.getAttribute('data-cell').split('\u0001')[1]), cards: W().querySelectorAll('[data-rid]').length })
    send('done', true)
}

// Timeline (section 7, checkpoint 2): bars, edges, the tray, links, multi-select, zoom, fit, edit rules, linked tasks.
async function runTimeline() {
    const ce = console.error.bind(console)
    console.error = (...a) => { send('console-error', a.map(String).join(' ').slice(0, 400)); ce(...a) }
    window.addEventListener('error', (e) => send('window-error', String(e.message)))
    await waitFor(() => document.querySelector('#root')?.children.length)
    await sleep(3000)
    go(`/sandboxes/${boardId}`)
    await waitFor(() => window.Konva?.stages?.find(s => s.container()?.isConnected))
    await sleep(1500)
    key('Escape')
    const store = await import('../hooks/sandboxItemsStore')
    const { dayNum, todayNum } = await import('../components/Sandbox/formats/timeline')
    const live = () => store.getSnapshot(boardId)
    document.querySelector('button[title="Media"]')?.click(); await sleep(500)
    ;[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Timeline')?.click(); await sleep(1200)
    const id = live().filter(i => i.payload?.kind === 'format').sort((a, b) => (b.z_index ?? 0) - (a.z_index ?? 0))[0]?.id
    const P = () => live().find(i => i.id === id)?.payload
    const W = () => document.querySelector(`[data-sb-id="${id}"]`)
    const T = todayNum()
    const rel = (s) => (s ? dayNum(s) - T : null)
    const recBy = (title) => P().records.find(r => r.values.title === title)
    const span = (title) => { const r = recBy(title); return r && [rel(r.values.start), rel(r.values.end)] }
    const kd = (el, k, o = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }))
    const setArea = (el, v) => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }
    const center = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] }
    const onScreen = (el) => { const r = el?.getBoundingClientRect(); return !!r && r.width > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1 }
    const bar = (title) => W().querySelector(`[data-bar="${recBy(title)?.id}"]`)
    const bgRect = () => W().querySelector('[data-tl-lanes]').getBoundingClientRect()
    const pxDay = () => { const r = bgRect(); const d = W().querySelector('[data-tl-lanes]').style.width; return r.width / (parseFloat(d) / ({ day: 2.4, week: 0.9, month: 0.26, quarter: 0.1, year: 0.035 }[P().timeline?.zoom || 'week'])) }
    const drag = async (el, dx, dy = 0, o = {}) => {
        const [x0, y0] = typeof el.length === 'number' ? el : center(el)
        const target = typeof el.length === 'number' ? document.elementFromPoint(x0, y0) : el
        target.dispatchEvent(ptr('pointerdown', x0, y0, o)); await sleep(30)
        for (let i = 1; i <= 8; i++) { window.dispatchEvent(ptr('pointermove', x0 + dx * i / 8, y0 + dy * i / 8, o)); await sleep(30) }
        await sleep(80); window.dispatchEvent(ptr('pointerup', x0 + dx, y0 + dy, o)); await sleep(400)
    }
    const undo = async () => { key('z', { ctrlKey: true }); await sleep(450) }

    const axisLabels = [...W().querySelectorAll('[class*="lower"]')].slice(0, 3).map(x => x.textContent)
    const todayTag = W().querySelector('[class*="todayTag"]')
    await step('tl-insert', { w: live().find(i => i.id === id)?.w, fields: P().fields.map(f => f.id), zoom: P().timeline?.zoom || 'week', axisLabels, todayOnScreen: onScreen(todayTag) })

    // A new record from the rail starts today; one in the tray has no dates.
    ;[...W().querySelectorAll('button')].find(b => b.textContent.includes('New, from today')).click(); await sleep(250)
    let ri = W().querySelector('input[aria-label="Title"]'); setInput(ri, 'Design'); kd(ri, 'Enter'); await sleep(300)
    ri = W().querySelector('input[aria-label="Title"]'); setInput(ri, 'Build'); kd(ri, 'Enter'); await sleep(300)
    ri = W().querySelector('input[aria-label="Title"]'); if (ri) { kd(ri, 'Escape'); await sleep(200) }
    ;[...W().querySelector('[data-tl-tray]').querySelectorAll('button')].find(b => b.textContent.includes('Add')).click(); await sleep(250)
    const ta = W().querySelector('textarea[aria-label="New card"]'); setArea(ta, 'Launch'); kd(ta, 'Enter'); await sleep(300)
    kd(W().querySelector('textarea[aria-label="New card"]'), 'Escape'); await sleep(250)
    await step('tl-added', { design: span('Design'), build: span('Build'), launch: span('Launch'), bars: W().querySelectorAll('[data-bar]').length, tray: W().querySelector('[data-tl-tray]').querySelectorAll('[data-rid]').length, barOnScreen: onScreen(bar('Design')) })

    // Move Design 3 days right; Ctrl+Z puts both dates back in one step.
    await drag(bar('Design'), 3 * pxDay())
    const moved = span('Design')
    await undo()
    const undone = span('Design')
    // Edges: the end +2; the start dragged past the end stops at the end.
    const br = bar('Design').getBoundingClientRect()
    await drag([br.right - 2, br.top + br.height / 2], 2 * pxDay())
    const endMoved = span('Design')
    const br2 = bar('Design').getBoundingClientRect()
    await drag([br2.left + 2, br2.top + br2.height / 2], 20 * pxDay())
    await step('tl-drag', { moved, undone, endMoved, startClamped: span('Design') })

    // Launch from the tray onto the axis two weeks out.
    const chip = [...W().querySelector('[data-tl-tray]').querySelectorAll('[data-rid]')].find(c => c.textContent.includes('Launch'))
    const [cx, cy] = center(chip)
    const todayLine = W().querySelector('[class*="today_"]') || W().querySelector('[class*="today"]:not([class*="todayTag"])')
    const tl = todayLine.getBoundingClientRect().left
    const dropX = tl + 14 * pxDay(), dropY = bar('Design').getBoundingClientRect().top + 4
    await drag(chip, dropX - cx, dropY - cy)
    await step('tl-schedule', { launch: span('Launch'), tray: W().querySelector('[data-tl-tray]').querySelectorAll('[data-rid]').length })

    // A link: Design's end dot onto Launch's bar.
    const dot = [...W().querySelectorAll('[class*="linkDot"]')][[...W().querySelectorAll('[class*="row_"]')].findIndex(r => r.textContent.includes('Design'))]
    const [dx0, dy0] = center(dot), [lx, ly] = center(bar('Launch'))
    await drag(dot, lx - dx0, ly - dy0)
    const paths = [...W().querySelectorAll('svg path[class*="link_"]')]
    await step('tl-link', { links: P().timeline?.links?.length, late: paths.some(p => p.getAttribute('class').includes('linkLate')), drawn: paths.length })

    // Shift+click both bars, → moves both a day, one undo step.
    const before = [span('Design'), span('Launch')]
    const click = (el, o = {}) => { const [x, y] = center(el); el.dispatchEvent(ptr('pointerdown', x, y, o)); window.dispatchEvent(ptr('pointerup', x, y, o)) }
    click(bar('Design')); await sleep(200); click(bar('Launch'), { shiftKey: true }); await sleep(200)
    const root = W().querySelector('[class*="view_"]')
    kd(root, 'ArrowRight'); await sleep(400)
    const after = [span('Design'), span('Launch')]
    await undo()
    await step('tl-multi', { before, after, undone: [span('Design'), span('Launch')] })

    // The arrow: click it, Delete.
    const hit = W().querySelector('svg path[class*="linkHit"]')
    const [hx, hy] = center(hit)
    hit.dispatchEvent(ptr('pointerdown', hx, hy)); await sleep(200)
    kd(root, 'Delete'); await sleep(400)
    await step('tl-unlink', { links: P().timeline?.links?.length ?? 0 })

    // Rail: one click on a filled title selects; a double-click edits. A bar's double-click opens the record.
    const rail = [...W().querySelectorAll('[class*="rail_"]')].find(r => r.textContent.includes('Build'))
    rail.click(); await sleep(250)
    const oneClick = !!W().querySelector('input[aria-label="Title"]')
    rail.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); await sleep(250)
    const ti = W().querySelector('input[aria-label="Title"]'); const dblEdit = !!ti
    if (ti) { setInput(ti, 'Build it'); kd(ti, 'Enter'); await sleep(300) }
    bar('Design').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); await sleep(400)
    const panel = document.querySelector('[role="dialog"][aria-label^="Record:"]')
    const panelInfo = { label: panel?.getAttribute('aria-label'), onScreen: onScreen(panel) }
    kd(panel, 'Escape'); await sleep(300)
    await step('tl-edit', { oneClick, dblEdit, renamed: !!recBy('Build it'), panelInfo })

    // Launch into the tray clears its dates.
    const tray = W().querySelector('[data-tl-tray]'), [tx2, ty2] = center(tray), [bx, by] = center(bar('Launch'))
    await drag(bar('Launch'), tx2 - bx, ty2 - by)
    await step('tl-unschedule', { launch: span('Launch') })

    // Zoom: Month button; Ctrl+wheel back in (the board's zoom stays put); Fit.
    const stage = window.Konva.stages.find(s => s.container()?.isConnected)
    const boardScale = stage.scaleX()
    ;[...W().querySelectorAll('button')].find(b => b.textContent.trim() === 'Month').click(); await sleep(400)
    const z1 = P().timeline?.zoom
    const sc = W().querySelector('[class*="scroll_"][data-sb-scroll]')
    const [sx, sy] = center(sc)
    sc.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, clientX: sx, clientY: sy, bubbles: true, cancelable: true })); await sleep(400)
    const z2 = P().timeline?.zoom || 'week'
    ;[...W().querySelectorAll('button')].find(b => b.textContent.trim() === 'Fit').click(); await sleep(500)
    await step('tl-zoom', { z1, z2, fit: P().timeline?.zoom || 'week', boardScaleSame: stage.scaleX() === boardScale, scrollLeft: Math.round(sc.scrollLeft) })

    // Linked: All tasks → due dates as milestones.
    W().querySelector('button[aria-label="Data source"]').click(); await sleep(400)
    ;[...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('All tasks'))?.click(); await sleep(800)
    await step('tl-linked', { head: W().querySelector('[class*="railHead"]')?.textContent, milestones: W().querySelectorAll('[class*="milestone"]').length, tray: W().querySelector('[data-tl-tray]').querySelectorAll('[data-rid]').length })
    send('done', true)
}

if (spec.startsWith('timeline:') && boardId) runTimeline().catch(e => send('error', `${e?.message} @ ${e?.stack}`))
if (spec.startsWith('cards:') && boardId) runCards().catch(e => send('error', `${e?.message} @ ${e?.stack}`))
if (spec.startsWith('extras:') && boardId) runExtras().catch(e => send('error', `${e?.message} @ ${e?.stack}`))
if (spec.startsWith('grid:') && boardId) runGrid().catch(e => send('error', `${e?.message} @ ${e?.stack}`))
if (spec.startsWith('table:') && boardId) runTable().catch(e => send('error', `${e?.message} @ ${e?.stack}`))
if (spec.startsWith('top:') && boardId) runTop().catch(e => send('error', `${e?.message} @ ${e?.stack}`))
if (spec.startsWith('frames:') && boardId) runFrames().catch(e => send('error', `${e?.message} @ ${e?.stack}`))
if (spec.startsWith('attach:') && boardId) runAttach().catch(e => send('error', {
    message: `${e?.message} @ ${e?.stack}`,
    widgets: document.querySelectorAll('[data-sb-scrollcard="true"][data-sb-card="true"]').length,
    withHeader: document.querySelectorAll('[data-sb-card="true"] > header').length,
    inputs: [...document.querySelectorAll('[data-sb-card="true"] input')].map(i => i.placeholder),
    formats: cached().filter(i => i.payload?.kind === 'format').map(i => ({ id: i.id, source: i.payload.source, attachedTo: i.payload.attachedTo })),
    path: location.pathname,
}))
if (spec.startsWith('drag:') && boardId) run().catch(e => send('error', `${e?.message} @ ${e?.stack}`))
if (spec.startsWith('format:') && boardId) runFormat().catch(e => send('error', `${e?.message} @ ${e?.stack}`))
