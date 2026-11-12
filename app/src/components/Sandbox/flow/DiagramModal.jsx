import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LuX } from 'react-icons/lu'
import NodeEditor from './NodeEditor'
import { emptyGraph, graphToText, textToGraph } from './flowGraph'
import { fontCss } from '../text/textStyle'

// "Diagram": build a flowchart by hand (Nodes) or as Mermaid text (Text), then
// lay it on the board. Opened on a selected diagram, it edits that one and
// Update changes it in place.
//
// The two tabs are two views of one graph. Switching to Text writes the graph
// out; switching back reads the text in only if it was edited, so a round trip
// you didn't touch loses nothing (board-only shapes, ids, styles).
//
// Styled like ShortcutsModal — same backdrop, card and type scale.

const EXAMPLE = `flowchart TD
  A([Start]) --> B[Fill in the form]
  B --> C{Valid?}
  C -->|yes| D[Save]
  C -->|no| E[Show the error]
  E --> B
  D --> F([Done])`

const TAB_KEY = 'siddran_sandbox_diagram_tab'
const rememberedTab = () => { try { return localStorage.getItem(TAB_KEY) === 'text' ? 'text' : 'nodes' } catch { return 'nodes' } }

const s = {
  backdrop: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal: {
    width: 'min(1000px, 94vw)', height: 'min(680px, 88vh)', display: 'flex', flexDirection: 'column',
    background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
  },
  header: { padding: '14px 18px 0 22px', borderBottom: '1px solid var(--border-default)', display: 'flex', alignItems: 'flex-end', gap: 18 },
  title: { fontFamily: 'var(--font-heading)', fontSize: 20, fontWeight: 500, color: 'var(--text-primary)', paddingBottom: 10 },
  tabs: { display: 'flex', gap: 2 },
  tab: (on) => ({
    background: 'transparent', border: 'none', borderBottom: `2px solid ${on ? 'var(--accent-warning)' : 'transparent'}`,
    color: on ? 'var(--text-primary)' : 'var(--text-muted)', padding: '6px 12px 9px', cursor: 'pointer', fontSize: 13, fontWeight: on ? 600 : 400,
  }),
  sub: { fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.14em', textTransform: 'uppercase', marginLeft: 'auto', paddingBottom: 12 },
  close: { background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, marginBottom: 8, display: 'inline-flex' },
  body: { padding: '14px 22px 18px', display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minHeight: 0 },
  help: { fontFamily: fontCss(), fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 },
  code: { fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-primary)', background: 'var(--bg-elevated)', borderRadius: 4, padding: '1px 5px' },
  area: {
    flex: 1, minHeight: 160, resize: 'none', fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.5,
    color: 'var(--text-primary)', background: 'var(--bg-primary)', border: '1px solid var(--border-default)', borderRadius: 8, padding: 12, outline: 'none',
  },
  foot: { display: 'flex', alignItems: 'center', gap: 10 },
  status: { fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.04em' },
  btn: { background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-default)', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 13 },
  primary: { background: 'var(--accent-warning)', color: 'var(--bg-primary)', border: 'none', borderRadius: 8, padding: '7px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
}

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`

/**
 * `source` — null for a new diagram, or { graph, origin, scope } for one opened
 * from the board. `onApply(graph)` lays it down (returns false to stay open).
 */
function DiagramModal({ isOpen, onClose, source, onApply, byId, colors }) {
  const [tab, setTab] = useState('nodes')
  const [graph, setGraph] = useState(emptyGraph)
  const [text, setText] = useState('')
  const [textFrom, setTextFrom] = useState('')   // the text as last written from the graph
  const [selected, setSelected] = useState(null)
  const [focusReq, setFocusReq] = useState(0)
  const [touched, setTouched] = useState(false)
  const areaRef = useRef(null)
  const modalRef = useRef(null)
  const primaryRef = useRef(null)

  // A fresh start each time it opens.
  useEffect(() => {
    if (!isOpen) return
    const g = source?.graph || emptyGraph()
    const t = source ? 'nodes' : rememberedTab()
    setGraph(g); setSelected(null); setTouched(false)
    const written = g.nodes.length ? graphToText(g) : ''
    setText(written); setTextFrom(written); setTab(t)
  }, [isOpen, source])

  useEffect(() => { if (isOpen && tab === 'text') setTimeout(() => areaRef.current?.focus(), 0) }, [isOpen, tab])

  // If focus ever slips out of the pop-up (onto the page behind), its keys
  // still work: Esc closes, Ctrl+Enter applies, and anything else pulls focus
  // back in — never Ctrl+A selecting the whole page, or a key reaching the board.
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e) => {
      const box = modalRef.current
      if (!box || box.contains(e.target)) return
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); primaryRef.current?.click(); return }
      e.preventDefault()
      ;(box.querySelector('svg[tabindex]') || box).focus()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [isOpen, onClose])

  const textEdited = text !== textFrom
  // Live read-back of the text, so a typo shows up before Insert rather than after.
  const parsed = useMemo(() => {
    if (!textEdited || !text.trim()) return null
    try { return { ok: true, ...textToGraph(text, graph) } }
    catch (e) { return { ok: false, msg: e.message } }
  }, [text, textEdited, graph])

  if (!isOpen) return null

  // The graph Insert / Update would use right now.
  const current = tab === 'text' && textEdited ? (parsed?.ok ? parsed.graph : null) : graph
  const ready = !!current && current.nodes.length > 0

  const edit = (g) => { setGraph(g); setTouched(true) }
  const select = (sel, focus) => { setSelected(sel); if (focus) setFocusReq((n) => n + 1) }

  const switchTab = (t) => {
    if (t === tab) return
    if (t === 'text') {
      const written = graph.nodes.length ? graphToText(graph) : text
      setText(written); setTextFrom(written)
    } else if (textEdited) {
      if (text.trim() && !parsed?.ok) return   // stay put; the status line says why
      if (parsed?.ok) { setGraph(parsed.graph); setTouched(true) }
      setTextFrom(text)
      setSelected(null)
    }
    setTab(t)
    if (!source) { try { localStorage.setItem(TAB_KEY, t) } catch { /* not remembered */ } }
  }

  const apply = () => {
    if (!ready) return
    if (onApply(current) !== false) onClose()
  }

  const dirty = touched || textEdited
  const status = tab === 'text'
    ? (!text.trim() ? { ok: true, msg: 'Empty — the grey text is an example' }
      : !textEdited ? { ok: true, msg: `${count(graph.nodes.length, 'box', 'boxes')}, ${count(graph.edges.length, 'arrow', 'arrows')}` }
        : parsed.ok ? { ok: true, msg: `${count(parsed.graph.nodes.length, 'box', 'boxes')}, ${count(parsed.graph.edges.length, 'arrow', 'arrows')}${parsed.problems.length ? ` · ${parsed.problems.length} line(s) skipped` : ''}` }
          : { ok: false, msg: parsed.msg })
    : { ok: true, msg: `${count(graph.nodes.length, 'node', 'nodes')}, ${count(graph.edges.length, 'link', 'links')}` }

  return createPortal(
    <div
      style={s.backdrop}
      // Keys stay in here: Delete in the editor must not delete the board's selection.
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') { e.preventDefault(); onClose() }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); apply() }
      }}
      // A stray click outside shouldn't throw away a diagram in progress.
      onClick={(e) => { if (e.target === e.currentTarget && !dirty) onClose() }}
    >
      <div ref={modalRef} tabIndex={-1} style={{ ...s.modal, outline: 'none' }} role="dialog" aria-label={source ? 'Edit diagram' : 'Diagram'}>
        <div style={s.header}>
          <span style={s.title}>{source ? 'Edit diagram' : 'Diagram'}</span>
          <div style={s.tabs} role="tablist">
            <button role="tab" aria-selected={tab === 'nodes'} style={s.tab(tab === 'nodes')} onClick={() => switchTab('nodes')}>Nodes</button>
            <button role="tab" aria-selected={tab === 'text'} style={s.tab(tab === 'text')} onClick={() => switchTab('text')}>Text</button>
          </div>
          <span style={s.sub}>Ctrl+Enter to {source ? 'update' : 'insert'}</span>
          <button style={s.close} title="Close (Esc)" aria-label="Close" onClick={onClose}><LuX size={18} /></button>
        </div>
        <div style={s.body}>
          {tab === 'nodes' ? (
            <NodeEditor graph={graph} onChange={edit} selected={selected} onSelect={select} byId={byId} colors={colors} focusReq={focusReq} />
          ) : (
            <>
              <p style={s.help}>
                One step per line: <span style={s.code}>A[Box] --&gt; B{'{'}Question?{'}'}</span>, a label on an
                arrow with <span style={s.code}>--&gt;|yes|</span>. Shapes: <span style={s.code}>[box]</span>{' '}
                <span style={s.code}>(rounded)</span> <span style={s.code}>([start / end])</span> <span style={s.code}>{'{'}decision{'}'}</span>{' '}
                <span style={s.code}>((circle))</span> <span style={s.code}>[(database)]</span>{' '}
                <span style={s.code}>[/input/]</span>. Start with <span style={s.code}>flowchart LR</span> to run it sideways.
                Mermaid from anywhere pastes straight in.
              </p>
              <textarea
                ref={areaRef}
                style={s.area}
                value={text}
                placeholder={EXAMPLE}
                spellCheck={false}
                data-sb-noedit="true"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  // Tab indents rather than leaving the box — this is code-ish text.
                  if (e.key === 'Tab') {
                    e.preventDefault()
                    const el = e.currentTarget, a = el.selectionStart
                    setText(text.slice(0, a) + '  ' + text.slice(el.selectionEnd))
                    requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = a + 2 })
                  }
                }}
              />
            </>
          )}
          <div style={s.foot}>
            <span style={{ ...s.status, color: status.ok ? 'var(--text-muted)' : 'var(--accent-danger, #e05c5c)' }}>{status.msg}</span>
            <span style={{ marginLeft: 'auto' }} />
            {tab === 'text' && !source && <button style={s.btn} onClick={() => setText(EXAMPLE)}>Use example</button>}
            <button style={s.btn} onClick={onClose}>Cancel</button>
            <button ref={primaryRef} style={{ ...s.primary, opacity: ready ? 1 : 0.5 }} disabled={!ready} onClick={apply}>{source ? 'Update' : 'Insert'}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default DiagramModal
