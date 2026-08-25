// Read one setting straight from the localStorage cache that SettingsContext
// persists to. For the parts of the app that run ABOVE <SettingsProvider> and so
// can't use the hook: the splash gate and the launch-restore decision both happen
// before the provider is mounted.
//
// Callers pass their own fallback rather than importing DEFAULTS, so this stays a
// plain module (no component exports) and can be imported from anywhere.
export function readCachedSetting(key, fallback) {
  try {
    const cached = JSON.parse(localStorage.getItem('cinder_settings'))
    const v = cached?.[key]
    return v === undefined ? fallback : v
  } catch { return fallback }
}
