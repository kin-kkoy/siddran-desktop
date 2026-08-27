import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { CalendarViewProvider } from './contexts/CalendarViewContext.jsx'
import { installDropGuard } from './desktop/dropGuard'
import { installLinkGuard } from './desktop/linkGuard'
import { installTauriFileDrop } from './desktop/fileDrop'

// Prevent a dragged-in file — or a clicked external link — from navigating the
// whole webview away from the app, and wire Tauri's native OS file-drop → embed
// into the note editor.
installDropGuard()
installLinkGuard()
installTauriFileDrop()

createRoot(document.getElementById('root')).render(
    // CalendarViewProvider wraps App so the app shell itself can react to the peek/half state
    // (half-split layout, sidebar collapse, global hotkey).
    <CalendarViewProvider>
      <App />
    </CalendarViewProvider>
  // <StrictMode>
  // </StrictMode>,
)
