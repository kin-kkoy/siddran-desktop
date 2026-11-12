import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { TEMPLATES } from './templates'
import { shapePath } from '../../../utils/diagramSvg'
import { connectorPoints } from '../connectors/geometry'
import { STICKY_DEFAULT } from '../text/textStyle'

// Pick a starter template. Styled like FlowTextModal / ShortcutsModal — same
// backdrop, card and type scale. Each card shows a small vector preview built
// from the template's own items, so the picture is always what you'll get.

const s = {
  backdrop: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal: {
    width: 'min(860px, 94vw)', maxHeight: '88vh', display: 'flex', flexDirection: 'column',
    background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
  },
  header: { padding: '18px 22px 12px', borderBottom: '1px solid var(--border-default)', display: 'flex', alignItems: 'center', gap: 12 },
  title: { fontFamily: 'var(--font-heading)', fontSize: 20, fontWeight: 500, color: 'var(--text-primary)' },
  search: {
    marginLeft: 'auto', width: 220, height: 30, padding: '0 10px', fontSize: 13, color: 'var(--text-primary)',
    background: 'var(--bg-primary)', border: '1px solid var(--border-default)', borderRadius: 8, outline: 'none',
  },
  body: { padding: 18, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 14 },
  card: {
    display: 'flex', flexDirection: 'column', gap: 6, padding: 10, textAlign: 'left', cursor: 'pointer',
    background: 'var(--bg-primary)', border: '1px solid var(--border-default)', borderRadius: 10, color: 'var(--text-primary)',
  },
  thumb: { width: '100%', height: 110, borderRadius: 6, background: 'var(--bg-elevated)', display: 'block' },
  name: { fontSize: 13, fontWeight: 600 },
  cat: { fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)' },
  desc: { fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4 },
  empty: { gridColumn: '1 / -1', color: 'var(--text-muted)', fontSize: 13, padding: 20, textAlign: 'center' },
}

let seq = 0
const previewIds = () => () => `p${++seq}`

/** Tiny SVG of a template: frames, stickies, shapes, connectors; text as bars. */
function Preview({ template }) {
  const items = useMemo(() => template.build({ newId: previewIds(), style: { stroke: '#cfcbe6' } }), [template])
  const boxed = items.filter(i => i.type !== 'connector')
  if (!boxed.length) return <div style={s.thumb} />
  const minX = Math.min(...boxed.map(i => i.x)), minY = Math.min(...boxed.map(i => i.y))
  const maxX = Math.max(...boxed.map(i => i.x + i.w)), maxY = Math.max(...boxed.map(i => i.y + i.h))
  const pad = 30
  const vb = `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`
  const byId = new Map(items.map(i => [i.id, i]))
  const ordered = [
    ...items.filter(i => i.payload?.kind === 'frame'),
    ...items.filter(i => i.type === 'connector'),
    ...items.filter(i => i.type !== 'connector' && i.payload?.kind !== 'frame'),
  ]
  return (
    <svg viewBox={vb} style={s.thumb} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {ordered.map(it => {
        const p = it.payload || {}
        if (p.kind === 'frame') {
          return (
            <g key={it.id}>
              <rect x={it.x} y={it.y} width={it.w} height={it.h} rx={4} fill="rgba(150,150,180,0.12)" stroke="rgba(170,170,200,0.45)" strokeWidth={3} />
              <rect x={it.x} y={it.y - 26} width={Math.min(it.w * 0.5, 140)} height={14} rx={4} fill="rgba(170,170,200,0.45)" />
            </g>
          )
        }
        if (p.kind === 'sticky') return <rect key={it.id} x={it.x} y={it.y} width={it.w} height={it.h} rx={3} fill={p.fill || STICKY_DEFAULT} />
        if (it.type === 'text') return <rect key={it.id} x={it.x} y={it.y + it.h * 0.2} width={Math.min(it.w, (p.text || '').length * p.fontSize * 0.55)} height={p.fontSize * 0.7} rx={3} fill="rgba(220,215,240,0.55)" />
        if (it.type === 'connector') {
          const pts = connectorPoints(it, byId)
          if (!pts) return null
          const d = []
          for (let i = 0; i < pts.length; i += 2) d.push(`${pts[i]},${pts[i + 1]}`)
          return <polyline key={it.id} points={d.join(' ')} fill="none" stroke="#cfcbe6" strokeWidth={3} opacity={0.7} />
        }
        if (it.type === 'shape') {
          if (p.kind === 'line') return <line key={it.id} x1={it.x} y1={it.y} x2={it.x + it.w} y2={it.y + it.h} stroke="#cfcbe6" strokeWidth={3} strokeDasharray="10 8" opacity={0.6} />
          const path = p.kind === 'ellipse'
            ? null
            : (p.kind === 'rect' || p.kind === 'roundedRect') ? null : shapePath(p.kind, it.w, it.h, p.radius)
          return (
            <g key={it.id} transform={`translate(${it.x} ${it.y})`}>
              {p.kind === 'ellipse'
                ? <ellipse cx={it.w / 2} cy={it.h / 2} rx={it.w / 2} ry={it.h / 2} fill="none" stroke="#cfcbe6" strokeWidth={3} />
                : path
                  ? <path d={path} fill="none" stroke="#cfcbe6" strokeWidth={3} />
                  : <rect width={it.w} height={it.h} rx={p.kind === 'roundedRect' ? 10 : 0} fill="none" stroke="#cfcbe6" strokeWidth={3} />}
            </g>
          )
        }
        return null
      })}
    </svg>
  )
}

function TemplatesModal({ isOpen, onClose, onInsert }) {
  const [q, setQ] = useState('')
  useEffect(() => { if (!isOpen) setQ('') }, [isOpen])
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [isOpen, onClose])

  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return TEMPLATES
    return TEMPLATES.filter(x => `${x.name} ${x.category} ${x.description}`.toLowerCase().includes(t))
  }, [q])

  if (!isOpen) return null
  return createPortal(
    <div style={s.backdrop} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={s.modal} role="dialog" aria-label="Templates">
        <div style={s.header}>
          <span style={s.title}>Templates</span>
          <input
            style={s.search} placeholder="Search templates" value={q} autoFocus
            data-sb-noedit="true" aria-label="Search templates"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && list[0]) { onInsert(list[0]); onClose() } }}
          />
        </div>
        <div style={s.body}>
          {list.map(t => (
            <button key={t.id} style={s.card} onClick={() => { onInsert(t); onClose() }} title={`Insert ${t.name}`}>
              <Preview template={t} />
              <span style={s.cat}>{t.category}</span>
              <span style={s.name}>{t.name}</span>
              <span style={s.desc}>{t.description}</span>
            </button>
          ))}
          {list.length === 0 && <div style={s.empty}>No template matches “{q}”.</div>}
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default TemplatesModal
