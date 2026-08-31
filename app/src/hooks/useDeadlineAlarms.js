import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '../utils/toast'
import logger from '../utils/logger'
import { dueTriggers, partitionDue } from '../utils/alarmSchedule'
import { readLedger, writeLedger, markFired } from '../utils/alarmLedger'
import { playChime, startAlarm, stopAlarm, setAlarmVolume, primeOnFirstGesture } from '../utils/alarmSound'
import { notifyOS, showMainWindow } from '../desktop/tray'

const SWEEP_MS = 15 * 1000
const REFETCH_MS = 60 * 1000
const GRACE_MS = 12 * 60 * 60 * 1000

// Deadline alarms.
//
// The sweep is STATELESS: every 15s it recomputes every fire time from the
// current snapshot and compares against the wall clock. No accumulated tick
// count, no "window since the last check". A laptop suspend, a clock jump or a
// throttled hidden page can therefore only ever delay an alarm by one tick —
// none of them can skip one, and none of them can fire one twice, because the
// ledger already holds the key.
//
// It also owns its own snapshot rather than reading useTasks: that hook holds a
// paginated first page, and a deadline on page three still has to go off.
export function useDeadlineAlarms({ authFetch, API, enabled, settings = {} }) {
  // null means "no response has ever arrived" — NOT []. An empty array is also
  // what an unloaded page looks like, and the stale-marking branch below writes,
  // so deciding "these are too old to ring" against data we never received would
  // be a real wrong answer.
  const snapRef = useRef(null)
  const ledgerRef = useRef(null)
  const snoozedRef = useRef([])
  const firstSweepRef = useRef(true)
  const [ringing, setRinging] = useState([])
  const ringingRef = useRef(ringing)
  useEffect(() => { ringingRef.current = ringing }, [ringing])

  // Settings live in a ref so the sweep effect doesn't re-arm its interval every
  // time a slider moves.
  const settingsRef = useRef(settings)
  useEffect(() => {
    settingsRef.current = settings
    setAlarmVolume(settings.alarmVolume ?? 0.7)
  }, [settings])

  useEffect(() => primeOnFirstGesture({
    alarmTone: settingsRef.current.alarmTone,
    reminderTone: settingsRef.current.reminderTone,
  }), [])

  // ── the snapshot ────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled || !authFetch || !API) { snapRef.current = null; return }
    let cancelled = false

    const load = async () => {
      try {
        const [tRes, dRes, cRes] = await Promise.all([
          authFetch(`${API}/tasks?reminders=1`),
          authFetch(`${API}/daily-tasks`),
          authFetch(`${API}/daily-tasks/completions`),
        ])
        if (cancelled || !tRes.ok || !dRes.ok) return
        const tJson = await tRes.json()
        const dJson = await dRes.json()
        const cJson = cRes.ok ? await cRes.json().catch(() => null) : null
        if (cancelled) return
        snapRef.current = {
          tasks: tJson?.tasks || [],
          dailies: dJson?.dailyTasks || dJson?.daily_tasks || [],
          completions: cJson?.completions || cJson?.dailyCompletions || [],
        }
      } catch (error) {
        logger.error('Could not read deadlines for the alarm scheduler:', error)
      }
    }

    load()
    const id = setInterval(load, REFETCH_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [enabled, authFetch, API])

  // ── the sweep ───────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return
    if (!ledgerRef.current) ledgerRef.current = readLedger()

    const sweep = () => {
      const cfg = settingsRef.current
      if (cfg.alarmsEnabled === false) return
      const snap = snapRef.current
      if (!snap) return

      const now = Date.now()
      const triggers = [...dueTriggers({ ...snap, now, allDayTime: cfg.allDayAlarmTime || '09:00' }), ...snoozedRef.current]
      const { ring, stale } = partitionDue(triggers, {
        now,
        graceMs: GRACE_MS,
        fired: (k) => !!ledgerRef.current[k],
      })
      if (!ring.length && !stale.length) { firstSweepRef.current = false; return }

      let ledger = ledgerRef.current
      for (const trig of [...stale, ...ring]) ledger = markFired(ledger, trig.key, now)
      ledgerRef.current = ledger
      writeLedger(ledger)
      snoozedRef.current = snoozedRef.current.filter((s) => !ledger[s.key])

      // Missed while the app was shut. One line about it, not a scream.
      if (stale.length && firstSweepRef.current) {
        toast.warning(stale.length === 1
          ? `A deadline passed while Siddran was closed: ${stale[0].title || 'Untitled'}`
          : `${stale.length} deadlines passed while Siddran was closed.`)
      }
      firstSweepRef.current = false

      const fresh = []
      for (const trig of ring) {
        if (trig.tier === 'reminder') {
          toast.warning(`Reminder — ${trig.title || 'Untitled'}`)
          if (cfg.alarmSound !== false) playChime(cfg.alarmVolume ?? 0.7, cfg.reminderTone)
          notifyOS('Reminder', trig.title || 'Untitled')
        } else {
          fresh.push(trig)
        }
      }
      if (!fresh.length) return

      notifyOS(fresh.length === 1 ? 'Deadline reached' : `${fresh.length} deadlines reached`,
        fresh.map((t) => t.title || 'Untitled').join(', '))
      if (cfg.alarmRaiseWindow !== false) showMainWindow()

      // An alarm that isn't allowed to persist is just a louder reminder.
      if (cfg.alarmPersist === false) {
        if (cfg.alarmSound !== false) playChime(cfg.alarmVolume ?? 0.7, cfg.reminderTone)
        for (const t of fresh) toast.error(`Deadline — ${t.title || 'Untitled'}`)
        return
      }
      setRinging((prev) => [...prev, ...fresh.filter((t) => !prev.some((p) => p.key === t.key))])
    }

    sweep()
    const id = setInterval(sweep, SWEEP_MS)
    return () => clearInterval(id)
  }, [enabled])

  // The sound belongs to the queue, not to the modal: it starts when something
  // is ringing and stops when nothing is, so no unmount can orphan it.
  useEffect(() => {
    if (!ringing.length) { stopAlarm(); return }
    if (settingsRef.current.alarmSound !== false) startAlarm(settingsRef.current.alarmVolume ?? 0.7, settingsRef.current.alarmTone)
    return () => stopAlarm()
  }, [ringing.length])

  const dismiss = useCallback((key) => {
    setRinging((prev) => prev.filter((t) => t.key !== key))
  }, [])

  const dismissAll = useCallback(() => setRinging([]), [])

  const snooze = useCallback((key) => {
    const minutes = settingsRef.current.alarmSnoozeMinutes ?? 10
    setRinging((prev) => {
      const trig = prev.find((t) => t.key === key)
      if (trig) {
        // Snoozes are in-memory on purpose. One surviving a two-day quit is
        // worse than one that doesn't, and the deadline itself is already
        // ledgered, so it will not come back on its own.
        snoozedRef.current = [
          ...snoozedRef.current,
          { ...trig, key: `${trig.key}:snooze:${Date.now()}`, at: Date.now() + minutes * 60 * 1000 },
        ]
      }
      return prev.filter((t) => t.key !== key)
    })
  }, [])

  return { ringing, dismiss, dismissAll, snooze }
}
