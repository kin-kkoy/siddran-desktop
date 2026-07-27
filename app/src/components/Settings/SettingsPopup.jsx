import { useState } from 'react'
import { useSettings, THEMES } from '../../contexts/SettingsContext'
import { DIRECTION_ANGLES } from '../Layout/StarCanvas/StarCanvas'
import { LuRotateCcw } from 'react-icons/lu'
import styles from './SettingsPopup.module.css'

function SettingsPopup() {
  const { settings, updateSetting, isSettingsOpen, closeSettings } = useSettings()
  const [activeTab, setActiveTab] = useState('interface')

  if (!isSettingsOpen) return null

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) closeSettings()
  }

  return (
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div className={styles.modal}>

        {/* Header */}
        <div className={styles.header}>
          <h2>Settings</h2>
          <button onClick={closeSettings} className={styles.closeBtn}>&times;</button>
        </div>

        {/* Body: sidebar + content */}
        <div className={styles.body}>

          {/* Tab sidebar */}
          <div className={styles.sidebar}>
            <button
              className={`${styles.tab} ${activeTab === 'interface' ? styles.tabActive : ''}`}
              onClick={() => setActiveTab('interface')}
            >
              Interface
            </button>
            <button
              className={`${styles.tab} ${activeTab === 'account' ? styles.tabActive : ''}`}
              onClick={() => setActiveTab('account')}
            >
              Account
            </button>
          </div>

          {/* Tab content */}
          <div className={styles.content}>
            {activeTab === 'interface' ? (
              <InterfaceTab settings={settings} updateSetting={updateSetting} />
            ) : (
              <div className={styles.placeholder}>To be implemented</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Interface Tab ──────────────────────────────────────────────────
function InterfaceTab({ settings, updateSetting }) {
  return (
    <div className={styles.tabContent}>

      {/* Theme selector */}
      <div className={styles.settingBlock}>
        <span className={styles.settingLabel}>Theme</span>
        <span className={styles.settingDesc}>Choose a color theme for the app</span>
        <div className={styles.themeGrid}>
          {Object.entries(THEMES).map(([key, theme]) => (
            <button
              key={key}
              className={`${styles.themeSwatch} ${settings.theme === key ? styles.themeSelected : ''}`}
              onClick={() => updateSetting('theme', key)}
              title={theme.name}
            >
              <span
                className={styles.swatchColor}
                style={{ backgroundColor: theme.hex || '#09090f' }}
              />
              <span className={styles.swatchLabel}>{theme.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Adapt theme — only shown for non-default themes */}
      {settings.theme !== 'default' && (
        <SettingRow
          label="Adapt Theme"
          description="When on, theme colors are adapted into dark shades. When off, the literal theme color is used."
        >
          <ToggleSwitch
            checked={settings.matchMode}
            onChange={(v) => updateSetting('matchMode', v)}
          />
        </SettingRow>
      )}

      {/* Contrast */}
      <SettingRow label="Contrast" description="Adjust border and text contrast levels">
        <SegmentedControl
          options={[
            { value: 'low', label: 'Low' },
            { value: 'high', label: 'High' },
          ]}
          value={settings.contrast}
          onChange={(v) => updateSetting('contrast', v)}
        />
      </SettingRow>

      {/* Background brightness — applies on every page */}
      <SettingRow
        label="Background Brightness"
        description="Lighten or darken the background on every page."
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="range"
            className={styles.starSlider}
            min={-20}
            max={20}
            step={2}
            value={settings.bgBrightness ?? 0}
            onChange={e => updateSetting('bgBrightness', parseInt(e.target.value, 10))}
          />
          <span style={{ minWidth: 56, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)', fontSize: 13 }}>
            {(settings.bgBrightness ?? 0) > 0 ? '+' : ''}{settings.bgBrightness ?? 0}
          </span>
          <button
            type="button"
            onClick={() => updateSetting('bgBrightness', 0)}
            title="Reset to default"
            aria-label="Reset background brightness"
            style={{ background: 'transparent', border: 'none', padding: 4, cursor: 'pointer', color: 'var(--text-muted)' }}
          >
            ⟲
          </button>
        </div>
      </SettingRow>

      {/* Note editor width */}
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

      {/* Remember per-note fold state */}
      <SettingRow
        label="Remember File/Note State"
        description="Keep collapsed headings, bullets and checklists folded per note across refreshes and read/edit modes."
      >
        <ToggleSwitch
          checked={settings.rememberNoteState === true}
          onChange={(v) => updateSetting('rememberNoteState', v)}
        />
      </SettingRow>

      {/* Center the calendar current-time line */}
      <SettingRow
        label="Center the current-time line"
        description="Open the Day/Week calendar scrolled so the current-time line sits centered in view."
      >
        <ToggleSwitch
          checked={settings.centerNowLine !== false}
          onChange={(v) => updateSetting('centerNowLine', v)}
        />
      </SettingRow>

      {/* Star canvas toggle */}
      <SettingRow
        label="Twinkling Stars"
        description="Show animated star particles in the background."
      >
        <ToggleSwitch
          checked={settings.showStars !== false}
          onChange={(v) => updateSetting('showStars', v)}
        />
      </SettingRow>

      {settings.showStars !== false && (
        <>
          <SettingRow
            label="Reduce Star Size"
            description="Use smaller base radius when spawning new stars."
          >
            <ToggleSwitch
              checked={settings.reduceStars === true}
              onChange={(v) => updateSetting('reduceStars', v)}
            />
          </SettingRow>
          <StarTuningBlock settings={settings} updateSetting={updateSetting} />
        </>
      )}

    </div>
  )
}

// ── Star tuning block ──────────────────────────────────────────────
const STAR_SLIDERS = [
  { key: 'starSize',         label: 'Size',          min: 0.2, max: 3,   step: 0.05, decimals: 2 },
  { key: 'starDriftSpeed',   label: 'Drift speed',   min: 0,   max: 5,   step: 0.1,  decimals: 1 },
  { key: 'starTwinkleSpeed', label: 'Twinkle speed', min: 0,   max: 4,   step: 0.05, decimals: 2 },
  { key: 'starTwinkleDepth', label: 'Twinkle depth', min: 0,   max: 3,   step: 0.05, decimals: 2 },
  { key: 'starCount',        label: 'Count',         min: 10,  max: 300, step: 5,    decimals: 0 },
]

const STAR_INFO = [
  { label: 'Size',          desc: 'Multiplies the radius of every star.' },
  { label: 'Drift speed',   desc: 'How fast stars glide. 0 = frozen in place.' },
  { label: 'Twinkle speed', desc: 'How quickly stars pulse in brightness.' },
  { label: 'Twinkle depth', desc: 'How much brightness varies. 0 = steady, higher = more dramatic.' },
  { label: 'Count',         desc: 'Total stars rendered. More = denser sky.' },
  { label: 'Direction',     desc: 'Direction all stars drift toward. Each star has a slight random offset so the field looks natural.' },
]

// Two rows of 4 arrows (top=upper directions, bottom=lower directions)
const DIR_ROWS = [
  ['↖', '↑', '↗', '→'],
  ['←', '↙', '↓', '↘'],
]

function StarTuningBlock({ settings, updateSetting }) {
  return (
    <div className={styles.starBlock}>
      <div className={styles.starBlockHeader}>
        <span className={styles.starBlockTitle}>Star Tuning</span>
        <div className={styles.infoWrap}>
          <span className={styles.infoBtn}>?</span>
          <div className={styles.infoTooltip}>
            {STAR_INFO.map(({ label, desc }) => (
              <div key={label} className={styles.infoRow}>
                <span className={styles.infoKey}>{label}</span>
                <span className={styles.infoDesc}>{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.starSliders}>
        {STAR_SLIDERS.map(({ key, label, min, max, step, decimals }) => (
          <div key={key} className={styles.starSliderRow}>
            <div className={styles.starSliderMeta}>
              <span className={styles.starSliderLabel}>{label}</span>
              <span className={styles.starSliderValue}>
                {(settings[key] ?? min).toFixed(decimals)}
              </span>
            </div>
            <input
              type="range"
              className={styles.starSlider}
              min={min} max={max} step={step}
              value={settings[key] ?? min}
              onChange={e => updateSetting(key, parseFloat(e.target.value))}
            />
          </div>
        ))}
      </div>

      <div className={styles.starDirLabel}>Direction</div>
      <div className={styles.starDirGrid}>
        {DIR_ROWS.map((row, ri) => (
          <div key={ri} className={styles.starDirRow}>
            {row.map(arrow => (
              <button
                key={arrow}
                className={`${styles.dirBtn} ${settings.starDirection === arrow ? styles.dirBtnActive : ''}`}
                onClick={() => updateSetting('starDirection', arrow)}
                title={arrow}
              >
                {arrow}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Reusable controls ──────────────────────────────────────────────
function SettingRow({ label, description, children }) {
  return (
    <div className={styles.settingRow}>
      <div className={styles.settingInfo}>
        <span className={styles.settingLabel}>{label}</span>
        {description && <span className={styles.settingDesc}>{description}</span>}
      </div>
      <div className={styles.settingControl}>
        {children}
      </div>
    </div>
  )
}

function SegmentedControl({ options, value, onChange }) {
  return (
    <div className={styles.segmented}>
      {options.map((opt) => (
        <button
          key={opt.value}
          className={`${styles.segmentBtn} ${value === opt.value ? styles.segmentActive : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
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

export default SettingsPopup
