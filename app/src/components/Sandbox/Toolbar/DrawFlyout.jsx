import { useRef, useState } from 'react'
import styles from './DrawFlyout.module.css'
import { Popover, ColorGrid } from './ColorMenu'
import { INK_TOOL_META } from '../ink/inkToolMeta'
import { PEN_COLORS, HIGHLIGHTER_COLORS, HIGHLIGHTER_OPACITY, DEFAULT_INK, presetGroupFor, withAlpha } from '../ink/presets'

const ORDER = ['pen', 'highlighter', 'smart', 'eraser', 'precisionEraser', 'lasso']

// Dot diameter for a preset circle — grows with thickness, fits a 30 px ring.
const dotSize = (size, group) => Math.round(Math.max(5, Math.min(22, group === 'highlighter' ? size * 0.55 : size * 1.4)))

function PresetEditor({ group, index, preset, onChange, onReset }) {
    const isHl = group === 'highlighter'
    const sizeRange = isHl ? [4, 64] : [1, 32]
    const preview = isHl ? withAlpha(preset.color, preset.opacity ?? HIGHLIGHTER_OPACITY.default) : preset.color
    return (
        <>
            <div className={styles.editorHead}>
                <span className={styles.editorTitle}>{isHl ? 'Highlighter' : 'Pen'} · preset {index + 1}</span>
                <button className={styles.resetBtn} onClick={onReset} title="Back to the default" aria-label="Reset preset">↺</button>
            </div>
            <svg className={styles.preview} viewBox="0 0 180 36" aria-hidden="true">
                <path d="M10 26 C 50 4, 90 34, 170 12" fill="none" stroke={preview}
                    strokeWidth={Math.min(30, preset.size)} strokeLinecap={isHl ? 'butt' : 'round'} />
            </svg>
            <label className={styles.row}>
                <span>Size</span>
                <input type="range" min={sizeRange[0]} max={sizeRange[1]} step={isHl ? 1 : 0.5} value={preset.size}
                    onChange={(e) => onChange({ size: parseFloat(e.target.value) })} aria-label="Size" />
                <span className={styles.val}>{preset.size}</span>
            </label>
            {isHl && (
                <label className={styles.row}>
                    <span>Opacity</span>
                    <input type="range" min={HIGHLIGHTER_OPACITY.min * 100} max={HIGHLIGHTER_OPACITY.max * 100} step={5}
                        value={Math.round((preset.opacity ?? HIGHLIGHTER_OPACITY.default) * 100)}
                        onChange={(e) => onChange({ opacity: Number(e.target.value) / 100 })} aria-label="Opacity" />
                    <span className={styles.val}>{Math.round((preset.opacity ?? HIGHLIGHTER_OPACITY.default) * 100)}%</span>
                </label>
            )}
            <label className={styles.row}>
                <span>Smooth</span>
                <input type="range" min={0} max={1} step={0.05} value={preset.smoothing ?? 0.6}
                    onChange={(e) => onChange({ smoothing: parseFloat(e.target.value) })} aria-label="Smoothing" />
                <span className={styles.val}>{Math.round((preset.smoothing ?? 0.6) * 100)}</span>
            </label>
            {/* The highlighter's see-through-ness is the opacity slider above, so
                its custom colour is a plain colour. */}
            <ColorGrid colors={isHl ? HIGHLIGHTER_COLORS : PEN_COLORS} value={preset.color}
                onPick={(c) => onChange({ color: c })} alpha={!isHl} />
        </>
    )
}

/**
 * The drawing tools' second column (Miro-style), beside the dock. Top to
 * bottom: the six ink tools, then — for the pen, highlighter and smart
 * drawing — three preset circles. Click a preset to use it; click the active
 * one again to edit its size, colour and smoothing.
 */
function DrawFlyout({ tool, onToolChange, ink, onSelectPreset, onPresetChange }) {
    const group = presetGroupFor(tool)
    const showPresets = tool === 'pen' || tool === 'highlighter' || tool === 'smart'
    const [editing, setEditing] = useState(null)   // preset index whose editor is open
    const presetRefs = [useRef(null), useRef(null), useRef(null)]
    const set = ink[group]

    const onPreset = (i) => {
        if (set.active === i) setEditing(e => (e === i ? null : i))
        else { onSelectPreset(group, i); setEditing(null) }
    }

    return (
        <div className={styles.flyout} role="toolbar" aria-label="Drawing tools">
            {ORDER.map(t => {
                const { label, key, Icon } = INK_TOOL_META[t]
                const title = key ? `${label} (${key})` : label
                return (
                    <button key={t} className={tool === t ? styles.btnActive : styles.btn}
                        onClick={() => { onToolChange(t); setEditing(null) }} title={title} aria-label={title} aria-pressed={tool === t}>
                        <Icon size={20} />
                    </button>
                )
            })}
            {showPresets && (
                <>
                    <div className={styles.divider} />
                    {set.presets.map((p, i) => {
                        const d = dotSize(p.size, group)
                        const fill = group === 'highlighter' ? withAlpha(p.color, Math.max(0.55, p.opacity ?? 0.35)) : p.color
                        const active = set.active === i
                        const title = active ? 'Edit this preset' : `Preset ${i + 1} — ${p.size} px`
                        return (
                            <button key={i} ref={presetRefs[i]} className={active ? styles.presetActive : styles.preset}
                                onClick={() => onPreset(i)} title={title} aria-label={title} aria-expanded={active && editing === i}>
                                <span className={group === 'highlighter' ? styles.presetBar : styles.presetDot}
                                    style={group === 'highlighter'
                                        ? { width: 20, height: Math.max(4, Math.round(d * 0.7)), backgroundColor: fill }
                                        : { width: d, height: d, backgroundColor: fill }} />
                            </button>
                        )
                    })}
                    {editing != null && (
                        <Popover open anchorRef={presetRefs[editing]} onClose={() => setEditing(null)} width={236} label="Edit preset">
                            <PresetEditor group={group} index={editing} preset={set.presets[editing]}
                                onChange={(patch) => onPresetChange(group, editing, patch)}
                                onReset={() => onPresetChange(group, editing, DEFAULT_INK[group].presets[editing])} />
                        </Popover>
                    )}
                </>
            )}
        </div>
    )
}

export default DrawFlyout
