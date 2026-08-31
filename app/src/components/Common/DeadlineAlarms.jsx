import { useEffect } from 'react'
import AlarmModal from './AlarmModal'
import { useSettings } from '../../contexts/SettingsContext'
import { useDeadlineAlarms } from '../../hooks/useDeadlineAlarms'
import { setCloseToTray } from '../../desktop/tray'

// Mounts the deadline scheduler and shows whatever it decides is ringing.
// It exists as a component rather than a call in App.jsx only because the
// scheduler needs Settings, and App renders above <SettingsProvider>.
function DeadlineAlarms({ authFetch, API, enabled, toggleTaskCompletion, toggleDailyTaskCompletion }) {
  const { settings } = useSettings()
  const { ringing, dismiss, dismissAll, snooze } = useDeadlineAlarms({ authFetch, API, enabled, settings })

  // Push the tray preference down to Rust, which owns the close decision.
  const closeToTray = settings.closeToTray !== false
  useEffect(() => { setCloseToTray(closeToTray) }, [closeToTray])

  const complete = (item) => {
    if (item.kind === 'daily') toggleDailyTaskCompletion?.(item.id, true)
    else toggleTaskCompletion?.(item.id, true)
    dismiss(item.key)
  }

  return (
    <AlarmModal
      ringing={ringing}
      onDismiss={dismiss}
      onDismissAll={dismissAll}
      onSnooze={snooze}
      onComplete={complete}
      snoozeMinutes={settings.alarmSnoozeMinutes ?? 10}
    />
  )
}

export default DeadlineAlarms
