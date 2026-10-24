import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { parseFlow } from './flowText'

// Type (or paste) a flowchart as text and get it laid out on the board. The
// syntax is Mermaid's flowchart subset, so a diagram from an AI chat, a README
// or a wiki drops straight in.
//
// Styled like ShortcutsModal — same backdrop, card and type scale.

const EXAMPLE = `flowchart TD
  A([Start]) --> B[Fill in the form]
  B --> C{Valid?}
  C -->|yes| D[Save]
  C -->|no| E[Show the error]
  E --> B
  D --> F([Done])`

const s = {
  backdrop: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal: {
    width: 'min(640px, 92vw)', maxHeight: '86vh', display: 'flex', flexDirection: 'column',
    background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
  },
  header: { padding: '18px 22px 12px', borderBottom: '1px solid var(--border-default)', display: 'flex', alignItems: 'baseline', gap: 10 },
  title: { fontFamily: 'var(--font-heading)', fontSize: 20, fontWeight: 500, color: 'var(--text-primary)' },
  sub: { fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.14em', textTransform: 'uppercase', marginLeft: 'auto' },
  body: { padding: '14px 22px 18px', display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' },
  help: { fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 },
  code: { fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-primary)', background: 'var(--bg-elevated)', borderRadius: 4, padding: '1px 5px' },
  area: {
    minHeight: 220, resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.5,
    color: 'var(--text-primary)', background: 'var(--bg-primary)', border: '1px solid var(--border-default)', borderRadius: 8, padding: 12, outline: 'none',
  },
  foot: { display: 'flex', alignItems: 'center', gap: 10 },
  status: { fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.04em' },
  btn: { background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-default)', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 13 },
  primary: { background: 'var(--accent-warning)', color: 'var(--bg-primary)', border: 'none', borderRadius: 8, padding: '7px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
}

function FlowTextModal({ isOpen, onClose, onInsert }) {
  const [text, setText] = useState('')
  const areaRef = useRef(null)

  useEffect(() => { if (isOpen) setTimeout(() => areaRef.current?.focus(), 0) }, [isOpen])

  // Live read-back, so a typo shows up before Insert rather than after.
  const status = useMemo(() => {
    if (!text.trim()) return null
    try {
      const { graph, problems } = parseFlow(text)
      const what = `${graph.nodes.length} box${graph.nodes.length === 1 ? '' : 'es'}, ${graph.edges.length} arrow${graph.edges.length === 1 ? '' : 's'}`
      return problems.length ? { ok: true, msg: `${what} · ${problems.length} line(s) skipped` } : { ok: true, msg: what }
    } catch (e) {
      return { ok: false, msg: e.message }
    }
  }, [text])

  if (!isOpen) return null

  const insert = () => {
    if (!status?.ok) return
    if (onInsert(text) !== false) { setText(''); onClose() }
  }

  return createPortal(
    <div style={s.backdrop} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={s.modal} role="dialog" aria-label="Diagram from text">
        <div style={s.header}>
          <span style={s.title}>Diagram from text</span>
          <span style={s.sub}>Ctrl+Enter to insert</span>
        </div>
        <div style={s.body}>
          <p style={s.help}>
            One step per line: <span style={s.code}>A[Box] --&gt; B{'{'}Question?{'}'}</span>, a label on an
            arrow with <span style={s.code}>--&gt;|yes|</span>. Shapes: <span style={s.code}>[box]</span>{' '}
            <span style={s.code}>(rounded)</span> <span style={s.code}>{'{'}decision{'}'}</span>{' '}
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
              e.stopPropagation()
              if (e.key === 'Escape') { e.preventDefault(); onClose() }
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); insert() }
              // Tab indents rather than leaving the box — this is code-ish text.
              if (e.key === 'Tab') {
                e.preventDefault()
                const el = e.currentTarget, a = el.selectionStart
                setText(text.slice(0, a) + '  ' + text.slice(el.selectionEnd))
                requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = a + 2 })
              }
            }}
          />
          <div style={s.foot}>
            <span style={{ ...s.status, color: status ? (status.ok ? 'var(--text-muted)' : 'var(--accent-danger, #e05c5c)') : 'var(--text-muted)' }}>
              {status ? status.msg : 'Empty — the grey text is an example'}
            </span>
            <span style={{ marginLeft: 'auto' }} />
            <button style={s.btn} onClick={() => setText(EXAMPLE)}>Use example</button>
            <button style={s.btn} onClick={onClose}>Cancel</button>
            <button style={{ ...s.primary, opacity: status?.ok ? 1 : 0.5 }} disabled={!status?.ok} onClick={insert}>Insert</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default FlowTextModal
