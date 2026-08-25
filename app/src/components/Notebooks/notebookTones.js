// Notebook colours at two strengths, and the difference is AREA.
//
// A cover is a large block of colour, so it stays muted — a saturated one makes a
// single notebook outshout forty notes, which is the clutter we are removing. A
// tab's lip and a rail's spine are a few pixels wide, and at that size the muted
// tone just reads as grey, so they get the full-strength hue.
//
// Keys are the spine colours the notebook picker already stores; nothing in the
// Bag changes and there is no migration.
const COVER = {
  null: '#3c3c58',
  '#4a9eff': '#3a6ea8',
  '#fbbf24': '#96762a',
  '#10b981': '#2c7a5e',
  '#8b5cf6': '#5c4a9c',
  '#ef4444': '#96393c',
}

const LIP = {
  null: '#6b6a8c',
  '#4a9eff': '#5aa2f0',
  '#fbbf24': '#e8b93f',
  '#10b981': '#3fc98d',
  '#8b5cf6': '#9b7cf0',
  '#ef4444': '#ef6a6d',
}

export function coverTone(stored) {
  return COVER[stored] || COVER[null]
}

// An unknown colour (one typed in by hand, or a future palette entry) is used as
// it is rather than falling back to grey — it is already a hue, just not one of
// ours, and greying it would lose the only thing the user chose.
export function lipTone(stored) {
  return LIP[stored] || stored || LIP[null]
}
