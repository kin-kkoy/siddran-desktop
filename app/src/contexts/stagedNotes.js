import { createContext, useContext } from 'react'

// Shared pieces of StagedNotesContext.jsx, kept apart so that file exports only
// its provider (React fast refresh needs component-only modules).
export const StagedNotesContext = createContext(null)

export const STAGED_PREFIX = 'staged-'
export const isStagedId = (id) => String(id ?? '').startsWith(STAGED_PREFIX)

export function useStagedNotes() {
  return useContext(StagedNotesContext)
}
