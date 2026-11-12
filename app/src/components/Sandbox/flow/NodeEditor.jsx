import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { LuPlus, LuTrash2, LuArrowRightLeft, LuArrowDown, LuArrowRight, LuCornerRightDown, LuMoveRight, LuMinus } from 'react-icons/lu'
import { layoutFor, addNode, addNext, connect, updateNode, removeNode, updateEdge, removeEdge, reverseEdge, kindOf, NODE_KINDS } from './flowGraph'
import { shapeOutline } from './svgPath'
import { routeConnector, labelBox, LABEL_FONT } from '../connectors/geometry'
import { headGeometry, pathEnds } from '../connectors/heads'
import { fontCss } from '../text/textStyle'

// The Nodes tab: build a flowchart by hand, without writing any text.
//
// The drawing IS the preview. Positions come from the same layered layout that
// the board's text-to-diagram and Tidy use, so nothing is dragged into place: add a
// node, drag from one of its dots onto another node to link them (or onto
// empty space for a new linked node), and the diagram re-flows as you go.
// Insert lays it on the board exactly as drawn here.

const PAD = 48
const PORT_R = 6
const SIDES = ['n', 'e', 's', 'w']

const anchor = (n, side) => ({
  n: { x: n.x + n.w / 2, y: n.y }, s: { x: n.x + n.w / 2, y: n.y + n.h },
  e: { x: n.x + n.w, y: n.y + n.h / 2 }, w: { x: n.x, y: n.y + n.h / 2 },
}[side])

const pairs = (pts) => { const out = []; for (let i = 0; i < pts.length; i += 2) out.push(`${pts[i]},${pts[i + 1]}`); return out.join(' ') }

const s = {
  wrap: { display: 'flex', flex: 1, minHeight: 0, gap: 12 },
  stage: { position: 'relative', flex: 1, minWidth: 0, background: 'var(--bg-primary)', border: '1px solid var(--border-default)', borderRadius: 8, overflow: 'hidden' },
  bar: { position: 'absolute', top: 8, left: 8, display: 'flex', gap: 4, zIndex: 1 },
  side: { fontFamily: fontCss(), width: 236, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' },
  label: { fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.14em', textTransform: 'uppercase' },
  input: {
    width: '100%', boxSizing: 'border-box', fontSize: 13, color: 'var(--text-primary)', background: 'var(--bg-primary)',
    border: '1px solid var(--border-default)', borderRadius: 6, padding: '7px 9px', outline: 'none', fontFamily: 'inherit', resize: 'vertical',
  },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 },
  row: { display: 'flex', gap: 4, flexWrap: 'wrap' },
  help: { fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.55, margin: 0 },
  kbd: { fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-primary)', background: 'var(--bg-elevated)', borderRadius: 4, padding: '0 4px' },
  empty: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13, pointerEvents: 'none' },
}

function IconBtn({ active, title, onClick, children, danger }) {
  return (
    <button
      type="button" title={title} aria-label={title} aria-pressed={active || undefined} onClick={onClick}
      style={{
        width: 34, height: 34, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: 7,
        border: `1px solid ${active ? 'var(--accent-warning)' : 'var(--border-default)'}`,
        background: active ? 'color-mix(in srgb, var(--accent-warning) 16%, transparent)' : 'var(--bg-surface)',
        color: danger ? 'var(--accent-danger, #e05c5c)' : active ? 'var(--accent-warning)' : 'var(--text-secondary)',
      }}
    >{children}</button>
  )
}

/** A node kind's outline, as a small picker icon. */
function KindIcon({ kind, round }) {
  const w = kind === 'ellipse' || kind === 'rhombus' ? 22 : 24, h = kind === 'cylinder' ? 20 : 15
  const r = round === 'pill' ? h / 2 : round === 'some' ? 3.5 : 0
  return (
    <svg width={26} height={22} viewBox={`-1 -1 ${w + 2} ${h + 2}`} aria-hidden="true" style={{ overflow: 'visible' }}>
      <path d={shapeOutline(kind, w, h, r)} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" />
    </svg>
  )
}

function NodeEditor({ graph, onChange, selected, onSelect, byId, colors, focusReq }) {
  const svgRef = useRef(null)
  const stageRef = useRef(null)
  const labelRef = useRef(null)
  const [size, setSize] = useState({ w: 600, h: 400 })
  const [hover, setHover] = useState(null)
  const [drag, setDrag] = useState(null)   // { from, side, at: {x,y}, over }

  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const laid = useMemo(() => layoutFor(graph, { byId }), [graph, byId])
  const nodeAt = useMemo(() => new Map(laid.nodes.map((n) => [n.key, n])), [laid])

  // Fit the drawing in the stage, never larger than life (a two-box diagram
  // should not fill the window with giant boxes).
  const view = useMemo(() => {
    const ns = laid.nodes
    const minX = ns.length ? Math.min(...ns.map((n) => n.x)) : 0, minY = ns.length ? Math.min(...ns.map((n) => n.y)) : 0
    const maxX = ns.length ? Math.max(...ns.map((n) => n.x + n.w)) : 0, maxY = ns.length ? Math.max(...ns.map((n) => n.y + n.h)) : 0
    const w = Math.max(maxX - minX + PAD * 2, size.w), h = Math.max(maxY - minY + PAD * 2 + 40, size.h)
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2 + 20
    return { x: cx - w / 2, y: cy - h / 2, w, h }
  }, [laid, size])

  const edges = useMemo(() => graph.edges.map((e, i) => {
    const a = nodeAt.get(e.from), b = nodeAt.get(e.to), sd = laid.sides[i]
    if (!a || !b || !sd) return null
    const pts = routeConnector(anchor(a, sd[0]), anchor(b, sd[1]), 'elbow', {
      fromSide: sd[0], toSide: sd[1], fromBox: a, toBox: b,
      // Round the other boxes, as the board routes it.
      obstacles: () => laid.nodes.filter((n) => n !== a && n !== b),
    })
    const end = pathEnds(pts)?.end
    return { e, i, pts, head: e.head && end ? headGeometry('arrow', end.tip, end.prev, 2) : null, label: e.label ? labelBox(pts, e.label) : null }
  }).filter(Boolean), [graph.edges, nodeAt, laid])

  const selNode = selected?.type === 'node' ? graph.nodes.find((n) => n.key === selected.key) : null
  const selEdge = selected?.type === 'edge' ? graph.edges[selected.i] : null

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
  const hitNode = (pt) => laid.nodes.find((n) => pt.x >= n.x - 8 && pt.x <= n.x + n.w + 8 && pt.y >= n.y - 8 && pt.y <= n.y + n.h + 8)

  const select = (sel, focus = false) => onSelect(sel, focus)
  const add = () => {
    const like = selNode && kindOf(selNode) ? { kind: selNode.kind, round: selNode.round } : {}
    const { graph: g, key } = addNode(graph, like)
    onChange(g); select({ type: 'node', key }, true)
  }
  const next = (from) => { const { graph: g, key } = addNext(graph, from); onChange(g); select({ type: 'node', key }, true) }
  const del = () => {
    if (selNode) { onChange(removeNode(graph, selNode.key)); select(null) }
    else if (selEdge) { onChange(removeEdge(graph, selected.i)); select(null) }
  }

  const startPort = (ev, key, side) => {
    ev.stopPropagation(); ev.preventDefault()
    svgRef.current.setPointerCapture?.(ev.pointerId)
    setDrag({ from: key, side, at: world(ev), over: null })
  }
  const onMove = (ev) => {
    if (!drag) return
    const at = world(ev)
    const over = hitNode(at)
    setDrag({ ...drag, at, over: over && over.key !== drag.from ? over.key : null })
  }
  const onUp = (ev) => {
    if (!drag) return
    const at = world(ev)
    const target = hitNode(at)
    const from = drag.from
    setDrag(null)
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
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && selected) { ev.preventDefault(); del() }
    else if (ev.key === 'Tab' && selNode) { ev.preventDefault(); next(selNode.key) }
    else if (ev.key === 'Enter' && selected) { ev.preventDefault(); labelRef.current?.focus(); labelRef.current?.select() }
    else if ((ev.key === 'n' || ev.key === 'N') && !ev.ctrlKey && !ev.metaKey) { ev.preventDefault(); add() }
  }

  const showPorts = (key) => hover === key || selected?.key === key || drag?.from === key
  const accent = 'var(--accent-warning)'

  return (
    <div style={s.wrap} onKeyDown={onKey}>
      <div ref={stageRef} style={s.stage}>
        <div style={s.bar}>
          <IconBtn title="Add a node (N)" onClick={add}><LuPlus size={17} /></IconBtn>
          <IconBtn title="Top to bottom" active={graph.dir !== 'right'} onClick={() => onChange({ ...graph, dir: 'down' })}><LuArrowDown size={17} /></IconBtn>
          <IconBtn title="Left to right" active={graph.dir === 'right'} onClick={() => onChange({ ...graph, dir: 'right' })}><LuArrowRight size={17} /></IconBtn>
        </div>
        {!graph.nodes.length && <div style={s.empty}>Press + (or N) to add the first node</div>}
        <svg
          ref={svgRef} width="100%" height="100%" tabIndex={0} role="application" aria-label="Diagram nodes"
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} preserveAspectRatio="xMidYMid meet"
          style={{ display: 'block', outline: 'none', touchAction: 'none', cursor: drag ? 'crosshair' : 'default', userSelect: 'none' }}
          onPointerMove={onMove} onPointerUp={onUp}
          onPointerDown={(ev) => { svgRef.current.focus(); if (ev.target === svgRef.current) select(null) }}
        >
          {edges.map(({ e, i, pts, head, label }) => {
            const on = selected?.type === 'edge' && selected.i === i
            const col = on ? accent : colors.stroke
            return (
              <g key={`e${i}`} onPointerDown={(ev) => { ev.stopPropagation(); svgRef.current.focus(); select({ type: 'edge', i }) }}
                onDoubleClick={() => select({ type: 'edge', i }, true)} style={{ cursor: 'pointer' }}>
                <polyline points={pairs(pts)} fill="none" stroke="transparent" strokeWidth={14} />
                <polyline points={pairs(pts)} fill="none" stroke={col} strokeWidth={on ? 2.5 : 2} strokeDasharray={e.dashed ? '8 6' : undefined} strokeLinejoin="round" />
                {head && <polygon points={pairs(head.pts)} fill={col} />}
                {label && (
                  <g>
                    <rect x={label.x} y={label.y} width={label.w} height={label.h} rx={label.h / 2} fill="var(--bg-surface)" stroke={col} strokeWidth={1} />
                    <text x={label.x + label.w / 2} y={label.y + label.h / 2} textAnchor="middle" dominantBaseline="central" fontSize={LABEL_FONT} fill={colors.text} style={{ fontFamily: fontCss() }}>{e.label}</text>
                  </g>
                )}
              </g>
            )
          })}
          {laid.nodes.map((n) => {
            const on = selected?.type === 'node' && selected.key === n.key
            const target = drag?.over === n.key
            const lines = (n.text || '').split('\n')
            const radius = n.round === 'pill' ? n.h / 2 : n.round === 'some' ? 10 : 0
            // A box from the board looks as it does there; a new one as Insert will make it.
            const p = n.itemId ? byId.get(n.itemId)?.payload : null
            const look = p ? { fill: p.fill || 'transparent', stroke: p.stroke || colors.stroke, text: p.textColor || colors.text, font: fontCss(p) }
              : { ...colors, font: fontCss() }
            return (
              <g key={n.key} transform={`translate(${n.x} ${n.y})`}
                onPointerEnter={() => setHover(n.key)} onPointerLeave={() => setHover((h) => (h === n.key ? null : h))}
                onPointerDown={(ev) => { ev.stopPropagation(); svgRef.current.focus(); select({ type: 'node', key: n.key }) }}
                onDoubleClick={() => select({ type: 'node', key: n.key }, true)} style={{ cursor: 'pointer' }}>
                {/* a margin round the box, so the ports stay reachable from outside it */}
                <rect x={-14} y={-14} width={n.w + 28} height={n.h + 28} fill="transparent" />
                <path d={shapeOutline(n.kind, n.w, n.h, radius)} fill={target ? 'color-mix(in srgb, var(--accent-warning) 18%, transparent)' : look.fill}
                  stroke={on || target ? accent : look.stroke} strokeWidth={on ? 2.5 : 2} strokeLinejoin="round" />
                <text x={n.w / 2} y={n.h / 2 - ((lines.length - 1) * 16 * 1.25) / 2} textAnchor="middle" dominantBaseline="central" fontSize={16}
                  fill={n.label ? look.text : 'var(--text-muted)'} style={{ pointerEvents: 'none', fontFamily: look.font }}>
                  {n.label ? lines.map((l, k) => <tspan key={k} x={n.w / 2} dy={k ? 16 * 1.25 : 0}>{l}</tspan>) : 'Untitled'}
                </text>
                {showPorts(n.key) && SIDES.map((sd) => {
                  const p = anchor({ x: 0, y: 0, w: n.w, h: n.h }, sd)
                  return (
                    <circle key={sd} cx={p.x} cy={p.y} r={PORT_R} fill="var(--bg-surface)" stroke={accent} strokeWidth={2}
                      style={{ cursor: 'crosshair' }} onPointerDown={(ev) => startPort(ev, n.key, sd)}>
                      <title>Drag to another node to link — or to empty space for a new one</title>
                    </circle>
                  )
                })}
              </g>
            )
          })}
          {drag && (() => {
            const a = nodeAt.get(drag.from)
            if (!a) return null
            const p = anchor(a, drag.side)
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
            <span style={s.label}>Kind</span>
            <div style={s.grid}>
              {NODE_KINDS.map((k) => (
                <IconBtn key={k.id} title={k.label} active={kindOf(selNode)?.id === k.id}
                  onClick={() => onChange(updateNode(graph, selNode.key, { kind: k.kind, round: k.round }))}>
                  <KindIcon kind={k.kind} round={k.round} />
                </IconBtn>
              ))}
            </div>
            {!kindOf(selNode) && <p style={s.help}>A board shape the text form has no name for; it stays as it is.</p>}
            <div style={s.row}>
              <IconBtn title="Next step — a linked node after this one (Tab)" onClick={() => next(selNode.key)}><LuCornerRightDown size={17} /></IconBtn>
              <IconBtn title="Delete node (Del)" danger onClick={del}><LuTrash2 size={17} /></IconBtn>
            </div>
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
              <IconBtn title="Arrowhead" active={selEdge.head} onClick={() => onChange(updateEdge(graph, selected.i, { head: !selEdge.head }))}>
                {selEdge.head ? <LuMoveRight size={17} /> : <LuMinus size={17} />}
              </IconBtn>
              <IconBtn title="Dashed" active={selEdge.dashed} onClick={() => onChange(updateEdge(graph, selected.i, { dashed: !selEdge.dashed }))}>
                <svg width={18} height={18} viewBox="0 0 18 18" aria-hidden="true"><path d="M1 9h4M7 9h4M13 9h4" stroke="currentColor" strokeWidth={2} strokeLinecap="round" /></svg>
              </IconBtn>
              <IconBtn title="Reverse direction" onClick={() => onChange(reverseEdge(graph, selected.i))}><LuArrowRightLeft size={17} /></IconBtn>
              <IconBtn title="Delete link (Del)" danger onClick={del}><LuTrash2 size={17} /></IconBtn>
            </div>
          </>
        )}
        {!selNode && !selEdge && (
          <>
            <span style={s.label}>How</span>
            <p style={s.help}>
              <b>+</b> adds a node. Hover a node and drag from one of its dots onto another node to link them,
              or onto empty space for a new linked node.
            </p>
            <p style={s.help}>
              Click a node or link to edit it. <span style={s.kbd}>Tab</span> adds the next step,{' '}
              <span style={s.kbd}>Del</span> removes, <span style={s.kbd}>Enter</span> renames.
            </p>
            <p style={s.help}>The layout is automatic: it is the same one the board uses, so what you see here is what Insert puts down.</p>
          </>
        )}
      </div>
    </div>
  )
}

export default NodeEditor
