import styles from './RecurrencePicker.module.css'

const PRESETS = [
    { value: 'every-day', label: 'Every day' },
    { value: 'weekdays',  label: 'Weekdays' },
    { value: 'weekends',  label: 'Weekends' },
]
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] // index 0 = Sunday
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// preset string → 7-bool mask (index 0 = Sunday), used when switching to Custom.
function presetToMask(value) {
    if (value === 'weekdays') return [false, true, true, true, true, true, false]
    if (value === 'weekends') return [true, false, false, false, false, false, true]
    return [true, true, true, true, true, true, true] // every-day / fallback
}

// Weekday-mask recurrence picker. `value` is a preset string ('every-day'|'weekdays'|'weekends')
// or a custom mask object { mask: [7 booleans] }. onChange receives the same shape. The stored
// form (TEXT preset or JSON mask) is produced server-side via normalizeRecurrence.
export default function RecurrencePicker({ value, onChange }) {
    const isCustom = typeof value === 'object' && Array.isArray(value?.mask)
    const mask = isCustom ? value.mask : null

    const toCustom = () => onChange({ mask: presetToMask(typeof value === 'string' ? value : 'every-day') })
    const toggleDay = (i) => {
        const base = mask || presetToMask('every-day')
        onChange({ mask: base.map((b, idx) => (idx === i ? !b : b)) })
    }

    return (
        <div className={styles.wrap}>
            <div className={styles.presets}>
                {PRESETS.map(p => (
                    <button
                        key={p.value}
                        type="button"
                        className={`${styles.preset} ${value === p.value ? styles.on : ''}`}
                        onClick={() => onChange(p.value)}
                    >{p.label}</button>
                ))}
                <button
                    type="button"
                    className={`${styles.preset} ${isCustom ? styles.on : ''}`}
                    onClick={toCustom}
                >Custom</button>
            </div>

            {isCustom && (
                <div className={styles.days}>
                    {DAY_LETTERS.map((d, i) => (
                        <button
                            key={i}
                            type="button"
                            className={`${styles.day} ${mask[i] ? styles.dayOn : ''}`}
                            onClick={() => toggleDay(i)}
                            title={DAY_NAMES[i]}
                        >{d}</button>
                    ))}
                </div>
            )}
        </div>
    )
}
