import { useSettings } from '../../contexts/SettingsContext'
import { LuRotateCcw } from 'react-icons/lu'
import styles from './SettingsPopup.module.css'
import SegmentedControl from './SegmentedControl'

// A focused subset of the main SettingsPopup, opened from the NotePage kebab
// menu. All controls write to the same underlying settings via useSettings(),
// so values stay in sync with the main Settings popup automatically.
function NoteSettingsPopup({ isOpen, onClose }) {
  const { settings, updateSetting } = useSettings()

  if (!isOpen) return null

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2>Note Settings</h2>
          <button onClick={onClose} className={styles.closeBtn}>&times;</button>
        </div>

        <div className={styles.body}>
          <div className={styles.content}>

            <SettingRow
              label="Note Editor Width"
              description="Maximum width of the writing surface on note pages."
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="range"
                  className={styles.starSlider}
                  min={700}
                  max={1600}
                  step={20}
                  value={settings.noteEditorWidth ?? 1200}
                  onChange={e => updateSetting('noteEditorWidth', parseInt(e.target.value, 10))}
                />
                <span style={{ minWidth: 56, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)', fontSize: 13 }}>
                  {settings.noteEditorWidth ?? 1200}px
                </span>
                <button
                  type="button"
                  onClick={() => updateSetting('noteEditorWidth', 1200)}
                  title="Reset to default (1200px)"
                  aria-label="Reset note editor width"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: 4,
                    cursor: 'pointer',
                    color: 'var(--text-secondary)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <LuRotateCcw size={14} />
                </button>
              </div>
            </SettingRow>

            {/* Book-layout controls — only relevant while the note is laid out as
                a book. Wording and options are kept identical to the main
                Settings popup; both write the same keys, so a change here shows
                up there and vice versa. */}
            {settings.noteLayout === 'book' && (
              <>
              <SettingRow
                label="Page Height"
                description="Height of a page in book layout."
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="range"
                    className={styles.starSlider}
                    min={360}
                    max={900}
                    step={20}
                    value={settings.bookPageHeight ?? 620}
                    onChange={e => updateSetting('bookPageHeight', parseInt(e.target.value, 10))}
                  />
                  <span style={{ minWidth: 56, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)', fontSize: 13 }}>
                    {settings.bookPageHeight ?? 620}px
                  </span>
                  <button
                    type="button"
                    onClick={() => updateSetting('bookPageHeight', 620)}
                    title="Reset to default (620px)"
                    aria-label="Reset page height"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      padding: 4,
                      cursor: 'pointer',
                      color: 'var(--text-secondary)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <LuRotateCcw size={14} />
                  </button>
                </div>
              </SettingRow>

              <SettingRow
                label="Page Breaks"
                description="Continue lets text carry on mid-sentence onto the next page. Keep whole never splits a paragraph or table, so pages can end early."
              >
                <SegmentedControl
                  options={[
                    { value: 'continue', label: 'Continue' },
                    { value: 'keep', label: 'Keep whole' },
                  ]}
                  value={settings.bookBreaks ?? 'continue'}
                  onChange={(v) => updateSetting('bookBreaks', v)}
                />
              </SettingRow>

              <SettingRow
                label="Page Turn"
                description="How turning to the next spread animates."
              >
                <SegmentedControl
                  options={[
                    { value: 'fade', label: 'Fade' },
                    { value: 'instant', label: 'Instant' },
                  ]}
                  value={settings.bookTurn ?? 'fade'}
                  onChange={(v) => updateSetting('bookTurn', v)}
                />
              </SettingRow>
              </>
            )}

          </div>
        </div>
      </div>
    </div>
  )
}

function SettingRow({ label, description, children }) {
  return (
    <div className={styles.settingRow}>
      <div className={styles.settingInfo}>
        <span className={styles.settingLabel}>{label}</span>
        {description && <span className={styles.settingDesc}>{description}</span>}
      </div>
      <div className={styles.settingControl}>{children}</div>
    </div>
  )
}

function ToggleSwitch({ checked, onChange }) {
  return (
    <button
      className={`${styles.toggle} ${checked ? styles.toggleOn : ''}`}
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
    >
      <span className={styles.toggleThumb} />
    </button>
  )
}

export default NoteSettingsPopup
