import { useRef, useState } from 'react'
import { LuBold, LuItalic, LuUnderline, LuStrikethrough, LuEraser, LuAlignLeft, LuAlignCenter, LuAlignRight } from 'react-icons/lu'
import styles from '../../Table.module.css'
import Popover from '../../Popover'
import { FONT_FAMILIES } from '../../../text/textStyle'
import { PEN_COLORS, HIGHLIGHTER_COLORS } from '../../../ink/presets'

/**
 * Fonts for the selected cells, like a text box's: family, bold, italic,
 * underline, strike, text colour, fill, size and alignment. Always in the
 * table's toolbar (so nothing jumps when a selection starts), dimmed until
 * cells are selected. `cur` is the look of the selection's active cell;
 * `apply(patch)` styles the whole selection (null clears it).
 */
const TEXT_COLORS = PEN_COLORS.filter(c => c !== '#e2ddf5')
const SCALE_MIN = 0.6, SCALE_MAX = 2.4

export default function StyleBar({ cur, enabled, apply, label }) {
    const [menu, setMenu] = useState(null)   // 'color' | 'bg'
    const colorRef = useRef(null), bgRef = useRef(null)
    const s = cur || {}
    const scale = s.scale || 1
    const toggle = (k) => apply({ [k]: !s[k] })
    const step = (d) => {
        const n = Math.round(Math.max(SCALE_MIN, Math.min(SCALE_MAX, scale + d)) * 10) / 10
        apply({ scale: n === 1 ? null : n })
    }
    const btn = (on, title, onClick, icon) => (
        <button className={`${styles.styleBtn} ${on ? styles.styleOn : ''}`} disabled={!enabled} title={title} aria-label={title} aria-pressed={!!on} onClick={onClick}>{icon}</button>
    )
    return (
        <div className={`${styles.styleBar} ${enabled ? '' : styles.styleBarOff}`} role="toolbar" aria-label={label}
            // Buttons here don't take the focus, so the grid keeps its selection keys (the font list still opens).
            onMouseDown={(e) => { if (e.target.tagName !== 'SELECT') e.preventDefault() }}>
            <select className={styles.styleSelect} disabled={!enabled} value={s.fontFamily || ''} aria-label="Font"
                title="Font" onChange={(e) => apply({ fontFamily: e.target.value || null })}>
                <option value="">Font</option>
                {Object.entries(FONT_FAMILIES).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
            </select>
            {btn(s.bold, 'Bold (Ctrl+B)', () => toggle('bold'), <LuBold size="1em" />)}
            {btn(s.italic, 'Italic (Ctrl+I)', () => toggle('italic'), <LuItalic size="1em" />)}
            {btn(s.underline, 'Underline (Ctrl+U)', () => toggle('underline'), <LuUnderline size="1em" />)}
            {btn(s.strike, 'Strikethrough', () => toggle('strike'), <LuStrikethrough size="1em" />)}
            <button ref={colorRef} className={styles.styleBtn} disabled={!enabled} title="Text colour" aria-label="Text colour" onClick={() => setMenu(m => m === 'color' ? null : 'color')}>
                <span className={styles.colorA} style={{ borderBottomColor: s.color || 'var(--text-primary)' }}>A</span>
            </button>
            <button ref={bgRef} className={styles.styleBtn} disabled={!enabled} title="Fill" aria-label="Fill" onClick={() => setMenu(m => m === 'bg' ? null : 'bg')}>
                <span className={styles.fillSwatch} style={{ background: s.bg ? `color-mix(in srgb, ${s.bg} 45%, transparent)` : undefined }} />
            </button>
            <button className={styles.styleBtn} disabled={!enabled || scale <= SCALE_MIN} title="Smaller" aria-label="Smaller text" onClick={() => step(-0.1)}>−</button>
            <span className={styles.styleScale} title="Text size in these cells">{Math.round(scale * 100)}%</span>
            <button className={styles.styleBtn} disabled={!enabled || scale >= SCALE_MAX} title="Bigger" aria-label="Bigger text" onClick={() => step(0.1)}>+</button>
            {btn(s.textAlign === 'left', 'Align left', () => apply({ textAlign: s.textAlign === 'left' ? null : 'left' }), <LuAlignLeft size="1em" />)}
            {btn(s.textAlign === 'center', 'Align centre', () => apply({ textAlign: s.textAlign === 'center' ? null : 'center' }), <LuAlignCenter size="1em" />)}
            {btn(s.textAlign === 'right', 'Align right', () => apply({ textAlign: s.textAlign === 'right' ? null : 'right' }), <LuAlignRight size="1em" />)}
            {btn(false, 'Clear formatting', () => apply(null), <LuEraser size="1em" />)}
            {menu && (
                <Popover anchor={menu === 'color' ? colorRef : bgRef} width={196} onClose={() => setMenu(null)} label={menu === 'color' ? 'Text colour' : 'Fill'}>
                    <div className={styles.swatches}>
                        <button className={`${styles.swatch} ${styles.swatchNone}`} title="Default" aria-label="Default"
                            onClick={() => { apply({ [menu]: null }); setMenu(null) }} />
                        {(menu === 'color' ? TEXT_COLORS : HIGHLIGHTER_COLORS).map(c => (
                            <button key={c} className={styles.swatch} title={c} aria-label={c}
                                style={{ background: menu === 'bg' ? `color-mix(in srgb, ${c} 45%, transparent)` : c }}
                                onClick={() => { apply({ [menu]: c }); setMenu(null) }} />
                        ))}
                    </div>
                </Popover>
            )}
        </div>
    )
}
