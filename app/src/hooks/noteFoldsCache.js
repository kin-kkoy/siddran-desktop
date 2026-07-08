import logger from '../utils/logger'

// localStorage cache for per-note fold state. Mirrors sandboxCache's tiny
// read/write helpers (no React, no store). The "Remember File/Note State"
// setting (SettingsContext) gates whether these are read/written at all.
//
// A note's fold state is the set of SOURCE LINE NUMBERS (1-based) whose heading
// or list-item is collapsed. Line numbers are the shared identity between the
// two view modes: the CM6 editor folds by line range, the reading view tags each
// heading/<li> with a matching `data-line`. Both render the same markdown text,
// so the line number means the same thing on either side.

const FOLDS_PREFIX = 'cinder_note_folds_'

const foldsKey = (noteId) => `${FOLDS_PREFIX}${noteId}`

// → number[] of folded line numbers (empty on miss / parse error).
export const readFolds = (noteId) => {
  if (!noteId) return []
  try {
    const raw = localStorage.getItem(foldsKey(noteId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed?.folds) ? parsed.folds : []
  } catch (err) {
    logger.error('noteFoldsCache — failed to read folds', err)
    return []
  }
}

export const writeFolds = (noteId, lines) => {
  if (!noteId) return
  try {
    if (!lines || lines.length === 0) {
      localStorage.removeItem(foldsKey(noteId))
      return
    }
    localStorage.setItem(foldsKey(noteId), JSON.stringify({ folds: lines }))
  } catch (err) {
    logger.error('noteFoldsCache — failed to write folds', err)
  }
}
