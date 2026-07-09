import { createContext, useContext } from 'react'

// Sidebar collapse state, shared so the contextual "show sidebar" buttons (note
// tab bar, sandbox header, floating on hubs) can expand it once the sidebar is
// fully hidden.
export const SidebarContext = createContext({ collapsed: false, setCollapsed: () => {} })

export const useSidebar = () => useContext(SidebarContext)
