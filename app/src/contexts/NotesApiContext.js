import { createContext, useContext } from 'react'

/**
 * The notes store's writers (hooks/useNotes.js), for a board Doc linked to a
 * real note: it saves through the same path as the Notes page (the Bag store
 * and its live sync), never by touching files. The notes themselves come from
 * BagNotesContext.
 *
 * value: { editBody(id, md) => Promise<boolean>, addNote(title) => Promise<note|null> }
 */
const NotesApiContext = createContext({})

export const NotesApiProvider = NotesApiContext.Provider
export const useNotesApi = () => useContext(NotesApiContext)
