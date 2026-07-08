import logger from '../utils/logger'

// localStorage cache for per-note view mode (read vs write). Mirrors the tiny
// read/write helpers in noteFoldsCache — no React, no store. Lets each note
// reopen in the same mode it was last left in, across refresh / navigation.
//
// Only the "read" choice is stored; write is the default, so a write note just
// clears its entry (keeps localStorage tidy, same idiom as noteFoldsCache).

const VIEW_MODE_PREFIX = 'cinder_note_view_'

const viewModeKey = (noteId) => `${VIEW_MODE_PREFIX}${noteId}`

// → 'read' | 'write' ('write' on miss / parse error).
export const readViewMode = (noteId) => {
  if (!noteId) return 'write'
  try {
    return localStorage.getItem(viewModeKey(noteId)) === 'read' ? 'read' : 'write'
  } catch (err) {
    logger.error('noteViewModeCache — failed to read view mode', err)
    return 'write'
  }
}

export const writeViewMode = (noteId, mode) => {
  if (!noteId) return
  try {
    if (mode === 'read') {
      localStorage.setItem(viewModeKey(noteId), 'read')
    } else {
      localStorage.removeItem(viewModeKey(noteId))
    }
  } catch (err) {
    logger.error('noteViewModeCache — failed to write view mode', err)
  }
}
