import { HEAD_TYPES, HEAD_LABELS } from '../connectors/heads'
import { LINE_STYLES } from '../connectors/lineStyle'
import { LINK_PALETTE, ROUTINGS, LINE_GLYPH, HEAD_GLYPH } from '../connectors/controls'
import { CustomColor } from '../Toolbar/ColorMenu'
import { fontCss } from '../text/textStyle'

// A link's look in the node editor's side panel: the same choices as the
// floating bar's connector row (route, both ends, line, tapered, width,
// colour), laid out as a column. Used for one link, or for every link at once.

const s = {
  row: { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  label: { fontSize: 12.5, color: 'var(--text-secondary)', width: 52, flexShrink: 0, fontFamily: fontCss() },
  select: {
    flex: 1, minWidth: 0, height: 30, fontSize: 12.5, color: 'var(--text-primary)', background: 'var(--bg-primary)',
    border: '1px solid var(--border-default)', borderRadius: 6, padding: '0 6px', fontFamily: fontCss(),
  },
  // The palette spread across the panel: 8 a row, each swatch centred in its cell.
  swatches: { display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', rowGap: 10, justifyItems: 'center', margin: '2px 0 4px' },
  swatch: { width: 24, height: 24, borderRadius: '50%', padding: 0, border: 'none', cursor: 'pointer' },
  value: { fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-primary)', minWidth: 22, textAlign: 'center' },
}

function Btn({ active, title, onClick, children, w = 34 }) {
  return (
    <button
      type="button" title={title} aria-label={title} aria-pressed={active || undefined} onClick={onClick}
      style={{
        width: w, height: 30, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: 6, fontSize: w > 40 ? 12.5 : 15, fontFamily: fontCss(),
        border: `1px solid ${active ? 'var(--accent-warning)' : 'var(--border-default)'}`,
        background: active ? 'color-mix(in srgb, var(--accent-warning) 16%, transparent)' : 'var(--bg-surface)',
        color: active ? 'var(--accent-warning)' : 'var(--text-secondary)',
      }}
    >{children}</button>
  )
}

const HeadSelect = ({ value, onChange, title }) => (
  <select style={s.select} value={value} title={title} aria-label={title} onChange={(e) => onChange(e.target.value)}>
    {HEAD_TYPES.map((h) => <option key={h} value={h}>{HEAD_GLYPH[h]} {HEAD_LABELS[h]}</option>)}
  </select>
)

/** `look` is the effective look (linkLook); `onPatch` gets the fields to change. */
function LinkControls({ look, onPatch }) {
  const tapered = look.body === 'tapered'
  return (
    <>
      <div style={s.row}>
        <span style={s.label}>Route</span>
        {ROUTINGS.map((r) => (
          <Btn key={r.v} active={look.routing === r.v} title={r.title}
            // Leaving straight drops the taper, as on the floating bar.
            onClick={() => onPatch(r.v === 'straight' ? { routing: r.v } : { routing: r.v, body: null })}>{r.label}</Btn>
        ))}
      </div>
      {look.routing !== 'elbow' && !tapered && (
        <div style={s.row}>
          <span style={s.label}>Boxes</span>
          <Btn w={92} active={!look.avoid} title="Go straight to the other end, even through boxes" onClick={() => onPatch({ avoid: null })}>Go direct</Btn>
          <Btn w={92} active={look.avoid} title="Take the shortest way round any box in the way" onClick={() => onPatch({ avoid: true })}>Go around</Btn>
        </div>
      )}
      <div style={s.row}>
        <span style={s.label}>Start</span>
        <HeadSelect value={look.headStart} title="Start of line" onChange={(v) => onPatch({ headStart: v })} />
      </div>
      <div style={s.row}>
        <span style={s.label}>End</span>
        <HeadSelect value={look.head} title="End of line" onChange={(v) => onPatch({ head: v })} />
      </div>
      <div style={s.row}>
        <span style={s.label}>Line</span>
        {LINE_STYLES.map((ls) => (
          <Btn key={ls} active={look.lineStyle === ls} title={ls[0].toUpperCase() + ls.slice(1)} onClick={() => onPatch({ lineStyle: ls })}>{LINE_GLYPH[ls]}</Btn>
        ))}
        <Btn active={tapered} title="Tapered arrow" onClick={() => onPatch({ body: tapered ? null : 'tapered' })}>
          <svg width="22" height="12" viewBox="0 0 22 12" aria-hidden="true"><path d="M1 5.6 L15 4.4 L15 1 L21 6 L15 11 L15 7.6 L1 6.4 Z" fill="currentColor" /></svg>
        </Btn>
      </div>
      <div style={s.row}>
        <span style={s.label}>Width</span>
        <Btn w={28} title="Thinner" onClick={() => onPatch({ strokeWidth: Math.max(1, look.strokeWidth - 1) })}>−</Btn>
        <span style={s.value}>{look.strokeWidth}</span>
        <Btn w={28} title="Thicker" onClick={() => onPatch({ strokeWidth: Math.min(12, look.strokeWidth + 1) })}>+</Btn>
      </div>
      <div style={s.swatches}>
        {LINK_PALETTE.map((c) => {
          const on = c.toLowerCase() === String(look.stroke).slice(0, 7).toLowerCase()
          return (
            <button key={c} type="button" title={c} aria-label={c} aria-pressed={on} onClick={() => onPatch({ stroke: c })}
              style={{ ...s.swatch, backgroundColor: c, boxShadow: on ? '0 0 0 2px rgb(18, 18, 30), 0 0 0 4px var(--accent-warning)' : '0 0 0 1px rgba(255, 255, 255, 0.16)' }} />
          )
        })}
      </div>
      <CustomColor value={look.stroke} onPick={(c) => onPatch({ stroke: c })} />
    </>
  )
}

export default LinkControls
