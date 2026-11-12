import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { LuPlus, LuMinus, LuTrash2, LuArrowRightLeft, LuArrowDown, LuArrowRight, LuArrowUp, LuArrowLeft, LuScan, LuCircleHelp, LuChevronLeft, LuChevronRight, LuChevronUp, LuChevronDown } from 'react-icons/lu'
import { layoutFor, addNode, addNext, connect, updateNode, removeNode, updateEdge, removeEdge, reverseEdge, NODE_GROUPS, kindLabel, roundFor, hasTextForm, moveFamily, setLowered, laneBend, linkLook, styleLinks } from './flowGraph'
import { shapeOutline } from './svgPath'
import { NextStepIcon } from './icons'
import { keepInView } from './camera'
import { ShapeThumb } from '../Toolbar/ShapePicker'
import { routeConnector, labelBox, LABEL_FONT } from '../connectors/geometry'
import { headGeometry, headInset, pathEnds, trimPath, taperedArrowPolygon } from '../connectors/heads'
import { svgDashFor } from '../connectors/lineStyle'
import LinkControls from './LinkControls'
import { fontCss } from '../text/textStyle'

// The Nodes tab: build a flowchart by hand, without writing any text.
//
// The drawing IS the preview. Positions come from the same layered layout the
// board's text-to-diagram and Tidy use, so nothing is dragged into place.
// Each node has one "+" handle on its outgoing side: click it for the next
// step, or drag it onto another node to link the two.
//
// When the layout changes, nodes glide to their new places rather than jump,
// and the view holds still around the node you're working on: the camera
// moves with it, so it stays put on screen while the rest re-flows.
// Wheel zooms at the pointer, as on the board; drag empty space to pan.
//
// Arranging, within what the layout allows: families (groups with no link
// between them) sit side by side across the flow and can be reordered; a node
// with no children can be lowered, down to its family's deepest level, so a
// lone branch can sit beside the leaves of a long one. A node with children
// always stays directly above them.

const HELP_KEY = 'siddran_sandbox_diagram_help'
const helpRemembered = () => { try { return localStorage.getItem(HELP_KEY) === '1' } catch { return false } }

const PAD = 48
const DUR = 200             // ms a re-flow takes to glide into place
const ZMIN = 0.2, ZMAX = 2.5
const HANDLE_R = 9
const DIMMED = 0.22       // what the selection doesn't touch

const anchor = (n, side) => ({
  n: { x: n.x + n.w / 2, y: n.y }, s: { x: n.x + n.w / 2, y: n.y + n.h },
  e: { x: n.x + n.w, y: n.y + n.h / 2 }, w: { x: n.x, y: n.y + n.h / 2 },
}[side])

const pairs = (pts) => { const out = []; for (let i = 0; i < pts.length; i += 2) out.push(`${pts[i]},${pts[i + 1]}`); return out.join(' ') }
const clampZ = (z) => Math.min(ZMAX, Math.max(ZMIN, z))

const s = {
  wrap: { display: 'flex', flex: 1, minHeight: 0, gap: 12 },
  stage: { position: 'relative', flex: 1, minWidth: 0, background: 'var(--bg-primary)', border: '1px solid var(--border-default)', borderRadius: 8, overflow: 'hidden' },
  bar: { position: 'absolute', top: 8, left: 8, display: 'flex', gap: 4, zIndex: 1 },
  zoom: { position: 'absolute', bottom: 8, left: 8, display: 'flex', alignItems: 'center', gap: 2, zIndex: 1, background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 8, padding: 2 },
  pct: { fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)', minWidth: 40, textAlign: 'center' },
  side: { fontFamily: fontCss(), width: 260, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', paddingRight: 2 },
  label: { fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.14em', textTransform: 'uppercase' },
  group: { fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 2 },
  input: {
    width: '100%', boxSizing: 'border-box', fontSize: 13, color: 'var(--text-primary)', background: 'var(--bg-primary)',
    border: '1px solid var(--border-default)', borderRadius: 6, padding: '7px 9px', outline: 'none', fontFamily: 'inherit', resize: 'vertical',
  },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 },
  row: { display: 'flex', gap: 4, flexWrap: 'wrap' },
  kbd: { fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-primary)', background: 'var(--bg-elevated)', borderRadius: 4, padding: '0 4px' },
  help: { fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.55, margin: 0 },
  helpCard: {
    position: 'absolute', top: 50, right: 8, width: 290, zIndex: 2, fontFamily: fontCss(), display: 'flex', flexDirection: 'column', gap: 8,
    background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '12px 14px', boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
  },
  textBtn: {
    height: 34, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 11px 0 8px', cursor: 'pointer', borderRadius: 7, fontSize: 13,
    border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontFamily: fontCss(),
  },
  arrangeRow: { display: 'flex', alignItems: 'center', gap: 4 },
  arrangeLabel: { fontSize: 12.5, color: 'var(--text-secondary)', width: 64 },
  note: { fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.45, margin: 0 },
  empty: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13, pointerEvents: 'none' },
}

function IconBtn({ active, title, onClick, children, danger, size = 34, plain, disabled }) {
  return (
    <button
      type="button" title={title} aria-label={title} aria-pressed={active || undefined} onClick={onClick} disabled={disabled}
      style={{
        width: size, height: size, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: disabled ? 'default' : 'pointer', borderRadius: 7,
        opacity: disabled ? 0.35 : 1,
        border: plain ? '1px solid transparent' : `1px solid ${active ? 'var(--accent-warning)' : 'var(--border-default)'}`,
        background: active ? 'color-mix(in srgb, var(--accent-warning) 16%, transparent)' : plain ? 'transparent' : 'var(--bg-surface)',
        color: danger ? 'var(--accent-danger, #e05c5c)' : active ? 'var(--accent-warning)' : 'var(--text-secondary)',
      }}
    >{children}</button>
  )
}

function NodeEditor({ graph, onChange, selected, onSelect, byId, colors, focusReq }) {
  const svgRef = useRef(null)
  const stageRef = useRef(null)
  const labelRef = useRef(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [cam, setCam] = useState({ x: 0, y: 0, z: 1 })
  const [hover, setHover] = useState(null)
  const [drag, setDrag] = useState(null)   // { from, at, start, moved, over } — the + handle
  const [pan, setPan] = useState(null)     // { sx, sy, cam, moved }
  const [anim, setAnim] = useState(null)   // { from: Map key → {x,y}, t0 }
  const [now, setNow] = useState(0)
  const [helpOpen, setHelpOpen] = useState(helpRemembered)
  // Until you zoom, pan or change something, the view keeps itself fitted —
  // the stage's size can still be settling just after the pop-up opens.
  const touchedRef = useRef(false)
  const prevLaidRef = useRef(null)
  const shownRef = useRef(new Map())

  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const laid = useMemo(() => layoutFor(graph, { byId }), [graph, byId])
  const out = graph.dir === 'right' ? 'e' : 's'

  // Where each node is drawn this frame: gliding from `anim.from` to its place.
  const progress = anim ? Math.max(0, Math.min(1, (now - anim.t0) / DUR)) : 1
  const shown = useMemo(() => {
    const ease = 1 - Math.pow(1 - progress, 3)
    return laid.nodes.map((n) => {
      const f = anim?.from.get(n.key)
      return f && progress < 1 ? { ...n, x: f.x + (n.x - f.x) * ease, y: f.y + (n.y - f.y) * ease } : n
    })
  }, [laid, anim, progress])
  const shownAt = useMemo(() => new Map(shown.map((n) => [n.key, n])), [shown])

  const fitCam = (nodes, box = size) => {
    if (!nodes.length || !box.w) return { x: -box.w / 2, y: -box.h / 2, z: 1 }
    const minX = Math.min(...nodes.map((n) => n.x)), minY = Math.min(...nodes.map((n) => n.y))
    const maxX = Math.max(...nodes.map((n) => n.x + n.w)), maxY = Math.max(...nodes.map((n) => n.y + n.h))
    // Never larger than life: two boxes shouldn't fill the window.
    const z = clampZ(Math.min(1, (box.w - PAD * 2) / (maxX - minX || 1), (box.h - PAD * 2 - 40) / (maxY - minY || 1)))
    return { x: (minX + maxX) / 2 - box.w / z / 2, y: (minY + maxY) / 2 - box.h / z / 2 + 20 / z, z }
  }

  useLayoutEffect(() => {
    if (touchedRef.current || !size.w || !size.h) return
    setCam(fitCam(laid.nodes))
  }, [size]) // eslint-disable-line react-hooks/exhaustive-deps

  // The layout changed: glide there. The view stays put — unless the node
  // you're on gets into the outer band of the view (or past it): then it pans,
  // on that axis only, to bring the node halfway back toward the middle.
  useLayoutEffect(() => {
    const prev = prevLaidRef.current
    prevLaidRef.current = laid
    if (!prev || prev === laid) return
    touchedRef.current = true
    const after = new Map(laid.nodes.map((n) => [n.key, n]))
    const cur = shownRef.current
    const from = new Map()
    for (const n of laid.nodes) {
      const at = cur.get(n.key)
      if (at) { from.set(n.key, { x: at.x, y: at.y }); continue }
      // New: grows out of the node it's linked to.
      const e = graph.edges.find((x) => (x.to === n.key && cur.has(x.from)) || (x.from === n.key && cur.has(x.to)))
      const nb = e && cur.get(e.to === n.key ? e.from : e.to)
      if (nb) from.set(n.key, { x: nb.x, y: nb.y })
    }
    const sel = selected?.type === 'node' && after.get(selected.key)
    if (sel && size.w) setCam((c) => keepInView(c, sel, size))
    const t = performance.now()
    setAnim({ from, t0: t }); setNow(t)
  }, [laid, selected, graph.edges, size])

  useLayoutEffect(() => { shownRef.current = shownAt })

  useEffect(() => {
    if (!anim) return
    let id
    const step = (t) => { setNow(t); if (t - anim.t0 < DUR) id = requestAnimationFrame(step); else setAnim(null) }
    id = requestAnimationFrame(step)
    return () => cancelAnimationFrame(id)
  }, [anim])

  // Wheel zooms at the pointer (as on the board). Native, so it can preventDefault.
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      touchedRef.current = true
      const r = el.getBoundingClientRect()
      const px = e.clientX - r.left, py = e.clientY - r.top
      setCam((c) => {
        const z = clampZ(c.z * (e.deltaY < 0 ? 1.1 : 1 / 1.1))
        const wx = c.x + px / c.z, wy = c.y + py / c.z
        return { x: wx - px / z, y: wy - py / z, z }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Buttons and keys zoom on the node you're on (else the middle of the view).
  const zoomBy = (f) => { touchedRef.current = true; setCam((c) => {
    const z = clampZ(c.z * f)
    const sel = selected?.type === 'node' && laid.nodes.find((n) => n.key === selected.key)
    const focus = sel ? { x: sel.x + sel.w / 2, y: sel.y + sel.h / 2 } : { x: c.x + size.w / c.z / 2, y: c.y + size.h / c.z / 2 }
    const sx = (focus.x - c.x) * c.z, sy = (focus.y - c.y) * c.z
    const inView = sx >= 0 && sx <= size.w && sy >= 0 && sy <= size.h
    // Keep it where it is on screen; if it was off screen, bring it to the middle.
    const px = inView ? sx : size.w / 2, py = inView ? sy : size.h / 2
    return { x: focus.x - px / z, y: focus.y - py / z, z }
  }) }
  const fit = () => setCam(fitCam(laid.nodes))

  const edges = useMemo(() => graph.edges.map((e, i) => {
    const a = shownAt.get(e.from), b = shownAt.get(e.to), sd = laid.sides[i]
    if (!a || !b || !sd) return null
    // Drawn as the board will draw it (ConnectorLayer): route, heads, trim, dash, taper.
    const L = linkLook(e, colors.stroke)
    const pts = routeConnector(anchor(a, sd[0]), anchor(b, sd[1]), L.routing, {
      fromSide: sd[0], toSide: sd[1], fromBox: a, toBox: b,
      bend: L.routing === 'elbow' ? laneBend(a, b, sd, laid.turns[i], graph.dir) : null,
      avoid: L.avoid,
      // Round the other boxes, as the board routes it.
      obstacles: () => shown.filter((n) => n !== a && n !== b),
    })
    const sw = L.strokeWidth
    const n = pts.length
    const taper = L.body === 'tapered' && n >= 4 ? taperedArrowPolygon({ x: pts[0], y: pts[1] }, { x: pts[n - 2], y: pts[n - 1] }, sw) : null
    const ends = pathEnds(pts)
    const gEnd = !taper && ends ? headGeometry(L.head, ends.end.tip, ends.end.prev, sw) : null
    const gStart = !taper && ends ? headGeometry(L.headStart, ends.start.tip, ends.start.prev, sw) : null
    const body = trimPath(pts, gStart ? headInset(L.headStart, sw) : 0, gEnd ? headInset(L.head, sw) : 0)
    return { e, i, L, pts, body, taper, heads: [gStart, gEnd].filter(Boolean), dash: svgDashFor({ lineStyle: L.lineStyle, strokeWidth: sw }), label: e.label ? labelBox(pts, e.label) : null }
  }).filter(Boolean), [graph.edges, shownAt, shown, laid.sides, laid.turns, graph.dir, colors.stroke])

  const selNode = selected?.type === 'node' ? graph.nodes.find((n) => n.key === selected.key) : null
  const selEdge = selected?.type === 'edge' ? graph.edges[selected.i] : null

  // What the selection touches stays at full strength; the rest dims. A node:
  // itself, every link on it, and the node at each link's other end. A link:
  // itself and its two ends. Nothing selected: nothing dims.
  const focus = useMemo(() => {
    if (selNode) {
      const links = new Set(), nodes = new Set([selNode.key])
      graph.edges.forEach((e, i) => {
        if (e.from === selNode.key || e.to === selNode.key) { links.add(i); nodes.add(e.from); nodes.add(e.to) }
      })
      return { nodes, links }
    }
    if (selEdge) return { nodes: new Set([selEdge.from, selEdge.to]), links: new Set([selected.i]) }
    return null
  }, [selNode, selEdge, selected, graph.edges])
  const dim = (on) => ({ opacity: focus && !on ? DIMMED : 1, transition: 'opacity 140ms ease' })

  // Focus starts on the drawing, so its keys (and Esc / Ctrl+Enter) work at once.
  useEffect(() => { svgRef.current?.focus() }, [])

  useEffect(() => {
    if (!focusReq) return
    requestAnimationFrame(() => { labelRef.current?.focus(); labelRef.current?.select() })
  }, [focusReq])

  const world = (ev) => {
    const svg = svgRef.current
    const m = svg.getScreenCTM()
    if (!m) return { x: 0, y: 0 }
    const p = svg.createSVGPoint()
    p.x = ev.clientX; p.y = ev.clientY
    const r = p.matrixTransform(m.inverse())
    return { x: r.x, y: r.y }
  }
  const hitNode = (pt) => shown.find((n) => pt.x >= n.x - 8 && pt.x <= n.x + n.w + 8 && pt.y >= n.y - 8 && pt.y <= n.y + n.h + 8)

  const select = (sel, focus = false) => onSelect(sel, focus)
  const add = () => {
    const like = selNode ? { kind: selNode.kind, round: selNode.round } : {}
    const { graph: g, key } = addNode(graph, like)
    onChange(g); select({ type: 'node', key }, true)
  }
  const next = (from) => { const { graph: g, key } = addNext(graph, from); onChange(g); select({ type: 'node', key }, true) }
  const del = () => {
    if (selNode) { onChange(removeNode(graph, selNode.key)); select(null) }
    else if (selEdge) { onChange(removeEdge(graph, selected.i)); select(null) }
  }

  // Arranging. "Earlier/later" for a family is left/right when the flow runs
  // down, up/down when it runs right; "lower" is always further along the flow.
  const selLaid = selNode ? laid.nodes.find((n) => n.key === selNode.key) : null
  const moveFam = (d) => { if (selNode) onChange(moveFamily(graph, selNode.key, d)) }
  const lower = (d) => {
    if (!selLaid || (d > 0 ? !selLaid.canLower : !selLaid.canRaise)) return
    onChange(setLowered(graph, selLaid.key, selLaid.lowered + d))
  }
  const toggleHelp = () => setHelpOpen((o) => {
    try { localStorage.setItem(HELP_KEY, o ? '0' : '1') } catch { /* not remembered */ }
    return !o
  })

  const capture = (ev) => svgRef.current.setPointerCapture?.(ev.pointerId)
  const startHandle = (ev, key) => {
    if (ev.button !== 0) return
    ev.stopPropagation(); ev.preventDefault()
    capture(ev)
    const at = world(ev)
    setDrag({ from: key, at, start: at, moved: false, over: null })
  }
  const startPan = (ev) => {
    capture(ev)
    setPan({ sx: ev.clientX, sy: ev.clientY, cam, moved: false })
  }
  const onMove = (ev) => {
    if (pan) {
      const dx = ev.clientX - pan.sx, dy = ev.clientY - pan.sy
      const moved = pan.moved || Math.hypot(dx, dy) > 3
      if (moved) touchedRef.current = true
      if (moved) setCam({ ...pan.cam, x: pan.cam.x - dx / pan.cam.z, y: pan.cam.y - dy / pan.cam.z })
      if (moved !== pan.moved) setPan({ ...pan, moved })
      return
    }
    if (!drag) return
    const at = world(ev)
    const moved = drag.moved || Math.hypot(at.x - drag.start.x, at.y - drag.start.y) * cam.z > 4
    const over = moved ? hitNode(at) : null
    setDrag({ ...drag, at, moved, over: over && over.key !== drag.from ? over.key : null })
  }
  const onUp = (ev) => {
    if (pan) {
      if (!pan.moved && ev.button === 0) select(null)   // a click on empty space
      setPan(null)
      return
    }
    if (!drag) return
    const { from, moved } = drag
    setDrag(null)
    if (!moved) { next(from); return }                  // a click on + : the next step
    const target = hitNode(world(ev))
    if (target && target.key === from) return
    if (target) {
      const g = connect(graph, from, target.key)
      if (g !== graph) { onChange(g); select({ type: 'edge', i: g.edges.length - 1 }, true) }
      return
    }
    next(from)   // dropped on empty space: a new step, already linked
  }

  // Keys while the drawing (not a text box) has focus.
  const onKey = (ev) => {
    if (ev.target.closest('input, textarea')) return
    if (ev.altKey && ev.key.startsWith('Arrow') && selNode) {
      ev.preventDefault()
      const along = graph.dir === 'right' ? { ArrowRight: 1, ArrowLeft: -1 } : { ArrowDown: 1, ArrowUp: -1 }
      const across = graph.dir === 'right' ? { ArrowDown: 1, ArrowUp: -1 } : { ArrowRight: 1, ArrowLeft: -1 }
      if (along[ev.key]) lower(along[ev.key])
      else if (across[ev.key]) moveFam(across[ev.key])
      return
    }
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && selected) { ev.preventDefault(); del() }
    else if (ev.key === 'Tab' && selNode) { ev.preventDefault(); next(selNode.key) }
    else if (ev.key === 'Enter' && selected) { ev.preventDefault(); labelRef.current?.focus(); labelRef.current?.select() }
    else if ((ev.key === 'n' || ev.key === 'N') && !ev.ctrlKey && !ev.metaKey) { ev.preventDefault(); add() }
    else if ((ev.key === '=' || ev.key === '+') && !ev.ctrlKey) { ev.preventDefault(); zoomBy(1.2) }
    else if (ev.key === '-' && !ev.ctrlKey) { ev.preventDefault(); zoomBy(1 / 1.2) }
    else if (ev.key === '1') { ev.preventDefault(); fit() }
    else if (ev.key === '?') { ev.preventDefault(); toggleHelp() }
  }

  const accent = 'var(--accent-warning)'
  const vw = size.w / cam.z || 1, vh = size.h / cam.z || 1

  return (
    <div style={s.wrap} onKeyDown={onKey}>
      <div ref={stageRef} style={s.stage}>
        <div style={s.bar}>
          <button type="button" style={s.textBtn} onClick={add} title="Add a root node (N): it starts a new family, beside the others. To add after a node, use its + handle or Tab.">
            <LuPlus size={16} /> Root node
          </button>
          <IconBtn title="Top to bottom" active={graph.dir !== 'right'} onClick={() => onChange({ ...graph, dir: 'down' })}><LuArrowDown size={17} /></IconBtn>
          <IconBtn title="Left to right" active={graph.dir === 'right'} onClick={() => onChange({ ...graph, dir: 'right' })}><LuArrowRight size={17} /></IconBtn>
        </div>
        <div style={{ ...s.bar, left: 'auto', right: 8 }}>
          <IconBtn title={helpOpen ? 'Hide how-to (?)' : 'How to use this (?)'} active={helpOpen} onClick={toggleHelp}><LuCircleHelp size={17} /></IconBtn>
        </div>
        {/* Stays up while you work; only its button closes it. */}
        {helpOpen && (
          <div style={s.helpCard} role="note" aria-label="How to use the node editor">
            <span style={s.label}>How</span>
            <p style={s.help}><b>Root node</b> (or <span style={s.kbd}>N</span>) starts a new family, beside the others.</p>
            <p style={s.help}>
              Hover a node for its <b style={{ color: accent }}>+</b> handle: <b>click</b> it for the next step, or <b>drag</b> it onto
              another node to link them. <span style={s.kbd}>Tab</span> also adds the next step.
            </p>
            <p style={s.help}>Click a node or link to edit it. <span style={s.kbd}>Del</span> removes, <span style={s.kbd}>Enter</span> renames.</p>
            <p style={s.help}>
              <b>Arrange</b> (side panel, or <span style={s.kbd}>Alt</span>+arrows): move a whole family earlier or later, or lower a
              node with no children — down to its family's deepest level. A node with children stays right above them.
            </p>
            <p style={s.help}>Wheel zooms, drag empty space to pan, <span style={s.kbd}>1</span> fits everything.</p>
            <p style={s.help}>The layout is the board's own: what you see here is what lands on the board.</p>
          </div>
        )}
        <div style={s.zoom}>
          <IconBtn plain size={28} title="Zoom out (−)" onClick={() => zoomBy(1 / 1.2)}><LuMinus size={15} /></IconBtn>
          <span style={s.pct}>{Math.round(cam.z * 100)}%</span>
          <IconBtn plain size={28} title="Zoom in (+)" onClick={() => zoomBy(1.2)}><LuPlus size={15} /></IconBtn>
          <IconBtn plain size={28} title="Fit everything (1)" onClick={fit}><LuScan size={15} /></IconBtn>
        </div>
        {!graph.nodes.length && <div style={s.empty}>Press + (or N) to add the first node</div>}
        <svg
          ref={svgRef} width="100%" height="100%" tabIndex={0} role="application" aria-label="Diagram nodes"
          viewBox={`${cam.x} ${cam.y} ${vw} ${vh}`} preserveAspectRatio="xMinYMin meet"
          style={{ display: 'block', outline: 'none', touchAction: 'none', cursor: drag?.moved ? 'crosshair' : pan?.moved ? 'grabbing' : 'grab', userSelect: 'none' }}
          onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { setDrag(null); setPan(null) }}
          onPointerDown={(ev) => {
            svgRef.current.focus()
            // Empty space, or the middle button anywhere: pan.
            if (ev.target === svgRef.current || ev.button === 1) { ev.preventDefault(); startPan(ev) }
          }}
        >
          {edges.map(({ e, i, L, pts, body, taper, heads, dash, label }) => {
            const on = selected?.type === 'edge' && selected.i === i
            const col = L.stroke
            return (
              <g key={`e${i}`} onPointerDown={(ev) => { if (ev.button !== 0) return; ev.stopPropagation(); svgRef.current.focus(); select({ type: 'edge', i }) }}
                onDoubleClick={() => select({ type: 'edge', i }, true)} style={{ cursor: 'pointer', ...dim(focus?.links.has(i)) }}>
                <polyline points={pairs(pts)} fill="none" stroke="transparent" strokeWidth={14 / cam.z} />
                {/* selected: a soft accent halo under the line, so its own colour still shows */}
                {on && <polyline points={pairs(pts)} fill="none" stroke={accent} strokeOpacity={0.35} strokeWidth={L.strokeWidth + 6} strokeLinejoin="round" strokeLinecap="round" />}
                {taper
                  ? <polygon points={pairs(taper)} fill={col} stroke={col} strokeWidth={1.5} strokeLinejoin="round" />
                  : <polyline points={pairs(body)} fill="none" stroke={col} strokeWidth={L.strokeWidth} strokeDasharray={dash || undefined} strokeLinejoin="round" strokeLinecap="round" />}
                {heads.map((h, k) => (h.shape === 'circle'
                  ? <circle key={k} cx={h.cx} cy={h.cy} r={h.r} fill={h.filled ? col : 'var(--bg-primary)'} stroke={col} strokeWidth={L.strokeWidth} />
                  : h.closed
                    ? <polygon key={k} points={pairs(h.pts)} fill={h.filled ? col : 'var(--bg-primary)'} stroke={col} strokeWidth={h.filled ? 1 : L.strokeWidth} strokeLinejoin="round" />
                    : <polyline key={k} points={pairs(h.pts)} fill="none" stroke={col} strokeWidth={L.strokeWidth} strokeLinejoin="round" strokeLinecap="round" />))}
                {label && (
                  <g>
                    <rect x={label.x} y={label.y} width={label.w} height={label.h} rx={label.h / 2} fill="var(--bg-surface)" stroke={col} strokeWidth={1} />
                    <text x={label.x + label.w / 2} y={label.y + label.h / 2} textAnchor="middle" dominantBaseline="central" fontSize={LABEL_FONT}
                      fill={colors.text} style={{ fontFamily: fontCss() }}>{e.label}</text>
                  </g>
                )}
              </g>
            )
          })}
          {shown.map((n) => {
            const on = selected?.type === 'node' && selected.key === n.key
            const target = drag?.over === n.key
            const lines = (n.text || '').split('\n')
            const radius = n.round === 'pill' ? n.h / 2 : n.round === 'some' ? 10 : 0
            // A box from the board looks as it does there; a new one as Insert will make it.
            const p = n.itemId ? byId.get(n.itemId)?.payload : null
            const look = p ? { fill: p.fill || 'transparent', stroke: p.stroke || colors.stroke, text: p.textColor || colors.text, font: fontCss(p) }
              : { ...colors, font: fontCss() }
            const h = anchor({ x: 0, y: 0, w: n.w, h: n.h }, out)
            const hx = h.x + (out === 'e' ? 16 : 0), hy = h.y + (out === 's' ? 16 : 0)
            const showHandle = !drag && !pan?.moved && (hover === n.key || on)
            return (
              <g key={n.key} transform={`translate(${n.x} ${n.y})`}
                onPointerEnter={() => setHover(n.key)} onPointerLeave={() => setHover((k) => (k === n.key ? null : k))}
                onPointerDown={(ev) => { if (ev.button !== 0) return; ev.stopPropagation(); svgRef.current.focus(); select({ type: 'node', key: n.key }) }}
                onDoubleClick={() => select({ type: 'node', key: n.key }, true)} style={{ cursor: 'pointer', ...dim(focus?.nodes.has(n.key) || target) }}>
                {/* a margin round the box, so the handle stays reachable */}
                <rect x={-6} y={-6} width={n.w + 12 + (out === 'e' ? 22 : 0)} height={n.h + 12 + (out === 's' ? 22 : 0)} fill="transparent" />
                <path d={shapeOutline(n.kind, n.w, n.h, radius)} fill={target ? 'color-mix(in srgb, var(--accent-warning) 18%, transparent)' : look.fill}
                  stroke={on || target ? accent : look.stroke} strokeWidth={on ? 2.5 : 2} strokeLinejoin="round" />
                <text x={n.w / 2} y={n.h / 2 - ((lines.length - 1) * 16 * 1.25) / 2} textAnchor="middle" dominantBaseline="central" fontSize={16}
                  fill={n.label ? look.text : 'var(--text-muted)'} style={{ pointerEvents: 'none', fontFamily: look.font }}>
                  {n.label ? lines.map((l, k) => <tspan key={k} x={n.w / 2} dy={k ? 16 * 1.25 : 0}>{l}</tspan>) : 'Untitled'}
                </text>
                {showHandle && (
                  <g style={{ cursor: 'crosshair' }} onPointerDown={(ev) => startHandle(ev, n.key)}>
                    <title>Click for the next step · drag onto another node to link them</title>
                    <circle cx={hx} cy={hy} r={HANDLE_R} fill={accent} />
                    <path d={`M${hx - 4.5} ${hy}h9M${hx} ${hy - 4.5}v9`} stroke="var(--bg-primary)" strokeWidth={2} strokeLinecap="round" />
                  </g>
                )}
              </g>
            )
          })}
          {drag?.moved && (() => {
            const a = shownAt.get(drag.from)
            if (!a) return null
            const p = anchor(a, out)
            return <line x1={p.x} y1={p.y} x2={drag.at.x} y2={drag.at.y} stroke={accent} strokeWidth={2} strokeDasharray="6 5" pointerEvents="none" />
          })()}
        </svg>
      </div>

      <div style={s.side}>
        {selNode && (
          <>
            <span style={s.label}>Node</span>
            <textarea
              ref={labelRef} rows={2} style={s.input} value={selNode.label} placeholder="What happens here?" spellCheck={false} data-sb-noedit="true"
              onChange={(ev) => onChange(updateNode(graph, selNode.key, { label: ev.target.value }))}
              onKeyDown={(ev) => {
                // Type, Tab, type, Tab — the same rhythm as on the board.
                if (ev.key === 'Tab' && !ev.shiftKey) { ev.preventDefault(); next(selNode.key) }
                else if (ev.key === 'Enter' && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey) { ev.preventDefault(); svgRef.current?.focus() }
              }}
            />
            <div style={s.row}>
              <IconBtn title="Add the next step — a new node linked after this one (Tab)" onClick={() => next(selNode.key)}><NextStepIcon size={18} /></IconBtn>
              <IconBtn title="Delete node (Del)" danger onClick={del}><LuTrash2 size={17} /></IconBtn>
            </div>
            {selLaid && (
              <>
                <span style={s.label}>Arrange</span>
                <div style={s.arrangeRow}>
                  <span style={s.arrangeLabel}>Family</span>
                  {graph.dir === 'right' ? (
                    <>
                      <IconBtn size={30} title="Move this family up (Alt+↑)" disabled={selLaid.family === 0} onClick={() => moveFam(-1)}><LuChevronUp size={16} /></IconBtn>
                      <IconBtn size={30} title="Move this family down (Alt+↓)" disabled={selLaid.family >= laid.families - 1} onClick={() => moveFam(1)}><LuChevronDown size={16} /></IconBtn>
                    </>
                  ) : (
                    <>
                      <IconBtn size={30} title="Move this family left (Alt+←)" disabled={selLaid.family === 0} onClick={() => moveFam(-1)}><LuChevronLeft size={16} /></IconBtn>
                      <IconBtn size={30} title="Move this family right (Alt+→)" disabled={selLaid.family >= laid.families - 1} onClick={() => moveFam(1)}><LuChevronRight size={16} /></IconBtn>
                    </>
                  )}
                  <span style={{ ...s.note, marginLeft: 6 }}>{selLaid.family + 1} of {laid.families}</span>
                </div>
                <div style={s.arrangeRow}>
                  <span style={s.arrangeLabel}>Level</span>
                  <IconBtn size={30} title={`Lower — further along the flow (Alt+${graph.dir === 'right' ? '→' : '↓'})`} disabled={!selLaid.canLower} onClick={() => lower(1)}>
                    {graph.dir === 'right' ? <LuArrowRight size={16} /> : <LuArrowDown size={16} />}
                  </IconBtn>
                  <IconBtn size={30} title={`Raise — back toward its parent (Alt+${graph.dir === 'right' ? '←' : '↑'})`} disabled={!selLaid.canRaise} onClick={() => lower(-1)}>
                    {graph.dir === 'right' ? <LuArrowLeft size={16} /> : <LuArrowUp size={16} />}
                  </IconBtn>
                  {selLaid.lowered > 0 && <span style={{ ...s.note, marginLeft: 6 }}>{selLaid.lowered} lower</span>}
                </div>
                {selLaid.hasKids && <p style={s.note}>Has children, so it stays directly above them.</p>}
                {!selLaid.hasKids && !selLaid.canLower && !selLaid.canRaise && <p style={s.note}>Already at its family's deepest level.</p>}
              </>
            )}
            <span style={s.label}>Shape · {kindLabel(selNode.kind)}</span>
            {NODE_GROUPS.map((g) => (
              <div key={g.id}>
                <div style={s.group}>{g.label}</div>
                <div style={s.grid}>
                  {g.kinds.map((k) => (
                    <IconBtn key={k} size={32} title={kindLabel(k)} active={selNode.kind === k}
                      onClick={() => onChange(updateNode(graph, selNode.key, { kind: k, round: roundFor(k) }))}>
                      <ShapeThumb kind={k} size={20} />
                    </IconBtn>
                  ))}
                </div>
              </div>
            ))}
            {!hasTextForm(selNode.kind) && <p style={s.help}>The Text tab writes this shape as a plain [box]; it stays a {kindLabel(selNode.kind).toLowerCase()} unless you change that line.</p>}
          </>
        )}
        {selEdge && (
          <>
            <span style={s.label}>Link</span>
            <input
              ref={labelRef} style={s.input} value={selEdge.label || ''} placeholder="Label, e.g. yes" spellCheck={false} data-sb-noedit="true"
              onChange={(ev) => onChange(updateEdge(graph, selected.i, { label: ev.target.value || null }))}
              onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); svgRef.current?.focus() } }}
            />
            <div style={s.row}>
              <IconBtn title="Reverse direction — the link runs the other way" onClick={() => onChange(reverseEdge(graph, selected.i))}><LuArrowRightLeft size={17} /></IconBtn>
              <IconBtn title="Delete link (Del)" danger onClick={del}><LuTrash2 size={17} /></IconBtn>
            </div>
            <LinkControls look={linkLook(selEdge, colors.stroke)} onPatch={(patch) => onChange(styleLinks(graph, selected.i, patch))} />
          </>
        )}
        {!selNode && !selEdge && (
          <p style={s.note}>
            Select a node or a link to edit it{graph.nodes.length ? '' : ' — start with Root node'}. The <LuCircleHelp size={12} style={{ verticalAlign: '-2px' }} /> button
            (top right) shows how everything works.
          </p>
        )}
        {!selNode && !selEdge && graph.edges.length > 0 && (
          <>
            <span style={s.label}>All links</span>
            <p style={s.note}>Sets every link at once — e.g. straight or curved branches instead of elbows. Select one link to style just that one.</p>
            <LinkControls look={linkLook(graph.edges[0], colors.stroke)} onPatch={(patch) => onChange(styleLinks(graph, 'all', patch))} />
          </>
        )}
      </div>
    </div>
  )
}

export default NodeEditor
