import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react'
import logger from '../utils/logger'

// ── Theme definitions ──────────────────────────────────────────────
export const THEMES = {
  'default':        { name: 'Default',        hex: null },
  'midnight-slate': { name: 'Midnight Slate', hex: '#1E293B' },
  'forest-focus':   { name: 'Forest Focus',   hex: '#064E3B' },
  'strawberry':     { name: 'Strawberry',     hex: '#9B2335' },
  'oled-pitch':     { name: 'OLED Pitch',     hex: '#000000' },
  'lavender-mist':  { name: 'Lavender Mist',  hex: '#7C3AED' },
  'steel-blue':     { name: 'Steel Blue',     hex: '#0369A1' },
  'terra-cotta':    { name: 'Terra Cotta',    hex: '#9A3412' },
  'golden-hour':    { name: 'Golden Hour',    hex: '#7D5A00' },
  'nebula-pink':    { name: 'Nebula Pink',    hex: '#D6196E' },
}

const DEFAULTS = {
  theme: 'default',
  matchMode: true,
  contrast: 'low',
  showStars: true,
  showStarsOnNotePage: false,
  reduceStars: false,
  starSize: 1.40,
  starDriftSpeed: 3.90,
  starTwinkleSpeed: 1.00,
  starTwinkleDepth: 1.65,
  starCount: 100,
  starDirection: '↙',
  noteEditorWidth: 1200,
  rememberNoteState: true,
}

// ── Color utilities ────────────────────────────────────────────────
function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return [h * 360, s * 100, l * 100]
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100
  const a = s * Math.min(l, 1 - l)
  const f = n => {
    const k = (n + h / 30) % 12
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * Math.max(0, Math.min(1, color))).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

// WCAG relative luminance — determines if text should be light or dark
function relativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(c => {
    c /= 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function needsLightText(bgHex) {
  return relativeLuminance(bgHex) < 0.179
}

// ── Theme palette generator ────────────────────────────────────────
function generatePalette(themeKey, matchMode, contrast) {
  const theme = THEMES[themeKey]

  // Default theme
  if (!theme?.hex) {
    return darkDefaults(contrast)
  }

  // OLED Pitch — pure black, no adaptation needed
  if (themeKey === 'oled-pitch') {
    return oledPalette(contrast)
  }

  const [h, s] = rgbToHsl(...hexToRgb(theme.hex))

  // matchMode OFF — use the literal theme color
  if (!matchMode) {
    return literalPalette(theme.hex, h, s, contrast)
  }

  // matchMode ON — adapt shades to dark mode
  return darkThemedPalette(h, s, contrast)
}

function darkDefaults(contrast) {
  const hi = contrast === 'high'
  return {
    '--bg-primary':    '#09090f',
    '--bg-surface':    '#12121e',
    '--bg-surface-alt': '#181826',
    '--bg-elevated':   '#1e1e2e',
    '--bg-hover':      '#252538',
    '--border-default': hi ? '#333350' : '#252538',
    '--border-strong':  hi ? '#444' : '#333350',
    '--text-primary':   '#e2ddf5',
    '--text-secondary': '#b8b3d0',
    '--text-muted':     hi ? '#aaa' : '#635f80',
    '--text-dim':       hi ? '#999' : '#635f80',
    '--text-faint':     hi ? '#888' : '#363550',
    '--accent-blue':    '#5a9cf0',
    '--accent-danger':  '#e05c5c',
    '--accent-warning': '#f0b840',
    '--accent-warning-alpha': 'rgba(240, 184, 64, 0.07)',
    '--accent-success': '#52c47a',
    '--shadow-color':   'rgba(0, 0, 0, 0.5)',
  }
}

function oledPalette(contrast) {
  const hi = contrast === 'high'
  return {
    '--bg-primary':    '#000000',
    '--bg-surface':    '#050505',
    '--bg-surface-alt': '#0a0a0a',
    '--bg-elevated':   '#111111',
    '--bg-hover':      '#1a1a1a',
    '--border-default': hi ? '#333' : '#1a1a1a',
    '--border-strong':  hi ? '#444' : '#2a2a2a',
    '--text-primary':   '#e2ddf5',
    '--text-secondary': '#b8b3d0',
    '--text-muted':     hi ? '#aaa' : '#635f80',
    '--text-dim':       hi ? '#999' : '#635f80',
    '--text-faint':     hi ? '#888' : '#363550',
    '--accent-blue':    '#5a9cf0',
    '--accent-danger':  '#e05c5c',
    '--accent-warning': '#f0b840',
    '--accent-warning-alpha': 'rgba(240, 184, 64, 0.07)',
    '--accent-success': '#52c47a',
    '--shadow-color':   'rgba(0, 0, 0, 0.8)',
  }
}

function darkThemedPalette(h, s, contrast) {
  const hi = contrast === 'high'
  const sat = Math.min(s, 40) // Keep saturation subtle for backgrounds
  const accent = s >= 15 ? hslToHex(h, Math.max(s, 70), 53) : '#f0b840'
  const [ar, ag, ab] = hexToRgb(accent)
  return {
    '--bg-primary':    hslToHex(h, sat, 8),
    '--bg-surface':    hslToHex(h, sat, 12),
    '--bg-surface-alt': hslToHex(h, sat, 14),
    '--bg-elevated':   hslToHex(h, sat, 16),
    '--bg-hover':      hslToHex(h, sat, 22),
    '--border-default': hslToHex(h, sat * 0.6, hi ? 35 : 22),
    '--border-strong':  hslToHex(h, sat * 0.6, hi ? 45 : 30),
    '--text-primary':   '#e2ddf5',
    '--text-secondary': '#b8b3d0',
    '--text-muted':     hi ? '#aaa' : '#635f80',
    '--text-dim':       hi ? '#999' : '#635f80',
    '--text-faint':     hi ? '#888' : '#363550',
    '--accent-blue':    s >= 20 ? hslToHex(h, Math.max(s, 60), 60) : '#5a9cf0',
    '--accent-danger':  '#e05c5c',
    '--accent-warning': accent,
    '--accent-warning-alpha': `rgba(${ar}, ${ag}, ${ab}, 0.07)`,
    '--accent-success': '#52c47a',
    '--shadow-color':   'rgba(0, 0, 0, 0.5)',
  }
}

function literalPalette(hex, h, s, contrast) {
  const hi = contrast === 'high'
  const [, , baseLightness] = rgbToHsl(...hexToRgb(hex))
  const lightText = needsLightText(hex)

  // Derive surface/elevated from the base color
  const surfaceL = Math.min(baseLightness + 5, 95)
  const elevatedL = Math.min(baseLightness + 10, 90)
  const hoverL = Math.min(baseLightness + 16, 85)

  const accent = s >= 15
    ? hslToHex(h, Math.max(s, 70), lightText ? 53 : 48)
    : (lightText ? '#f0b840' : '#c89620')
  const [ar, ag, ab] = hexToRgb(accent)

  return {
    '--bg-primary':    hex,
    '--bg-surface':    hslToHex(h, s, surfaceL),
    '--bg-surface-alt': hslToHex(h, s, surfaceL + 2),
    '--bg-elevated':   hslToHex(h, s, elevatedL),
    '--bg-hover':      hslToHex(h, s, hoverL),
    '--border-default': hslToHex(h, s * 0.6, lightText ? (hi ? baseLightness + 20 : baseLightness + 12) : (hi ? baseLightness - 20 : baseLightness - 12)),
    '--border-strong':  hslToHex(h, s * 0.6, lightText ? (hi ? baseLightness + 28 : baseLightness + 18) : (hi ? baseLightness - 28 : baseLightness - 18)),
    '--text-primary':   lightText ? '#e2ddf5' : '#1a1a1a',
    '--text-secondary': lightText ? '#b8b3d0' : '#333333',
    '--text-muted':     lightText ? (hi ? '#bbb' : '#999') : (hi ? '#555' : '#777'),
    '--text-dim':       lightText ? (hi ? '#aaa' : '#777') : (hi ? '#666' : '#888'),
    '--text-faint':     lightText ? (hi ? '#999' : '#666') : (hi ? '#777' : '#999'),
    '--accent-blue':    lightText ? '#5a9cf0' : '#2563eb',
    '--accent-danger':  lightText ? '#e05c5c' : '#dc2626',
    '--accent-warning': accent,
    '--accent-warning-alpha': `rgba(${ar}, ${ag}, ${ab}, 0.07)`,
    '--accent-success': lightText ? '#52c47a' : '#16a34a',
    '--shadow-color':   lightText ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.12)',
  }
}

// ── Apply palette to document ──────────────────────────────────────
function applyPalette(palette) {
  const root = document.documentElement
  for (const [prop, value] of Object.entries(palette)) {
    root.style.setProperty(prop, value)
  }
}

// ── Context ────────────────────────────────────────────────────────
const SettingsContext = createContext(null)

export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider')
  return ctx
}

export function SettingsProvider({ children, authFetch, API, isAuthed }) {
  const [settings, setSettings] = useState(() => {
    try {
      const cached = JSON.parse(localStorage.getItem('cinder_settings'))
      const merged = { ...DEFAULTS, ...cached }
      // One-time migration: fold persistence ("Remember File/Note State") is now on
      // by default. Existing installs have a cached `rememberNoteState:false` that
      // would otherwise mask the new default, so force it on once. After this the
      // user can still turn it off in Settings and that choice sticks.
      if (!localStorage.getItem('cinder_folds_default_on')) {
        merged.rememberNoteState = true
        localStorage.setItem('cinder_folds_default_on', '1')
      }
      return merged
    } catch { return { ...DEFAULTS } }
  })

  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const dirtyRef = useRef(false)
  const settingsRef = useRef(settings)

  // Keep ref in sync with state
  useEffect(() => { settingsRef.current = settings }, [settings])

  // Persist to localStorage on every change
  useEffect(() => {
    try { localStorage.setItem('cinder_settings', JSON.stringify(settings)) } catch {}
  }, [settings])

  // Apply theme whenever settings change — force default on auth pages
  useEffect(() => {
    const palette = isAuthed
      ? generatePalette(settings.theme, settings.matchMode, settings.contrast)
      : darkDefaults('low')
    applyPalette(palette)
  }, [settings.theme, settings.matchMode, settings.contrast, isAuthed])

  // Note editor width — exposed as CSS variable for NotePage's container.
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--note-editor-width',
      `${settings.noteEditorWidth || DEFAULTS.noteEditorWidth}px`
    )
  }, [settings.noteEditorWidth])

  // Fetch from backend on auth (backend is source of truth)
  useEffect(() => {
    if (!isAuthed || !authFetch || !API) return

    const fetchSettings = async () => {
      try {
        const res = await authFetch(`${API}/settings`)
        if (res.ok) {
          const data = await res.json()
          if (data.settings && Object.keys(data.settings).length > 0) {
            setSettings(prev => ({ ...DEFAULTS, ...prev, ...data.settings }))
          }
        }
      } catch (error) {
        logger.error('Error fetching settings:', error)
      }
    }

    fetchSettings()
  }, [isAuthed, authFetch, API])

  // Update a single setting — local only, backend save deferred to modal close
  const updateSetting = useCallback((key, value) => {
    dirtyRef.current = true
    setSettings(prev => ({ ...prev, [key]: value }))
  }, [])

  const openSettings = useCallback(() => setIsSettingsOpen(true), [])

  // Save to backend only when closing the popup
  const closeSettings = useCallback(() => {
    setIsSettingsOpen(false)

    if (dirtyRef.current && authFetch && API) {
      dirtyRef.current = false
      authFetch(`${API}/settings`, {
        method: 'PUT',
        body: JSON.stringify({ settings: settingsRef.current }),
      }).catch(err => logger.error('Error saving settings:', err))
    }
  }, [authFetch, API])

  // Memoized so consumers don't re-render every time the provider re-renders (the handlers are
  // already stable useCallbacks; only `settings`/`isSettingsOpen` actually change).
  const value = useMemo(() => ({
    settings,
    updateSetting,
    isSettingsOpen,
    openSettings,
    closeSettings,
  }), [settings, updateSetting, isSettingsOpen, openSettings, closeSettings])

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  )
}
