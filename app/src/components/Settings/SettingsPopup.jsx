import { useEffect, useState } from 'react'
import { useSettings, THEMES } from '../../contexts/SettingsContext'
import { DIRECTION_ANGLES } from '../Layout/StarCanvas/StarCanvas'
import { LuRotateCcw, LuRefreshCw, LuPlay } from 'react-icons/lu'
import { syncNow } from '../../desktop/sync/client'
import { readSyncConfig, writeSyncConfig, readLastSync, writeLastSync } from '../../hooks/syncConfig'
import styles from './SettingsPopup.module.css'
import SegmentedControl from './SegmentedControl'
import { trustedPaths, forgetAllTrust, setTrusted } from '../../hooks/htmlTrust'
import { trayAvailable } from '../../desktop/tray'
import { ALARM_TONES, REMINDER_TONES, previewAlarm, playChime } from '../../utils/alarmSound'

function SettingsPopup() {
  // The active tab lives in context so the command palette can open Settings
  // straight to a section ("Settings: Sync").
  const { settings, updateSetting, isSettingsOpen, closeSettings, settingsTab, setSettingsTab } = useSettings()
  const activeTab = settingsTab
  const setActiveTab = setSettingsTab

  // Escape closes it, the same as every other modal in the app. Bound on window
  // rather than the panel so it works before anything inside has been focused,
  // and hooked before the early return so the hook order never changes.
  useEffect(() => {
    if (!isSettingsOpen) return
    const onKey = (e) => { if (e.key === 'Escape') closeSettings() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isSettingsOpen, closeSettings])

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
              className={`${styles.tab} ${activeTab === 'appearance' ? styles.tabActive : ''}`}
              onClick={() => setActiveTab('appearance')}
            >
              Appearance
            </button>
            <button
              className={`${styles.tab} ${activeTab === 'cards' ? styles.tabActive : ''}`}
              onClick={() => setActiveTab('cards')}
            >
              Cards
            </button>
            <button
              className={`${styles.tab} ${activeTab === 'editor' ? styles.tabActive : ''}`}
              onClick={() => setActiveTab('editor')}
            >
              Editor
            </button>
            <button
              className={`${styles.tab} ${activeTab === 'behaviour' ? styles.tabActive : ''}`}
              onClick={() => setActiveTab('behaviour')}
            >
              Behaviour
            </button>
            <button
              className={`${styles.tab} ${activeTab === 'reminders' ? styles.tabActive : ''}`}
              onClick={() => setActiveTab('reminders')}
            >
              Reminders
            </button>
            <button
              className={`${styles.tab} ${activeTab === 'pages' ? styles.tabActive : ''}`}
              onClick={() => setActiveTab('pages')}
            >
              HTML pages
            </button>
            <button
              className={`${styles.tab} ${activeTab === 'sync' ? styles.tabActive : ''}`}
              onClick={() => setActiveTab('sync')}
            >
              Sync
            </button>
          </div>

          {/* Tab content. Interface is the fallback, so an unrecognised tab
              (a stale value from the command palette, say) lands somewhere real
              rather than on a blank pane. */}
          <div className={styles.content}>
            {activeTab === 'sync' && <SyncTab />}
            {activeTab === 'cards' && <CardsTab settings={settings} updateSetting={updateSetting} />}
            {activeTab === 'editor' && <EditorTab settings={settings} updateSetting={updateSetting} />}
            {activeTab === 'behaviour' && <BehaviourTab settings={settings} updateSetting={updateSetting} />}
            {activeTab === 'pages' && <PagesTab settings={settings} updateSetting={updateSetting} />}
            {activeTab === 'reminders' && <RemindersTab settings={settings} updateSetting={updateSetting} />}
            {/* Appearance is the fallback, so a stale tab value (the command palette
                still opens 'interface') lands somewhere real rather than on a blank pane. */}
            {!['sync', 'cards', 'editor', 'behaviour', 'pages', 'reminders'].includes(activeTab) && (
              <AppearanceTab settings={settings} updateSetting={updateSetting} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Sync Tab ───────────────────────────────────────────────────────
// Manual push/pull against the sync Worker. Never automatic: sync is explicit, so it
// can't sit in the path of a keystroke. Config is device-local (hooks/syncConfig.js).
function SyncTab() {
  const [cfg, setCfg] = useState(readSyncConfig)
  const [status, setStatus] = useState({ state: 'idle', message: '' })
  const [lastSync, setLastSync] = useState(readLastSync)

  const save = (next) => { setCfg(next); writeSyncConfig(next) }

  const runSync = async () => {
    setStatus({ state: 'busy', message: 'Syncing…' })
    try {
      const res = await syncNow({ endpoint: cfg.endpoint, token: cfg.token })
      const when = new Date().toISOString()
      writeLastSync(when)
      setLastSync(when)
      const conflicts = res.conflicts?.length || 0
      setStatus({
        state: 'ok',
        message: res.firstPush
          ? 'Uploaded your vault for the first time.'
          : conflicts
            ? `Synced — ${conflicts} conflict${conflicts === 1 ? '' : 's'} resolved by most recent edit.`
            : 'Synced.',
      })
    } catch (e) {
      const map = {
        'no-bag': 'Open a Bag first.',
        'not-configured': 'Enter the endpoint and token above.',
        unauthorized: 'The server rejected that token.',
        'conflict-retry': 'The remote kept changing — try again.',
      }
      setStatus({ state: 'error', message: map[e?.code] || e?.message || 'Sync failed.' })
    }
  }

  const inputStyle = {
    width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 6,
    border: '1px solid var(--border-default)', background: 'var(--bg-elevated)',
    color: 'var(--text-primary)', font: 'inherit', fontSize: 13,
  }
  const statusColor = status.state === 'error' ? 'var(--accent-danger)'
    : status.state === 'ok' ? 'var(--accent-success)' : 'var(--text-muted)'

  return (
    <div className={styles.tabContent}>
      <div className={styles.settingBlock}>
        <span className={styles.settingLabel}>Sync endpoint</span>
        <span className={styles.settingDesc}>
          Your deployed sync Worker URL. Tasks and calendar events sync; notes and
          settings stay on this device.
        </span>
        <input
          style={inputStyle}
          type="text"
          placeholder="https://siddran-sync.<you>.workers.dev"
          value={cfg.endpoint}
          onChange={(e) => save({ ...cfg, endpoint: e.target.value.trim() })}
        />
      </div>

      <div className={styles.settingBlock}>
        <span className={styles.settingLabel}>Sync token</span>
        <span className={styles.settingDesc}>
          The secret you set with <code>wrangler secret put SYNC_TOKEN</code>. Stored
          on this device only — never written into your Bag.
        </span>
        <input
          style={inputStyle}
          type="password"
          placeholder="••••••••"
          value={cfg.token}
          onChange={(e) => save({ ...cfg, token: e.target.value.trim() })}
        />
      </div>

      <div className={styles.settingBlock}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            onClick={runSync}
            disabled={status.state === 'busy' || !cfg.endpoint || !cfg.token}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
              borderRadius: 6, border: '1px solid var(--border-strong)',
              background: 'var(--bg-elevated)', color: 'var(--text-primary)',
              font: 'inherit', fontSize: 13,
              cursor: status.state === 'busy' || !cfg.endpoint || !cfg.token ? 'default' : 'pointer',
              opacity: status.state === 'busy' || !cfg.endpoint || !cfg.token ? 0.55 : 1,
            }}
          >
            <LuRefreshCw size={14} /> {status.state === 'busy' ? 'Syncing…' : 'Sync now'}
          </button>
          {status.message && (
            <span style={{ fontSize: 12.5, color: statusColor }}>{status.message}</span>
          )}
        </div>
        <span className={styles.settingDesc} style={{ marginTop: 8 }}>
          {lastSync ? `Last synced ${new Date(lastSync).toLocaleString()}` : 'Never synced on this device.'}
        </span>
      </div>
    </div>
  )
}

// Trusted pages, individually revocable. Without somewhere to see them, trust
// decisions accumulate invisibly — you'd have granted permissions you can't name.
// Listing them by file name means a single mistaken "Trust this page" is one click
// to undo, rather than a choice between keeping it and resetting everything.
function TrustedPagesBlock() {
  const [paths, setPaths] = useState(() => trustedPaths())
  if (!paths.length) return null

  const nameOf = (p) => {
    const raw = p.split('/').pop() || p
    // Attachments carry a uuid prefix that means nothing to a reader.
    return raw.replace(/^[0-9a-f]{6,8}-/, '')
  }

  return (
    <div className={styles.settingBlock}>
      <span className={styles.settingLabel}>Trusted pages</span>
      <span className={styles.settingDesc}>
        {paths.length} HTML {paths.length === 1 ? 'page is' : 'pages are'} allowed to read
        files in your Bag. Remove any you no longer recognise.
      </span>

      <ul className={styles.trustList}>
        {paths.map((p) => (
          <li key={p} className={styles.trustRow}>
            <span className={styles.trustName} title={p}>{nameOf(p)}</span>
            <button
              type="button"
              className={styles.trustForget}
              onClick={() => { setTrusted(p, false); setPaths(trustedPaths()) }}
              title={`Stop trusting ${nameOf(p)}`}
            >
              Forget
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        className={styles.trustForgetAll}
        onClick={() => { forgetAllTrust(); setPaths([]) }}
      >
        Forget all
      </button>
    </div>
  )
}

// ── Interface tabs ─────────────────────────────────────────────────
// Split by what you'd be looking for, not by what happens to be adjacent in the
// code. Fifteen settings in one column meant scrolling past twelve you didn't want.

function AppearanceTab({ settings, updateSetting }) {
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

// ── Cards Tab ──────────────────────────────────────────────────────
// Its own tab rather than a block on Appearance: seven controls for one look
// swamped the tab they were on, and card styling is a subject of its own — this
// is where notebook cards will land too.
function CardsTab({ settings, updateSetting }) {
  return (
    <div className={styles.tabContent}>
      <NoteCardBlock settings={settings} updateSetting={updateSetting} />
      <NotebookBlock settings={settings} updateSetting={updateSetting} />
    </div>
  )
}

// How notebooks are presented above the note grid. They are a filter, not cards
// in the grid — this is only the shape that filter takes.
function NotebookBlock({ settings, updateSetting }) {
  return (
    <div className={styles.settingBlock}>
      <span className={styles.settingLabel}>Notebooks</span>
      <span className={styles.settingDesc}>A filter above your notes. Filed notes leave the main view.</span>

      <SettingRow label="Shown As">
        <SegmentedControl
          options={[
            { value: 'tabs', label: 'Tabs' },
            { value: 'rail', label: 'Rail' },
            { value: 'notebooks', label: 'Notebooks' },
          ]}
          value={settings.notebookView}
          onChange={(v) => updateSetting('notebookView', v)}
        />
      </SettingRow>

      {settings.notebookView === 'notebooks' && (
        <SettingRow label="Unfold On Hover" description="One row until you point at it.">
          <ToggleSwitch
            checked={settings.notebookHoverExpand !== false}
            onChange={(v) => updateSetting('notebookHoverExpand', v)}
          />
        </SettingRow>
      )}
    </div>
  )
}

// Note cards in the grid view are drawn as two sheets of paper. Four axes decide
// how the two sit; the last three rows decide how much each note varies from its
// neighbours.
function NoteCardBlock({ settings, updateSetting }) {
  const varying = settings.noteCardVary === true || settings.noteCardVaryEachLaunch === true
  return (
    <div className={styles.settingBlock}>
      <span className={styles.settingLabel}>Note Cards</span>
      <span className={styles.settingDesc}>A neutral sheet with a coloured one underneath.</span>

      <SettingRow label="Paper Offset">
        <SegmentedControl
          options={[
            { value: 'minimal', label: 'Minimal' },
            { value: 'small', label: 'Small' },
            { value: 'wide', label: 'Wide' },
            { value: 'tab', label: 'Tab' },
          ]}
          value={settings.noteCardExposure}
          onChange={(v) => updateSetting('noteCardExposure', v)}
        />
      </SettingRow>

      <SettingRow label="Colour Shows At">
        <SegmentedControl
          options={[
            { value: 'top-left', label: 'Top left' },
            { value: 'top-right', label: 'Top right' },
            { value: 'bottom-left', label: 'Bottom left' },
            { value: 'bottom-right', label: 'Bottom right' },
          ]}
          value={settings.noteCardAnchor}
          onChange={(v) => updateSetting('noteCardAnchor', v)}
        />
      </SettingRow>

      <SettingRow label="Tilt">
        <SegmentedControl
          options={[
            { value: 'none', label: 'Straight' },
            { value: 'left', label: 'Left' },
            { value: 'right', label: 'Right' },
          ]}
          value={settings.noteCardTilt}
          onChange={(v) => updateSetting('noteCardTilt', v)}
        />
      </SettingRow>

      <SettingRow label="What Tilts">
        <SegmentedControl
          options={[
            { value: 'top', label: 'Top sheet' },
            { value: 'under', label: 'Sheet underneath' },
          ]}
          value={settings.noteCardTurns}
          onChange={(v) => updateSetting('noteCardTurns', v)}
        />
      </SettingRow>

      <SettingRow label="Vary The Tilt" description="Every note gets its own angle.">
        <ToggleSwitch
          checked={settings.noteCardVary === true}
          onChange={(v) => updateSetting('noteCardVary', v)}
        />
      </SettingRow>

      <SettingRow label="Differ The Tilt Every Launch" description="Deal them again at each launch.">
        <ToggleSwitch
          checked={settings.noteCardVaryEachLaunch === true}
          onChange={(v) => updateSetting('noteCardVaryEachLaunch', v)}
        />
      </SettingRow>

      {varying && settings.noteCardTilt === 'none' && (
        <span className={styles.settingNote}>Needs Tilt on to show.</span>
      )}

      <SettingRow label="Tags">
        <SegmentedControl
          options={[
            { value: 'marker', label: 'Marker' },
            { value: 'stamp', label: 'Stamp' },
            { value: 'rule', label: 'Rule' },
          ]}
          value={settings.noteCardTags}
          onChange={(v) => updateSetting('noteCardTags', v)}
        />
      </SettingRow>

      <SettingRow label="Surprise Me Every Launch" description="Tilt re-rolls the lean; Everything re-rolls the layout.">
        <SegmentedControl
          options={[
            { value: 'off', label: 'Off' },
            { value: 'tilt', label: 'Tilt' },
            { value: 'all', label: 'Everything' },
          ]}
          value={settings.noteCardSurprise}
          onChange={(v) => updateSetting('noteCardSurprise', v)}
        />
      </SettingRow>

      {settings.noteCardSurprise !== 'off' && (
        <span className={styles.settingNote}>Overriding the rows above.</span>
      )}
    </div>
  )
}

function EditorTab({ settings, updateSetting }) {
  return (
    <div className={styles.tabContent}>

      <SettingRow
        label="Note Layout"
        description="How a note is laid out in reading mode — one continuous column, or two pages side by side like a book."
      >
        <SegmentedControl
          options={[
            { value: 'scroll', label: 'Scroll' },
            { value: 'book', label: 'Book' },
          ]}
          value={settings.noteLayout ?? 'scroll'}
          onChange={(v) => updateSetting('noteLayout', v)}
        />
      </SettingRow>

      {settings.noteLayout === 'book' && (
        <>
          <SettingRow label="Page Height" description="Height of a page in book layout.">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="range"
                className={styles.starSlider}
                min={360} max={900} step={20}
                value={settings.bookPageHeight ?? 620}
                onChange={e => updateSetting('bookPageHeight', parseInt(e.target.value, 10))}
              />
              <span style={{ minWidth: 56, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)', fontSize: 13 }}>
                {settings.bookPageHeight ?? 620}px
              </span>
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

          <SettingRow label="Page Turn" description="How turning to the next spread animates.">
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
    </div>
  )
}

function BehaviourTab({ settings, updateSetting }) {
  return (
    <div className={styles.tabContent}>

      {/* Remember per-note fold state, and (nested) the launch restore that rides on it */}
      <SettingRow
        label="Remember File/Note State"
        description="Reopens notes the way you left them — collapsed headings, bullets and checklists stay folded, and each note remembers whether you were reading or writing."
      >
        <ToggleSwitch
          checked={settings.rememberNoteState === true}
          onChange={(v) => updateSetting('rememberNoteState', v)}
        />
      </SettingRow>

      {settings.rememberNoteState === true && (
        <SettingRow
          label="Reopen where I left off"
          description="On launch, return to the note or page you had open — including whatever was in the side panel."
        >
          <ToggleSwitch
            checked={settings.restoreLastSession === true}
            onChange={(v) => updateSetting('restoreLastSession', v)}
          />
        </SettingRow>
      )}

      {/* Launch animation */}
      <SettingRow
        label="Launch animation"
        description="Play the opening animation when Siddran starts."
      >
        <ToggleSwitch
          checked={settings.showSplash === true}
          onChange={(v) => updateSetting('showSplash', v)}
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

      <SettingRow
        label="Board Dressing"
        description="How much guild hall the Mission Board wears. Full adds lanterns, drifting dust and iron brackets; Plain renders none of it and leaves nothing animating."
      >
        <SegmentedControl
          options={[
            { value: 'plain', label: 'Plain' },
            { value: 'guild', label: 'Full' },
          ]}
          value={settings.boardDressing || 'plain'}
          onChange={(v) => updateSetting('boardDressing', v)}
        />
      </SettingRow>

      <SettingRow
        label="Show Legacy Views"
        description="Bring back the old masonry card grid in Tasks. It is no longer maintained — the Mission Board and Kanban replaced it."
      >
        <ToggleSwitch
          checked={settings.legacyViews === true}
          onChange={(v) => updateSetting('legacyViews', v)}
        />
      </SettingRow>
    </div>
  )
}

function PagesTab({ settings, updateSetting }) {
  return (
    <div className={styles.tabContent}>

      {/* Trusting an HTML page lets it save its own state — and read the Bag. */}
      <SettingRow
        label="Ask before trusting an HTML page"
        description="Some pages load their own data files as they run. That's blocked unless you trust the page — and trusting also lets it read anything else in your Bag, so it's worth asking. Saving state needs no trust; Siddran keeps that for every page."
      >
        <SegmentedControl
          options={[
            { value: 'always', label: 'Always' },
            { value: 'once', label: 'Once per page' },
            { value: 'never', label: 'Never' },
          ]}
          value={settings.htmlTrustPrompt || 'once'}
          onChange={(v) => updateSetting('htmlTrustPrompt', v)}
        />
      </SettingRow>

      <TrustedPagesBlock />

      {/* Viewed HTML pages: the app is otherwise fully offline (fonts are self-hosted). */}
      <SettingRow
        label="Allow web fonts in HTML pages"
        description="Let an attached HTML page load fonts from Google Fonts so it looks as its author intended. Off by default — pages fall back to system fonts and Siddran stays fully offline. Nothing else is ever fetched."
      >
        <ToggleSwitch
          checked={settings.htmlWebFonts === true}
          onChange={(v) => updateSetting('htmlWebFonts', v)}
        />
      </SettingRow>
    </div>
  )
}


// ── Reminders Tab ──────────────────────────────────────────────────
// Its own tab rather than six more rows on Behaviour: an alarm that can raise
// the window and keep the process alive after you close it is a subject of its
// own, and burying the tray switch under star sliders would be unkind.
function RemindersTab({ settings, updateSetting }) {
  const [trayOk, setTrayOk] = useState(true)

  // Asked once, on mount — never during render, and never per keystroke.
  useEffect(() => {
    let alive = true
    trayAvailable().then((ok) => { if (alive) setTrayOk(ok) })
    return () => { alive = false }
  }, [])

  const alarmsOn = settings.alarmsEnabled !== false

  return (
    <div className={styles.tabContent}>
      <SettingRow
        label="Deadline Alarms"
        description="Ring when a task's deadline arrives. A deadline with no time set counts as 09:00 that morning."
      >
        <ToggleSwitch
          checked={alarmsOn}
          onChange={(v) => updateSetting('alarmsEnabled', v)}
        />
      </SettingRow>

      {alarmsOn && (
        <>
          <SettingRow
            label="Keep Ringing"
            description="The alarm holds the screen until you dismiss or snooze it. Off makes a deadline a toast and one chime, like a reminder."
          >
            <ToggleSwitch
              checked={settings.alarmPersist !== false}
              onChange={(v) => updateSetting('alarmPersist', v)}
            />
          </SettingRow>

          <SettingRow label="Play A Sound">
            <ToggleSwitch
              checked={settings.alarmSound !== false}
              onChange={(v) => updateSetting('alarmSound', v)}
            />
          </SettingRow>

          {settings.alarmSound !== false && (
            <>
              <SettingRow label="Alarm Tone" description="What a reached deadline sounds like, on a loop.">
                <div className={styles.toneRow}>
                  <SegmentedControl
                    options={ALARM_TONES.map(t => ({ value: t.value, label: t.label }))}
                    value={settings.alarmTone || 'gentle'}
                    onChange={(v) => { updateSetting('alarmTone', v); previewAlarm(v, settings.alarmVolume ?? 0.7) }}
                  />
                  <button
                    type="button"
                    className={styles.previewBtn}
                    onClick={() => previewAlarm(settings.alarmTone || 'gentle', settings.alarmVolume ?? 0.7)}
                  >
                    <LuPlay size={13} /> Play
                  </button>
                </div>
              </SettingRow>

              <SettingRow label="Reminder Tone" description="The single chime for a &quot;remind me at&quot;. Heard once, never looped.">
                <div className={styles.toneRow}>
                  <SegmentedControl
                    options={REMINDER_TONES.map(t => ({ value: t.value, label: t.label }))}
                    value={settings.reminderTone || 'soft'}
                    onChange={(v) => { updateSetting('reminderTone', v); playChime(settings.alarmVolume ?? 0.7, v) }}
                  />
                  <button
                    type="button"
                    className={styles.previewBtn}
                    onClick={() => playChime(settings.alarmVolume ?? 0.7, settings.reminderTone || 'soft')}
                  >
                    <LuPlay size={13} /> Play
                  </button>
                </div>
              </SettingRow>
            </>
          )}

          {settings.alarmSound !== false && (
            <SettingRow label="Volume">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="range"
                  className={styles.starSlider}
                  min={0} max={1} step={0.05}
                  value={settings.alarmVolume ?? 0.7}
                  onChange={e => updateSetting('alarmVolume', parseFloat(e.target.value))}
                />
                <span style={{ minWidth: 40, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)', fontSize: 13 }}>
                  {Math.round((settings.alarmVolume ?? 0.7) * 100)}%
                </span>
              </div>
            </SettingRow>
          )}

          <SettingRow label="Snooze For">
            <SegmentedControl
              options={[
                { value: 5, label: '5m' },
                { value: 10, label: '10m' },
                { value: 15, label: '15m' },
                { value: 30, label: '30m' },
              ]}
              value={settings.alarmSnoozeMinutes ?? 10}
              onChange={(v) => updateSetting('alarmSnoozeMinutes', v)}
            />
          </SettingRow>

          <SettingRow
            label="All-Day Deadlines Ring At"
            description="A deadline with a date but no time is due by the end of that day. This is when it actually goes off."
          >
            <input
              type="time"
              className={styles.timeInput}
              value={settings.allDayAlarmTime || '09:00'}
              onChange={(e) => updateSetting('allDayAlarmTime', e.target.value || '09:00')}
            />
          </SettingRow>

          <SettingRow
            label="Bring Siddran To The Front"
            description="Raise the window when a deadline goes off, even if it's hidden."
          >
            <ToggleSwitch
              checked={settings.alarmRaiseWindow !== false}
              onChange={(v) => updateSetting('alarmRaiseWindow', v)}
            />
          </SettingRow>
        </>
      )}

      <SettingRow
        label="Keep Running In The Tray"
        description={trayOk
          ? "Closing the window hides it instead of quitting, so alarms still go off. Quit from the tray icon."
          : "No system tray was found on this desktop — Siddran quits normally when you close the window, and alarms stop with it."}
      >
        <ToggleSwitch
          checked={trayOk && settings.closeToTray !== false}
          onChange={(v) => { if (trayOk) updateSetting('closeToTray', v) }}
        />
      </SettingRow>
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
