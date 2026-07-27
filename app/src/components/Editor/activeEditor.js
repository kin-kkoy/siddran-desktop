// Tracks the most recently focused note editor so features that open outside the
// editor (the command palette) can dispatch back into it. Module-level, not context,
// because the palette needs the view synchronously at keypress time and doesn't want
// to subscribe to re-renders.
//
// CM6 keeps its selection when blurred, so acting on the last-focused view after an
// overlay steals focus preserves the caret/selection the user was working with.

let active = null

export function setActiveEditor(view) { active = view }

// Clear only if we still point at this exact view — a newer editor may have taken
// over between focus and teardown.
export function clearActiveEditor(view) { if (active === view) active = null }

// Returns the live view, or null if it was destroyed/detached since it last focused.
export function getActiveEditor() {
  if (active && active.dom && active.dom.isConnected) return active
  active = null
  return null
}
