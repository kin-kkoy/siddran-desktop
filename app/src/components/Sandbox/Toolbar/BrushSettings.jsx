import styles from './BrushSettings.module.css'

/**
 * Compact brush popup — floats just left of the toolbar's pen button and is
 * mounted only while the pen tool is active. Vertical slider so it stays narrow,
 * with a live size readout, a dot preview, a reset, and a minimize button that
 * collapses it to a single pill.
 *
 * Strokes IN PROGRESS use the values snapshotted at pointerdown, so dragging a
 * slider mid-stroke doesn't tear; new strokes pick up the new value. `size` and
 * `smoothing` are the two tunable knobs — `smoothing` maps to perfect-freehand's
 * `streamline`. Remaining feel knobs live in strokeOutline.js's per-device profiles.
 */
function BrushSettings({ brush, onChange, onReset, collapsed = false, onCollapsedChange }) {
    const preview = Math.min(28, Math.max(3, brush.size))

    if (collapsed) {
        return (
            <button
                className={styles.pill}
                onClick={() => onCollapsedChange?.(false)}
                title="Brush size"
                aria-label="Open brush size"
            >
                {brush.size.toFixed(1)}
            </button>
        )
    }

    const smoothing = brush.smoothing ?? 0.6

    return (
        <div className={styles.panel}>
            <button className={styles.collapseBtn} onClick={() => onCollapsedChange?.(true)} title="Minimize" aria-label="Minimize">−</button>

            <span className={styles.value}>{brush.size.toFixed(1)}</span>
            <div className={styles.dotWrap}>
                <span className={styles.dot} style={{ width: preview, height: preview }} />
            </div>
            <input
                className={styles.slider}
                type="range"
                min={1} max={20} step={0.5}
                value={brush.size}
                onChange={(e) => onChange({ size: parseFloat(e.target.value) })}
                aria-label="Brush size"
            />
            <span className={styles.label}>size</span>

            <div className={styles.groupDivider} />

            <span className={styles.value}>{Math.round(smoothing * 100)}</span>
            <input
                className={styles.slider}
                type="range"
                min={0} max={1} step={0.05}
                value={smoothing}
                onChange={(e) => onChange({ smoothing: parseFloat(e.target.value) })}
                aria-label="Stroke smoothing"
            />
            <span className={styles.label}>smooth</span>

            <button className={styles.resetBtn} onClick={onReset} title="Reset brush" aria-label="Reset">↺</button>
        </div>
    )
}

export default BrushSettings
