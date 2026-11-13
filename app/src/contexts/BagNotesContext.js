import { createContext, useContext } from 'react'

/**
 * The Bag's notes, for pickers deep in a page (a Table's attachment cells can
 * attach a note). Kept apart from TasksApiContext so editing a note re-renders
 * only what reads this, not every board widget.
 */
const BagNotesContext = createContext([])

export const BagNotesProvider = BagNotesContext.Provider
export const useBagNotes = () => useContext(BagNotesContext)
