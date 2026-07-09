import logger from '../utils/logger'

// localStorage cache for the per-note outline panel's open/closed state. Mirrors
// noteViewModeCache — no React, no store. Lets each note reopen with the outline
// the way it was last left, across refresh / navigation / remount.
//
// Only the "open" choice is stored; closed is the default, so a closed note just
// clears its entry (keeps localStorage tidy).

const OUTLINE_PREFIX = 'cinder_note_outline_'

const outlineKey = (noteId) => `${OUTLINE_PREFIX}${noteId}`

// → boolean (false on miss / parse error).
export const readOutlineOpen = (noteId) => {
  if (!noteId) return false
  try {
    return localStorage.getItem(outlineKey(noteId)) === 'open'
  } catch (err) {
    logger.error('noteOutlineCache — failed to read outline state', err)
    return false
  }
}

export const writeOutlineOpen = (noteId, open) => {
  if (!noteId) return
  try {
    if (open) localStorage.setItem(outlineKey(noteId), 'open')
    else localStorage.removeItem(outlineKey(noteId))
  } catch (err) {
    logger.error('noteOutlineCache — failed to write outline state', err)
  }
}
