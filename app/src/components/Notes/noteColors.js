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

// ── Paper tones ────────────────────────────────────────────────────
// The grid card draws the note colour as a sheet of paper UNDERNEATH a neutral
// one, and the keys above cannot be used for that: they are near-black tints,
// chosen back when the colour filled the whole card. Under another sheet on a
// #09090f page they are a black sheet under a black sheet.
//
// So each stored key maps to a paper tone — mid-value, low-chroma, the colour of
// actual coloured stock rather than a highlighter. Nothing stored changes and
// there is no migration: this is a second lookup over the same keys, and
// getNoteBackground() above is untouched for the list view.
const PAPER_TONES = {
  null:      '#454560',  // no colour set — plain stock, and still a visible sheet
  '#2a2a1a': '#6f5a32',  // Brown  — manila
  '#1a2a2a': '#2d6360',  // Teal   — ledger blue-green
  '#2a1a2a': '#574079',  // Purple — violet
  '#2a1a1a': '#7a4144',  // Red    — rose
}

// The sheet colour for a stored note colour. Always returns something: an
// uncoloured note is still a stack, or the grid would be two designs at once.
//
// `inherited` is the tone of the notebook the note is filed in. A note that never
// had a colour takes its notebook's — so a notebook reads as one set of papers —
// while a note that WAS given a colour keeps it, because that was a choice and
// filing it somewhere is not a reason to overwrite a choice.
//
// This is resolved at render time, not written to the note. Unfile it and it goes
// back to plain stock; recolour the notebook and its notes follow. Stamping the
// colour onto the note instead would make both of those one-way doors.
export function paperTone(storedColor, inherited) {
  if (!storedColor && inherited) return inherited
  return PAPER_TONES[storedColor] || PAPER_TONES[null]
}

// Swatch colour for the picker. It has to show the paper tone, not the stored
// key, or the picker offers five near-identical black chips for colours that
// render as manila and rose.
export function getPaperSwatch(entry) {
  return paperTone(entry.key)
}
