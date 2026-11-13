// Dev-only probes, loaded by main.jsx only when VITE_PERF_PROBE is set, so
// they never ship:
//   drag:<boardId>   — drag smoothness (below)
//   format:<boardId> — a scripted walk through a Format widget (runFormat)
//   attach:<boardId> — sticky attachment, clipping and text size (runAttach)
//   frames:<boardId> — sticky attachment on frames (runFrames)
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
    const widget = () => document.querySelector('[data-sb-scrollcard="true"][data-sb-card="true"]:has(> header)')
    const fmt = () => cached().find(i => i.payload?.kind === 'format')
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
    ;[...document.querySelectorAll('button')].find(b => b.textContent.includes('All tasks'))?.click()
    await sleep(1200)
    const firstTask = widget().querySelector('button[aria-label="Mark done"]')
    const taskTitle = firstTask?.parentElement?.querySelector('input')?.value
    firstTask?.click()
    await sleep(800)
    await step('linked', { source: fmt()?.payload?.source, rows: widget().querySelectorAll('input:not([placeholder^="+"])').length, ticked: taskTitle })

    widget().querySelector('button[aria-label="Data source"]').click()
    await sleep(500)
    ;[...document.querySelectorAll('button')].find(b => b.textContent.includes('Own records'))?.click()
    await sleep(1000)
    await step('own-again', { records: fmt()?.payload?.records?.length })

    // Undo walks back: source → … ; redo restores.
    key('z', { ctrlKey: true }); await sleep(500)
    const undone = fmt()?.payload?.source
    key('y', { ctrlKey: true }); await sleep(500)
    await step('undo', { afterUndo: undone, afterRedo: fmt()?.payload?.source })
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
