import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { CalendarViewProvider } from './contexts/CalendarViewContext.jsx'

createRoot(document.getElementById('root')).render(
    // CalendarViewProvider wraps App so the app shell itself can react to the peek/half state
    // (half-split layout, sidebar collapse, global hotkey).
    <CalendarViewProvider>
      <App />
    </CalendarViewProvider>
  // <StrictMode>
  // </StrictMode>,
)
