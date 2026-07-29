import styles from './SettingsPopup.module.css'

// Shared by SettingsPopup and NoteSettingsPopup. Extracted so the two cannot
// drift apart: the note popup is a focused subset of the main one, and the same
// setting has to look and behave identically in both.
function SegmentedControl({ options, value, onChange }) {
  return (
    <div className={styles.segmented}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`${styles.segmentBtn} ${value === opt.value ? styles.segmentActive : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export default SegmentedControl
