import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { LuPlus, LuCrosshair, LuScan, LuChevronRight, LuChevronDown, LuTrash2, LuMaximize2 } from 'react-icons/lu'
import styles from '../Timeline.module.css'
import b from '../Board.module.css'
import t from '../Table.module.css'
import { AddCard } from './board/Card'
import { ViewBar, CardStyleBar } from './board/cardView'
import { useCards } from './board/useCards'
import { useViewRows } from './board/useViewRows'
import {
    timelineSetup, spanOf, axisRange, ticks, upperLabel, weekends, zoomOf, ZOOMS, todayNum,
    movePatch, resizePatch, schedulePatch, unschedulePatch, fitZoom, cleanLinks, routeLink,
} from '../timeline'
import { kanbanLanes, keyOf, valueOf, primaryField, applyCardStyle, cardLook, NONE } from '../boards'
import { optionHue, isEmptyValue } from '../fields'
import * as F from '../fields'
import { FONT_FAMILIES } from '../../text/textStyle'

/**
 * The Timeline view (spec §13.5): records as bars on a date axis, a rail of
 * titles on the left, optional swimlanes by a select field. Settings live in
 * payload.timeline (timeline.js). Moving a bar rewrites its date fields
 * (R13.40); one gesture is one undo step, however many bars it moves.
 *
 * - Drag a bar to move it, an edge to change its start or end (they never
 *   cross, R13.41), a milestone to move its day; Shift+click selects several
 *   and they move together; ← / → move the selected bars a day.
 * - Drag a bar's end dot onto another bar: a dependency arrow (red when the
 *   second starts before the first ends). Click an arrow, Delete removes it.
 * - Records with no dates wait in the Unscheduled tray (R13.43): drag one onto
 *   the axis to schedule it, or a bar into the tray to clear its dates.
 * - Zoom: Day … Year in the toolbar or Ctrl+wheel at the pointer; Today and
 *   Fit scroll and zoom to the records. Shift+wheel scrolls across.
 * - A double-click on a bar (or Space) opens the record; a rail title edits
 *   like a Table cell (one click when empty, a double-click when not).
 */

const RAIL = 11                 // em
const ROWS = { compact: 2, default: 2.5, tall: 3.1 }
const GROUP_H = 1.9
const DRAG_PX = 4

function RailInput({ value, onDone, style }) {
    return (
        <input className={styles.railInput} defaultValue={value} autoFocus aria-label="Title" style={style}
            onFocus={(e) => { const n = e.currentTarget.value.length; e.currentTarget.setSelectionRange(n, n) }}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && /^[zy]$/i.test(e.key)) return
                e.stopPropagation()
                if (e.key === 'Enter') { e.preventDefault(); onDone(e.currentTarget.value) }
                if (e.key === 'Escape') { e.preventDefault(); onDone(null) }
            }}
            onBlur={(e) => onDone(e.currentTarget.value)} />
    )
}

function lookCss(l) {
    if (!l) return { text: undefined, bg: null }
    const deco = [l.underline && 'underline', l.strike && 'line-through'].filter(Boolean).join(' ')
    return {
        text: {
            fontFamily: l.fontFamily ? FONT_FAMILIES[l.fontFamily]?.css : undefined,
            fontWeight: l.bold ? 700 : undefined,
            fontStyle: l.italic ? 'italic' : undefined,
            textDecoration: deco || undefined,
            color: l.color || undefined,
            fontSize: l.scale ? `${l.scale}em` : undefined,
            textAlign: l.textAlign || undefined,
        },
        bg: l.bg || null,
    }
}

function Settings({ fields, cfg, setup, onConfig, source }) {
    const dates = fields.filter(f => f.type === 'date')
    const sel = fields.filter(f => f.type === 'select')
    const set = (k, v) => onConfig(c => { const n = { ...c }; if (v === undefined) delete n[k]; else n[k] = v; return n })
    const row = (label, el) => <div className={t.popRow}><span className={b.popLabelWide}>{label}</span>{el}</div>
    const pick = (label, list, value, onChange, none) => row(label, (
        <select className={t.popSelect} value={value || ''} aria-label={label} onChange={(e) => onChange(e.target.value || undefined)}>
            {none && <option value="">{none}</option>}
            {list.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
    ))
    return (
        <>
            <div className={t.popHead}>Dates</div>
            {pick('Start', dates, setup.start?.id, (v) => set('startBy', v))}
            {pick('End', dates.filter(f => f !== setup.start), setup.end?.id, (v) => set('endBy', v || 'none'), 'None (milestones)')}
            {source.fieldsEditable && (
                <button className={t.popItem} onClick={() => source.addField({ name: 'Date', type: 'date' })}><span className={t.popTick} />+ New date field</button>
            )}
            <div className={t.popHead}>Rows</div>
            {pick('Swimlanes', sel, setup.group?.id, (v) => set('groupBy', v), 'None')}
            {pick('Colour by', sel, setup.colorBy?.id, (v) => set('colorBy', v), 'None')}
            {row('Height', (
                <span className={b.segs}>
                    {Object.keys(ROWS).map(id => (
                        <button key={id} className={`${b.seg} ${(cfg.rows || 'default') === id ? b.segOn : ''}`}
                            onClick={() => set('rows', id === 'default' ? undefined : id)}>{id[0].toUpperCase() + id.slice(1)}</button>
                    ))}
                </span>
            ))}
        </>
    )
}

function TimelineView({ source, item, onConfig }) {
    const cfg = useMemo(() => item?.payload?.timeline || {}, [item?.payload?.timeline])
    const { t: rows, keepNew } = useViewRows(source, cfg)
    const fields = source.fields
    const setup = timelineSetup(fields, cfg)
    const primary = primaryField(fields)
    const zoom = zoomOf(cfg.zoom)
    const ppd = zoom.ppd
    const rowH = ROWS[cfg.rows] || ROWS.default
    const cfgSet = useCallback((fn) => onConfig?.(fn), [onConfig])
    const today = todayNum()

    const rootRef = useRef(null), scrollRef = useRef(null), bgRef = useRef(null), trayRef = useRef(null)
    const [drag, setDragState] = useState(null)
    const dragRef = useRef(null)
    const setDrag = (v) => { dragRef.current = v; setDragState(v) }
    const [multi, setMulti] = useState(() => new Set())
    const [link, setLink] = useState(null)        // the selected arrow, "from>to"
    const [adding, setAdding] = useState(false)   // the rail's new-record box
    const pending = useRef(null)                  // { day, atPx }: scroll so `day` sits `atPx` from the left, after the next render

    // ---- what's where ----
    const { lines, sched, tray, H } = useMemo(() => {
        const sched = new Map(), tray = []
        for (const r of rows.rows) { const sp = spanOf(r, setup); if (sp) sched.set(r.id, { rec: r, sp }); else tray.push(r) }
        const lines = []
        let y = 0
        const folded = new Set(cfg.collapsed || [])
        const push = (list) => { for (const x of list) { lines.push({ kind: 'row', rec: x.rec, sp: x.sp, y }); y += rowH } }
        const all = [...sched.values()]
        if (setup.group) {
            for (const g of kanbanLanes(setup.group)) {
                const list = all.filter(x => keyOf(setup.group, x.rec) === g.key)
                if (g.key === NONE && !list.length) continue
                const f = folded.has(g.key)
                lines.push({ kind: 'group', key: g.key, label: g.label, count: list.length, folded: f, y })
                y += GROUP_H
                if (!f) push(list)
            }
        } else push(all)
        return { lines, sched, tray, H: Math.max(y, rowH * 3) }
    }, [rows.rows, setup.start, setup.end, setup.group, rowH, cfg.collapsed])   // eslint-disable-line react-hooks/exhaustive-deps

    const range = useMemo(() => axisRange([...sched.values()].map(x => x.sp), zoom.id, today), [sched, zoom.id, today])
    const W = range.days * ppd
    const x = (n) => (n - range.d0) * ppd
    const rowOf = useMemo(() => new Map(lines.filter(l => l.kind === 'row').map(l => [l.rec.id, l])), [lines])
    const order = useMemo(() => [...lines.filter(l => l.kind === 'row').map(l => l.rec.id), ...tray.map(r => r.id)], [lines, tray])
    const ids = useMemo(() => new Set(rows.all.map(r => r.id)), [rows.all])
    const links = cleanLinks(cfg.links, ids)

    const cards = useCards({ source, primary, all: rows.all, order, rootRef, down: () => {}, onStyleKey: (k) => applyLook({ [k]: !curLook?.[k] }) })
    const curLook = cards.sel ? cardLook(cfg.styles, cards.sel) : cfg.styles?.all || null
    const applyLook = (patch) => cfgSet(c => ({ ...c, styles: applyCardStyle(c.styles, cards.sel, patch) }))
    // Several bars can be selected; the card hooks keep the last one (the style bar, Space, the panel).
    const selected = cards.sel ? (multi.has(cards.sel) ? multi : new Set([cards.sel])) : new Set()

    // ---- scrolling and zoom ----
    const emPx = () => parseFloat(getComputedStyle(scrollRef.current).fontSize) || 15
    const scrollTo = (day, atPx) => { pending.current = { day, atPx }; applyPending() }
    const applyPending = () => {
        const sc = scrollRef.current, p = pending.current
        if (!sc || !p) return
        sc.scrollLeft = Math.max(0, (RAIL + (p.day - range.d0) * ppd) * emPx() - p.atPx)
        pending.current = null
    }
    useLayoutEffect(applyPending)   // after a zoom or a range change, put the anchored day back
    const railPx = () => RAIL * emPx()
    const centreAt = () => { const sc = scrollRef.current; return railPx() + (sc.clientWidth - railPx()) / 2 }
    const visibleDay = () => {   // the day at the middle of what shows
        const sc = scrollRef.current
        return range.d0 + (sc.scrollLeft + centreAt() - railPx()) / emPx() / ppd
    }
    useEffect(() => { if (scrollRef.current) scrollTo(today, centreAt()) }, [])   // eslint-disable-line react-hooks/exhaustive-deps
    const setZoom = (id, anchor = null) => {
        if (id === zoom.id) return
        const sc = scrollRef.current
        pending.current = anchor || { day: visibleDay(), atPx: centreAt() }
        cfgSet(c => ({ ...c, zoom: id === 'week' ? undefined : id }))
        if (!sc) pending.current = null
    }
    const fit = () => {
        const sp = [...sched.values()].map(v => v.sp)
        if (!sp.length) { scrollTo(today, centreAt()); return }
        const lo = Math.min(...sp.map(s => s.s)), hi = Math.max(...sp.map(s => s.e))
        const sc = scrollRef.current
        const z = fitZoom(lo, hi, sc.clientWidth / emPx() - RAIL - 1)
        const anchor = { day: lo - (hi - lo + 1) * 0.05, atPx: railPx() }
        if (z === zoom.id) scrollTo(anchor.day, anchor.atPx); else setZoom(z, anchor)
    }
    // Ctrl+wheel zooms at the pointer (before the board's wheel sees it).
    const zoomRef = useRef(null)
    zoomRef.current = { zoom, setZoom, range, ppd }
    useEffect(() => {
        const sc = scrollRef.current
        if (!sc) return
        let last = 0
        const onWheel = (e) => {
            if (!e.ctrlKey && !e.metaKey) return
            e.preventDefault(); e.stopPropagation()
            const now = performance.now()
            if (now - last < 160) return
            last = now
            const { zoom: z, setZoom: set, range: r } = zoomRef.current
            const i = ZOOMS.findIndex(q => q.id === z.id) + (e.deltaY > 0 ? 1 : -1)
            if (i < 0 || i >= ZOOMS.length) return
            const bg = bgRef.current.getBoundingClientRect(), sr = sc.getBoundingClientRect()
            const day = r.d0 + ((e.clientX - bg.left) / bg.width) * r.days
            set(ZOOMS[i].id, { day, atPx: (e.clientX - sr.left) * (sc.clientWidth / sr.width) })
        }
        sc.addEventListener('wheel', onWheel, { passive: false })
        return () => sc.removeEventListener('wheel', onWheel)
    }, [])

    // ---- writing ----
    const writeMany = (list) => {
        const l = list.filter(x => Object.keys(x.patch).length)
        if (!l.length) return
        if (source.updateMany) source.updateMany(l); else l.forEach(x => source.update(x.id, x.patch))
    }
    const recOf = (id) => rows.all.find(r => r.id === id)

    // ---- bar gestures ----
    const barDown = (e, rid, mode) => {
        if (e.button !== 0) return
        e.stopPropagation(); e.preventDefault()
        rootRef.current?.focus({ preventScroll: true })
        setLink(null)
        const shift = e.shiftKey
        const bg = bgRef.current.getBoundingClientRect()
        const pxDay = bg.width / range.days
        const group = mode === 'move' && !shift && selected.has(rid) ? selected : new Set([rid])
        const x0 = e.clientX, y0 = e.clientY
        let moved = false
        const move = (ev) => {
            if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG_PX) return
            moved = true
            const el = document.elementFromPoint(ev.clientX, ev.clientY)
            if (mode === 'link') {
                const to = el?.closest?.('[data-bar]')?.getAttribute('data-bar')
                const k = W / bg.width   // em per screen px
                setDrag({ mode, from: rid, to: to && to !== rid ? to : null, x: (ev.clientX - bg.left) * k, y: (ev.clientY - bg.top) * k })
                return
            }
            const dd = Math.round((ev.clientX - x0) / pxDay)
            const toTray = mode === 'move' && !!el?.closest?.('[data-tl-tray]') && !!rootRef.current?.contains(el)
            setDrag({ mode, ids: group, dd, toTray })
        }
        const done = (ev) => {
            window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', done); window.removeEventListener('pointercancel', cancel)
            const d = dragRef.current
            setDrag(null)
            if (!moved) {
                if (shift) setMulti(() => { const n = new Set(selected); if (n.has(rid)) n.delete(rid); else n.add(rid); return n })
                else setMulti(new Set([rid]))
                cards.setSel(shift && selected.has(rid) && selected.size > 1 ? [...selected].find(x => x !== rid) : rid)
                return
            }
            if (!d || ev?.type !== 'pointerup') return
            if (d.mode === 'link') {
                if (d.to) cfgSet(c => ({ ...c, links: cleanLinks([...(c.links || []), { from: d.from, to: d.to }], ids) }))
                return
            }
            if (d.toTray) { writeMany([...d.ids].map(id => ({ id, patch: unschedulePatch(setup) }))); return }
            if (!d.dd) return
            if (d.mode === 'move') { writeMany([...d.ids].map(id => ({ id, patch: movePatch(recOf(id), setup, d.dd) }))); return }
            const rec = recOf(rid), sp = sched.get(rid)?.sp
            if (rec && sp) writeMany([{ id: rid, patch: resizePatch(rec, setup, d.mode, (d.mode === 'start' ? sp.s : sp.e) + d.dd) }])
        }
        const cancel = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', done); window.removeEventListener('pointercancel', cancel); setDrag(null) }
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', done); window.addEventListener('pointercancel', cancel)
    }

    // A tray card dragged onto the axis: scheduled at that day (and into that swimlane).
    const trayDown = (e, rid) => {
        if (e.button !== 0 || e.target.closest('button, textarea, input')) return
        e.stopPropagation()
        const card = e.currentTarget
        const scale = card.getBoundingClientRect().width / (card.offsetWidth || 1) || 1
        const x0 = e.clientX, y0 = e.clientY
        let moved = false
        const move = (ev) => {
            if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG_PX) return
            if (!moved) { moved = true; card.style.pointerEvents = 'none'; card.style.zIndex = '30' }
            card.style.transform = `translate(${(ev.clientX - x0) / scale}px, ${(ev.clientY - y0) / scale}px)`
            const bg = bgRef.current.getBoundingClientRect()
            const over = ev.clientX >= bg.left && ev.clientX <= bg.right && ev.clientY >= bg.top - 4 && ev.clientY <= Math.max(bg.bottom, bg.top + 24)
                && document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('[data-tl-body]')
            setDrag({ mode: 'schedule', rid, day: over ? range.d0 + Math.floor((ev.clientX - bg.left) / (bg.width / range.days)) : null, yEm: over ? (ev.clientY - bg.top) * (W / bg.width) : null })
        }
        const done = (ev) => {
            window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', done); window.removeEventListener('pointercancel', done)
            card.style.transform = ''; card.style.pointerEvents = ''; card.style.zIndex = ''
            const d = dragRef.current
            setDrag(null)
            if (!moved) { cards.api.click(ev, rid); return }
            if (ev.type !== 'pointerup' || !d || d.day == null) return
            const patch = schedulePatch(setup, d.day, zoom.id)
            if (setup.group) {
                // The swimlane under the drop: the last group head above it.
                const head = [...lines].reverse().find(l => l.kind === 'group' && l.y <= d.yEm)
                if (head) { const v = valueOf(head.key); if (keyOf(setup.group, recOf(rid)) !== head.key) patch[setup.group.id] = v }
            }
            source.update(rid, patch)
        }
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', done); window.addEventListener('pointercancel', done)
    }

    // ---- keys: ← / → nudge the selected bars a day; Delete removes the selected arrow ----
    const onKeyDown = (e) => {
        if (e.target === rootRef.current && !(e.ctrlKey || e.metaKey)) {
            if (link && (e.key === 'Delete' || e.key === 'Backspace')) {
                e.preventDefault(); e.stopPropagation()
                const [from, to] = link.split('>')
                cfgSet(c => ({ ...c, links: (c.links || []).filter(l => !(l.from === from && l.to === to)) }))
                setLink(null)
                return
            }
            if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && selected.size) {
                e.preventDefault(); e.stopPropagation()
                const dd = e.key === 'ArrowLeft' ? -1 : 1
                writeMany([...selected].filter(id => sched.has(id)).map(id => ({ id, patch: movePatch(recOf(id), setup, dd) })))
                return
            }
            if (e.key === 'Escape' && (link || multi.size)) { setLink(null); setMulti(new Set()) }
        }
        cards.onKeyDown(e)
    }

    // ---- adding ----
    const addScheduled = (text) => {
        const values = { ...(primary ? { [primary.id]: text } : {}), ...schedulePatch(setup, today, zoom.id) }
        keepNew(source.add(values))
    }

    // ---- set-up prompt ----
    if (!setup.start) {
        const addDates = () => source.apply?.(p => {
            let q = p
            for (const def of [{ name: 'Start', type: 'date' }, { name: 'End', type: 'date' }]) {
                const r = F.addField(q, def, { id: (q.fields || []).some(f => f.id === def.name.toLowerCase()) ? F.newFieldId() : def.name.toLowerCase() })
                if (!r.error) q = r.payload
            }
            return q
        })
        return (
            <div className={b.view}>
                <div className={b.setup}>
                    <p>A Timeline places records by a <b>Date</b> field — {source.type === 'own' ? 'there isn’t one yet' : 'this project’s tasks have no dates'}.</p>
                    {source.fieldsEditable && source.apply && <button className={t.popBtn} onClick={addDates}><LuPlus size={13} /> Add Start and End fields</button>}
                </div>
            </div>
        )
    }

    // ---- drawing ----
    const [upperUnit, lowerUnit] = zoom.tiers
    const upper = ticks(upperUnit, range.d0, range.d1)
    const lower = ticks(lowerUnit, range.d0, range.d1)
    const shadeWeekends = zoom.id === 'day' || zoom.id === 'week'
    const preview = (id, sp) => {
        const d = drag
        if (!d || !d.ids?.has(id) || !d.dd) return sp
        if (d.mode === 'move') return { ...sp, s: sp.s + d.dd, e: sp.e + d.dd }
        if (d.mode === 'start') return { ...sp, s: Math.min(sp.s + d.dd, sp.e) }
        if (d.mode === 'end') return { ...sp, e: Math.max(sp.e + d.dd, sp.s) }
        return sp
    }
    const anchorOut = (line) => { const sp = preview(line.rec.id, line.sp); return { x: sp.milestone ? x(sp.s) + ppd / 2 + 0.55 : x(sp.e + 1), y: line.y + rowH / 2 } }
    const anchorIn = (line) => { const sp = preview(line.rec.id, line.sp); return { x: sp.milestone ? x(sp.s) + ppd / 2 - 0.55 : x(sp.s), y: line.y + rowH / 2 } }
    const editable = !!primary && source.editable.has(primary.id)
    const canDate = source.editable.has(setup.start.id)

    return (
        <div ref={rootRef} className={b.view} tabIndex={0} onKeyDown={onKeyDown}>
            <ViewBar fields={fields} cfg={cfg} onConfig={cfgSet} shown={rows.rows.length} total={rows.total}
                styleBar={<CardStyleBar cur={curLook} selected={!!cards.sel} apply={applyLook} />}
                settings={() => <Settings fields={fields} cfg={cfg} setup={setup} onConfig={cfgSet} source={source} />}
                extra={(
                    <>
                        <span className={styles.zooms} role="group" aria-label="Zoom">
                            {ZOOMS.map(z => (
                                <button key={z.id} className={`${t.tool} ${styles.zoomBtn} ${z.id === zoom.id ? t.toolOn : ''}`} aria-pressed={z.id === zoom.id}
                                    onClick={() => setZoom(z.id)} title={`${z.label} (Ctrl+wheel zooms at the pointer)`}>{z.label}</button>
                            ))}
                        </span>
                        <button className={t.tool} onClick={() => scrollTo(today, centreAt())} title="Scroll to today"><LuCrosshair size="1em" /> Today</button>
                        <button className={t.tool} onClick={fit} title="Zoom and scroll to show every record"><LuScan size="1em" /> Fit</button>
                    </>
                )} />
            {/* data-sb-scroll: the board's wheel scrolls this; Ctrl+wheel zooms the axis. */}
            <div ref={scrollRef} className={styles.scroll} data-sb-scroll="true"
                onPointerDown={(e) => { if (!e.target.closest('[data-bar], [data-rid], path')) { cards.setSel(null); setMulti(new Set()); setLink(null) } }}>
                <div className={styles.canvas} style={{ width: `${RAIL + W}em` }}>
                    <div className={styles.head}>
                        <div className={styles.railHead} style={{ width: `${RAIL}em` }} title="Start → End (change them in View)">
                            {setup.start.name}{setup.end ? ` → ${setup.end.name}` : ''}
                        </div>
                        <div className={styles.axis} style={{ width: `${W}em` }}>
                            <div className={styles.tier}>
                                {upper.map(k => (
                                    <span key={k.start} className={styles.upper} style={{ left: `${x(k.n)}em`, width: `${k.len * ppd}em` }}>
                                        <span className={styles.stickyLabel}>{upperLabel(upperUnit, k.start)}</span>
                                    </span>
                                ))}
                            </div>
                            <div className={styles.tier}>
                                {lower.map(k => (
                                    <span key={k.start} className={styles.lower} style={{ left: `${x(k.n)}em`, width: `${k.len * ppd}em` }}>{k.len * ppd > 1.6 ? k.label : ''}</span>
                                ))}
                                {today >= range.d0 && today <= range.d1 && <span className={styles.todayTag} style={{ left: `${x(today) + ppd / 2}em` }}>Today</span>}
                            </div>
                        </div>
                    </div>

                    <div className={styles.body} data-tl-body="true" style={{ height: `${H}em` }}>
                        {/* The axis's grid, weekends and today, under everything. */}
                        <div ref={bgRef} className={styles.bg} data-tl-lanes="true" style={{ left: `${RAIL}em`, width: `${W}em` }}>
                            {shadeWeekends && weekends(range.d0, range.d1).map(n => <span key={n} className={styles.weekend} style={{ left: `${x(n)}em`, width: `${2 * ppd}em` }} />)}
                            {lower.map(k => <span key={`l${k.start}`} className={styles.gridLine} style={{ left: `${x(k.n)}em` }} />)}
                            {upper.map(k => <span key={`u${k.start}`} className={`${styles.gridLine} ${styles.gridStrong}`} style={{ left: `${x(k.n)}em` }} />)}
                            {today >= range.d0 && today <= range.d1 && <span className={styles.today} style={{ left: `${x(today) + ppd / 2}em` }} />}
                            {drag?.mode === 'schedule' && drag.day != null && (
                                <span className={styles.dropDay} style={{ left: `${x(drag.day)}em`, width: `${(setup.end ? zoom.dur : 1) * ppd}em` }} />
                            )}
                        </div>

                        {/* Dependency arrows, in em (viewBox = the axis in em; strokes keep their width). */}
                        <svg className={styles.links} style={{ left: `${RAIL}em`, width: `${W}em`, height: `${H}em` }} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
                            <defs>
                                <marker id="tl-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
                                    <path d="M0 0L10 5L0 10z" fill="context-stroke" />
                                </marker>
                            </defs>
                            {links.map(l => {
                                const a = rowOf.get(l.from), z = rowOf.get(l.to)
                                if (!a || !z) return null
                                const p = anchorOut(a), q = anchorIn(z)
                                const late = preview(z.rec.id, z.sp).s <= preview(a.rec.id, a.sp).e
                                const k = `${l.from}>${l.to}`
                                const d = routeLink(p.x, p.y, q.x, q.y, 0.6, rowH / 2)
                                return (
                                    <g key={k}>
                                        <path d={d} className={`${styles.link} ${late ? styles.linkLate : ''} ${link === k ? styles.linkSel : ''}`} markerEnd="url(#tl-arrow)" />
                                        <path d={d} className={styles.linkHit} onPointerDown={(e) => { e.stopPropagation(); rootRef.current?.focus({ preventScroll: true }); setLink(k) }}>
                                            <title>{late ? 'Starts before the one it waits for ends' : 'Waits for the first to finish'} — click, then Delete to remove</title>
                                        </path>
                                    </g>
                                )
                            })}
                            {drag?.mode === 'link' && rowOf.get(drag.from) && (() => {
                                const p = anchorOut(rowOf.get(drag.from))
                                return <path d={`M${p.x} ${p.y}L${drag.x} ${drag.y}`} className={`${styles.link} ${styles.linkDraft}`} markerEnd="url(#tl-arrow)" />
                            })()}
                        </svg>

                        {lines.map(l => {
                            if (l.kind === 'group') {
                                return (
                                    <div key={`g:${l.key}`} className={styles.groupRow} style={{ top: `${l.y}em`, height: `${GROUP_H}em` }}>
                                        <button className={styles.groupHead} style={{ width: `${RAIL}em` }}
                                            onClick={() => cfgSet(c => ({ ...c, collapsed: (c.collapsed || []).includes(l.key) ? c.collapsed.filter(k => k !== l.key) : [...(c.collapsed || []), l.key] }))}>
                                            {l.folded ? <LuChevronRight size="1em" /> : <LuChevronDown size="1em" />}
                                            <span className={l.key === NONE ? b.kheadNone : undefined}>{l.label}</span>
                                            <span className={b.kcount}>{l.count}</span>
                                        </button>
                                    </div>
                                )
                            }
                            const rec = l.rec, sp = preview(rec.id, l.sp)
                            const title = primary ? rec.values?.[primary.id] : ''
                            const look = lookCss(cardLook(cfg.styles, rec.id))
                            const optHue = setup.colorBy && typeof rec.values?.[setup.colorBy.id] === 'string' ? optionHue(rec.values[setup.colorBy.id]) : null
                            const fill = look.bg ? { '--bar': look.bg } : optHue != null ? { '--bar': `hsl(${optHue}, 55%, 52%)` } : undefined
                            const isSel = selected.has(rec.id)
                            const left = x(sp.s), width = Math.max(0.45, (sp.e - sp.s + 1) * ppd)
                            const inside = !sp.milestone && width >= 5
                            const lifted = drag?.ids?.has(rec.id)
                            const target = drag?.mode === 'link' && drag.to === rec.id
                            return (
                                <div key={rec.id} className={`${styles.row} ${isSel ? styles.rowSel : ''}`} style={{ top: `${l.y}em`, height: `${rowH}em` }}>
                                    <div className={styles.rail} style={{ width: `${RAIL}em` }} data-rid={rec.id}
                                        onClick={(e) => { if (cards.editing !== rec.id) { setMulti(new Set([rec.id])); cards.api.click(e, rec.id) } }}
                                        onDoubleClick={() => cards.api.edit(rec.id)}>
                                        {cards.editing === rec.id ? (
                                            <RailInput value={typeof title === 'string' ? title : ''} style={look.text} onDone={(v) => cards.api.editDone(rec.id, v)} />
                                        ) : (
                                            <span className={`${styles.railTitle} ${title ? '' : b.untitled}`} style={look.text} title={editable ? 'Double-click to edit' : undefined}>{title || 'Untitled'}</span>
                                        )}
                                    </div>
                                    <div className={styles.lane} style={{ left: `${RAIL}em`, width: `${W}em` }}>
                                        {sp.milestone ? (
                                            <span data-bar={rec.id} className={[styles.milestone, isSel && styles.barSel, lifted && styles.barLifted, target && styles.barTarget].filter(Boolean).join(' ')}
                                                style={{ left: `${x(sp.s) + ppd / 2}em`, ...fill }} title={title || 'Untitled'}
                                                onPointerDown={canDate ? (e) => barDown(e, rec.id, 'move') : undefined} onDoubleClick={() => cards.api.open(rec.id)} />
                                        ) : (
                                            <div data-bar={rec.id} className={[styles.bar, isSel && styles.barSel, lifted && styles.barLifted, target && styles.barTarget].filter(Boolean).join(' ')}
                                                style={{ left: `${left}em`, width: `${width}em`, ...fill }} title={title || 'Untitled'}
                                                onPointerDown={canDate ? (e) => barDown(e, rec.id, 'move') : undefined} onDoubleClick={() => cards.api.open(rec.id)}>
                                                {inside && <span className={styles.barLabel} style={look.text}>{title || 'Untitled'}</span>}
                                                {canDate && setup.end && <span className={`${styles.edge} ${styles.edgeL}`} onPointerDown={(e) => barDown(e, rec.id, 'start')} title="Drag to change the start" />}
                                                {canDate && setup.end && <span className={`${styles.edge} ${styles.edgeR}`} onPointerDown={(e) => barDown(e, rec.id, 'end')} title="Drag to change the end" />}
                                            </div>
                                        )}
                                        {!inside && (
                                            <span className={styles.sideLabel} style={{ left: `${sp.milestone ? x(sp.s) + ppd / 2 + 0.8 : left + width + 0.4}em`, ...look.text }}>{title || 'Untitled'}</span>
                                        )}
                                        <span className={styles.linkDot} style={{ left: `${sp.milestone ? x(sp.s) + ppd / 2 + 0.55 : left + width}em` }}
                                            onPointerDown={(e) => barDown(e, rec.id, 'link')} title="Drag onto another bar: it waits for this one" />
                                    </div>
                                </div>
                            )
                        })}
                        {!lines.some(l => l.kind === 'row') && <div className={styles.emptyNote} style={{ left: `${RAIL + 1}em` }}>Nothing scheduled{tray.length ? ' — drag a record up from Unscheduled' : ''}.</div>}
                    </div>

                    {source.type === 'own' && source.canAdd && (
                        <div className={styles.addRow} style={{ width: `${RAIL}em` }}>
                            {adding ? (
                                <RailInput value="" onDone={(v) => { if (v?.trim()) { addScheduled(v.trim()); setAdding(true) } else setAdding(false) }} />
                            ) : (
                                <button className={b.addCard} onClick={() => setAdding(true)} title="A new record, starting today"><LuPlus size="1em" /> New, from today</button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <div ref={trayRef} data-tl-tray="true" className={`${b.tray} ${styles.tray} ${drag?.toTray ? b.cellOver : ''}`}>
                <div className={b.trayHead}>
                    Unscheduled <span className={b.kcount}>{tray.length}</span>
                    <span className={b.trayHint}>{tray.length ? 'Drag one onto the timeline to schedule it' : 'Drag a bar here to clear its dates'}</span>
                </div>
                <div className={styles.trayItems}>
                    {tray.map(r => {
                        const title = primary ? r.values?.[primary.id] : ''
                        return (
                            <div key={r.id} data-rid={r.id} className={`${b.card} ${styles.chip} ${cards.sel === r.id ? b.cardSel : ''}`}
                                style={lookCss(cardLook(cfg.styles, r.id)).text} onPointerDown={(e) => trayDown(e, r.id)} onDoubleClick={() => cards.api.open(r.id)}>
                                {isEmptyValue(title) ? <span className={b.untitled}>Untitled</span> : title}
                                <button className={b.cardBtn} onClick={() => cards.api.open(r.id)} title="Open the record (Space)" aria-label="Open the record"><LuMaximize2 size="0.85em" /></button>
                                {source.canRemove && <button className={`${b.cardBtn} ${b.cardDel}`} onClick={() => cards.api.remove(r.id)} title="Delete record" aria-label="Delete record"><LuTrash2 size="0.85em" /></button>}
                            </div>
                        )
                    })}
                    {source.canAdd && <TrayAdd onAdd={(text) => keepNew(source.add(primary ? { [primary.id]: text } : {}))} />}
                </div>
            </div>
            {cards.overlays}
        </div>
    )
}

function TrayAdd({ onAdd }) {
    const [open, setOpen] = useState(false)
    if (open) return <AddCard placeholder="Type a title, Enter" onAdd={onAdd} onClose={() => setOpen(false)} />
    return <button className={b.addCard} onClick={() => setOpen(true)}><LuPlus size="1em" /> Add</button>
}

export default memo(TimelineView)
