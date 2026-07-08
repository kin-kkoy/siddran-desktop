// Note card color definitions.
// The `key` is the value stored in the database.
export const NOTE_COLORS = [
  { key: null,      name: 'Default' },
  { key: '#2a2a1a', name: 'Brown' },
  { key: '#1a2a2a', name: 'Teal' },
  { key: '#2a1a2a', name: 'Purple' },
  { key: '#2a1a1a', name: 'Red' },
]

// Look up the display color for a stored note color value.
// Returns null for "use CSS variable default".
export function getNoteBackground(storedColor) {
  if (!storedColor) return null
  const entry = NOTE_COLORS.find(c => c.key === storedColor)
  return entry ? entry.key : storedColor
}

// Get the swatch preview color for the color picker.
export function getSwatchColor(entry) {
  return entry.key
}
