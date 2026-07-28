import { useEffect, useState, useCallback, useMemo, useRef, lazy, Suspense } from "react"
import { BrowserRouter, Route, Routes, useParams } from 'react-router-dom'
import Sidebar from "./components/Layout/Sidebar/Sidebar.jsx"
import { SidebarContext } from "./contexts/SidebarContext.jsx"
import { GlobalExpandButton } from "./components/Layout/Sidebar/ExpandSidebarButton.jsx"
import StarCanvas from "./components/Layout/StarCanvas/StarCanvas.jsx"

import NotePage from "./pages/Notes/NotePage.jsx"
import NotesHub from "./pages/Notes/NotesHub.jsx"
import TasksHub from "./pages/Tasks/TasksHub.jsx"
// Sandbox routes are code-split — Konva + perfect-freehand stay out of the
// main bundle until the user actually navigates to /sandboxes.
const SandBoxes   = lazy(() => import("./pages/Sandbox/SandBoxes.jsx"))
const SandBoxPage = lazy(() => import("./pages/Sandbox/SandBoxPage.jsx"))
import Calendar from "./pages/Calendar/Calendar.jsx"
import NotFoundPage from "./pages/NotFoundPage.jsx"
import { useNotes } from "./hooks/useNotes.js"
import { useTasks } from "./hooks/useTasks.js"
import { useCalendarEvents } from "./hooks/useCalendarEvents.js"
import { useCalendarTasks } from "./hooks/useCalendarTasks.js"
import { useCalendarDailies } from "./hooks/useCalendarDailies.js"
import { useSchedules } from "./hooks/useSchedules.js"
import { stampWeeklyPattern, patternFromPlot, plotFromPattern } from "./components/Calendar/calendarDates.js"
import { useCalendarView } from "./contexts/CalendarViewContext.jsx"
import CalendarPeek from "./components/Calendar/Peek/CalendarPeek.jsx"
import { SettingsProvider } from "./contexts/SettingsContext.jsx"
import { ApiProvider } from "./contexts/ApiContext.jsx"
import { SandboxViewProvider } from "./contexts/SandboxViewContext.jsx"
import { NoteSplitProvider } from "./contexts/NoteSplitContext.jsx"
import { PdfViewProvider } from "./contexts/PdfViewContext.jsx"
import { NoteTabsProvider } from "./contexts/NoteTabsContext.jsx"
import SettingsPopup from "./components/Settings/SettingsPopup.jsx"
import ToastContainer from "./components/Common/ToastContainer.jsx"
import CommandPalette from "./components/CommandPalette/CommandPalette.jsx"
import logger from "./utils/logger.js"
import BagPicker from "./pages/Bag/BagPicker.jsx"
import SplashScreen from "./components/Splash/SplashScreen.jsx"
import { pickExistingBag, createBag, getRecentBags, addRecentBag, removeRecentBag, getLastBag, isTauri } from "./desktop/bag.js"
// Desktop data layer: the file-backed LocalProvider. authFetch routes to
// localFetch while a Bag is open; data reads/writes the Bag folder on disk.
import { openBagStore, closeBagStore, localFetch, isOpen as isLocalOpen, setActiveNote } from "./desktop/localStore.js"
import { createTauriFs } from "./desktop/fs/tauriFs.js"
import { createMemFs } from "./desktop/fs/memFs.js"
import { resetForGuest as resetSandboxStore } from "./hooks/sandboxStore.js"
import { resetForGuest as resetSandboxItems } from "./hooks/sandboxItemsStore.js"

// Block fields compared when diffing a plan-mode session (snapshot vs working copy).
const PLAN_EVENT_FIELDS = ['title', 'description', 'start_at', 'end_at', 'all_day', 'color', 'ref_type', 'ref_id']
const EMPTY_LIST = [] // stable ref: hidden tasks/dailies while in the Designer's blank canvas

// Lightweight loading state shown while the lazy Sandbox chunk is fetching.
// Kept minimal so it does not flash garishly against the dark Cinder shell.
function SandboxFallback() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--text-muted)',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.8rem',
      letterSpacing: '0.08em',
    }}>opening sandbox…</div>
  )
}

// Wrapper for the lazy SandBoxPage so route param + notes/tasks props are threaded in.
function SandBoxPageWrapper({ notes, tasks, toggleTaskCompletion }) {
  return <SandBoxPage notes={notes} tasks={tasks} toggleTaskCompletion={toggleTaskCompletion} mode="full" />
}

// Wrapper component to get the ID from route parameters
function NotePageWrapper({ notes, notesLoading, editTitle, editBody, updateTags, toggleFavorite, updateColor, exportNote, onNoteChange, setSidebarCollapsed, tasks, toggleTaskCompletion, addNote, updateTask, bundles}){
  const { id } = useParams()

  useEffect(() => {
    onNoteChange(id)
  }, [id, onNoteChange])

  return <NotePage notes={notes} notesLoading={notesLoading} editTitle={editTitle} editBody={editBody} updateTags={updateTags} toggleFavorite={toggleFavorite} updateColor={updateColor} exportNote={exportNote} setSidebarCollapsed={setSidebarCollapsed} tasks={tasks} toggleTaskCompletion={toggleTaskCompletion} addNote={addNote} updateTask={updateTask} bundles={bundles} />
}

function App() {

  const [isAuthed, setIsAuthed] = useState(false)
  // The open Bag (vault). Desktop has no accounts — opening a Bag is what unlocks
  // the app. `{ name, path }` or null. `unlocked` (computed below) gates the shell.
  const [currentBag, setCurrentBag] = useState(null)
  const [recentBags, setRecentBags] = useState(() => getRecentBags())
  // True while flushing one Bag and loading another (profile bag-switcher). Holds a
  // blank frame instead of flashing the picker during the swap.
  const [switching, setSwitching] = useState(false)
  const [bagBusy, setBagBusy] = useState(false)
  // Reopen the most recently used Bag on launch (desktop) so you land back inside
  // it instead of the picker. Stays true until the attempt resolves so the picker
  // never flashes first.
  const [autoOpening, setAutoOpening] = useState(() => isTauri() && !!getLastBag())
  // Launch animation — plays once per app session (not per route change / remount).
  const [showSplash, setShowSplash] = useState(() => {
    try {
      if (!sessionStorage.getItem('siddran_splash_shown')) {
        sessionStorage.setItem('siddran_splash_shown', '1')
        return true
      }
    } catch { /* sessionStorage unavailable — skip the splash */ }
    return false
  })
  // Gates the first render until the startup token check resolves, so we never
  // flash the login page (or fire protected requests) while a bootstrap refresh
  // is in flight.
  const [authReady, setAuthReady] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.innerWidth < 1090 || window.innerHeight < 600
  })
  const [currentNoteID, setCurrentNoteID] = useState(null)
  // Tell the local store which note is active so pasted images land in that
  // note's attachments folder.
  useEffect(() => { setActiveNote(currentNoteID) }, [currentNoteID])
  const [username, setUsername] = useState(null)

  // Auto-collapse sidebar on small viewports. One-way: shrink on small,
  // never auto-expand — once big again the user can toggle manually.
  useEffect(() => {
    const checkViewport = () => {
      if (window.innerWidth < 1090 || window.innerHeight < 600) {
        setIsCollapsed(true)
      }
    }
    window.addEventListener('resize', checkViewport)
    return () => window.removeEventListener('resize', checkViewport)
  }, [])

  const API = import.meta.env.VITE_API_URL || 'http://localhost:3000'


  // helper function for getting username from token
  const getUsernameToken = token => {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]))
      return payload.username
    } catch {
      return null
    }
  }

  // Read the JWT `exp` (seconds since epoch) without verifying the signature —
  // we only use this client-side to decide whether to refresh before firing
  // protected requests. The server still verifies for real.
  const getTokenExp = token => {
    try {
      return JSON.parse(atob(token.split('.')[1])).exp
    } catch {
      return null
    }
  }

  // get token and attach to `Authentication` header AS WELL AS the username
  const getAuthHeaders = useCallback(() => {
    const accessToken = localStorage.getItem('accessToken')
    return{
      'Content-Type': 'application/json',
      'Authorization': accessToken ? `Bearer ${accessToken}` : ''
    }
  }, [])

  const refreshPromiseRef = useRef(null)

  const refreshAuthToken = useCallback(async () => {
    // If a refresh is already in progress, piggyback on it
    if (refreshPromiseRef.current) return refreshPromiseRef.current

    refreshPromiseRef.current = (async () => {
      try {
        const res = await fetch(`${API}/auth/refresh`, {
          method: 'POST',
          credentials: 'include' // auto sends HttpOnly cookie
        })

        if (!res.ok) throw new Error(`Failed to refresh token`)

        const data = await res.json()
        localStorage.setItem(`accessToken`, data.accessToken)
        return data.accessToken

      } catch (refreshTokenError) {
        // failed to refresh token = logout user
        localStorage.removeItem(`accessToken`)
        setIsAuthed(false)
        throw refreshTokenError
      } finally {
        refreshPromiseRef.current = null
      }
    })()

    return refreshPromiseRef.current
  }, [API])

  // Startup auth bootstrap. Runs once on mount. The access token persists in
  // localStorage for days but expires in 15 min, so a stale token here used to
  // make every on-auth request 401 at once (the 401 storm) before recovering.
  // Instead: if the stored token is still valid we authenticate immediately
  // (zero cost); if it's expired/near-expiry we refresh ONCE before flipping
  // isAuthed, so the data hooks fire with a fresh token and never 401.
  useEffect(() => {
    const token = localStorage.getItem('accessToken')
    if (!token) {
      setAuthReady(true)
      return
    }

    const exp = getTokenExp(token)
    const stillValid = exp && exp * 1000 > Date.now() + 30_000 // 30s safety margin

    if (stillValid) {
      setIsAuthed(true)
      const u = getUsernameToken(token)
      if (u) setUsername(u)
      setAuthReady(true)
      return
    }

    // Expired/near-expiry: refresh before exposing the app so protected
    // requests never go out with the dead token.
    let cancelled = false
    refreshAuthToken()
      .then(newToken => {
        if (cancelled) return
        setIsAuthed(true)
        const u = getUsernameToken(newToken)
        if (u) setUsername(u)
      })
      .catch(() => {
        // refreshAuthToken already cleared the token + setIsAuthed(false)
      })
      .finally(() => {
        if (!cancelled) setAuthReady(true)
      })

    return () => { cancelled = true }
  }, [refreshAuthToken])

  // Mouse buttons 4/5 (side back/forward buttons) drive history navigation
  // everywhere — WebKitGTK doesn't do it by default. window.history triggers
  // popstate, which BrowserRouter (mounted below) picks up.
  useEffect(() => {
    const onDown = (e) => { if (e.button === 3 || e.button === 4) e.preventDefault() }
    const onUp = (e) => {
      if (e.button === 3) { e.preventDefault(); window.history.back() }
      else if (e.button === 4) { e.preventDefault(); window.history.forward() }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('mouseup', onUp) }
  }, [])

  // Proactive token refresh - refreshes access token every 13 minutes
  // (before the 15-minute expiry) so the user never hits a 401 during normal use
  useEffect(() => {
    if (!isAuthed) return

    const interval = setInterval(() => {
      refreshAuthToken().catch(() => {})
    }, 13 * 60 * 1000) // 13 minutes

    return () => clearInterval(interval)
  }, [isAuthed, refreshAuthToken])

  // helper function for AUTHENTICATED FETCH
  const authFetch = useCallback(async (URL, reqProps = {}) => {
    // Desktop: serve everything from the file-backed LocalProvider (the Bag on
    // disk), never the network. Module-flag check keeps this callback stable.
    if (isLocalOpen()) return localFetch(URL, reqProps)

    let res = await fetch(URL, {
      ...reqProps,
      credentials: 'include',
      headers: {
        ...getAuthHeaders(),
        ...reqProps.headers
      },
    })

    // If access token has expired (15mins), try to refresh it
    if(res.status === 401) {
      try {

        // First, try to refresh/reset access token
        await refreshAuthToken()

        // If successfully refreshed, then attempt again to call the fetch request
        res = await fetch(URL, {
          ...reqProps,
          credentials: 'include',
          headers: {
            ...getAuthHeaders(),
            ...reqProps.headers
          },
        })

      } catch (refreshError) {
        logger.error(`Token refresh failed:`, refreshError)
        localStorage.removeItem(`accessToken`)
        setIsAuthed(false)
        throw new Error('Session expired. Please login again.')

      }
    }

    return res
  }, [getAuthHeaders, refreshAuthToken])

  // The app shell is unlocked once a Bag is open.
  const unlocked = !!currentBag

  // Open a Bag: hydrate the file-backed store from the folder BEFORE unlocking
  // (so the data hooks fetch against a loaded store), reset singleton caches, and
  // show the Bag's name in the sidebar. Uses real disk under Tauri; an in-memory
  // fs in a plain browser (dev only, non-persistent).
  const openBag = useCallback(async (bag) => {
    resetSandboxStore()      // drop any cached board list from a prior Bag
    resetSandboxItems()      // drop any cached board items
    const fs = isTauri() ? createTauriFs() : createMemFs()
    await openBagStore(fs, bag.path)   // read the Bag folder into memory
    setCurrentBag(bag)
    setUsername(bag.name)
    addRecentBag(bag)
    setRecentBags(getRecentBags())
  }, [])

  // Auto-reopen the last Bag on launch. Verifies the folder still exists first, so
  // a moved/deleted Bag falls through to the picker instead of resurrecting an
  // empty one. Runs once on mount.
  useEffect(() => {
    if (!autoOpening) return
    let cancelled = false
    ;(async () => {
      const last = getLastBag()
      try {
        if (last) {
          const fs = isTauri() ? createTauriFs() : createMemFs()
          if (await fs.exists(last.path)) await openBag(last)
        }
      } catch (err) { logger.error('auto-open last bag failed', err) }
      finally { if (!cancelled) setAutoOpening(false) }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleOpenBag = useCallback(async () => {
    setBagBusy(true)
    try { const bag = await pickExistingBag(); if (bag) await openBag(bag) }
    catch (err) { logger.error('open bag failed', err) }
    finally { setBagBusy(false) }
  }, [openBag])

  const handleCreateBag = useCallback(async () => {
    setBagBusy(true)
    try { const bag = await createBag(); if (bag) await openBag(bag) }
    catch (err) { logger.error('create bag failed', err) }
    finally { setBagBusy(false) }
  }, [openBag])

  // Open a Bag straight from the Recent list (no folder dialog).
  const handleOpenRecent = useCallback(async (bag) => {
    setBagBusy(true)
    try { await openBag(bag) }
    catch (err) { logger.error('open recent bag failed', err) }
    finally { setBagBusy(false) }
  }, [openBag])

  // Forget a Bag from the picker list (the folder on disk is left untouched).
  const handleRemoveRecent = useCallback((bag) => {
    setRecentBags(removeRecentBag(bag.path))
  }, [])

  // Close the current Bag → flush to disk, then back to the Bag picker. Threaded
  // into the Sidebar in place of "logout".
  const closeBag = useCallback(async () => {
    try { await closeBagStore() } catch (err) { logger.error('close bag flush failed', err) }
    setCurrentBag(null)
    setUsername(null)
  }, [])

  // Switch straight from one open Bag to another (the sidebar profile bag-switcher).
  // Flush the current Bag to disk, briefly unmount the shell (so the data hooks reset
  // and refetch against the new store), reset the URL so the router doesn't try to
  // restore a note id that only exists in the old Bag, then open the new one.
  const switchBag = useCallback(async (bag) => {
    if (!bag || (currentBag && bag.path === currentBag.path)) return
    setSwitching(true)
    try {
      await closeBagStore()
      try { window.history.replaceState(null, '', '/') } catch { /* ignore */ }
      setCurrentBag(null)
      setUsername(null)
      await openBag(bag)
    } catch (err) { logger.error('switch bag failed', err) }
    finally { setSwitching(false) }
  }, [openBag, currentBag])


  // ------------- DATA LOGIC (Adding, deleting, etc. of Notes and Notebooks) ===================================
  const {
    notes, notebooks, loading: notesLoading, notebookNotesById, notesPagination, notebooksPagination, loadMoreNotes, loadMoreNotebooks, loadingMore, addNote, deleteNote, editTitle, editBody, toggleFavorite, updateColor, updateTags, createNotebook, deleteNotebook, toggleFavoriteNotebook, updateNotebookColor, updateNotebookTags, renameNotebook, removeNoteFromNotebook, addNotesToNotebook, importMarkdownFiles, exportNote, reorderNotes, reorderNotebooks
  } = useNotes(authFetch, API, unlocked)

  // ------------- TASKS DATA LOGIC ===================================
  const {
    tasks, dailyTasks, bundles, tasksPagination, dailyTasksPagination, bundlesPagination, loadMoreTasks, loadMoreDailyTasks, loadMoreBundles, loadingMore: tasksLoadingMore, loading: tasksLoading, addTask, updateTask, patchTaskInCache, setDailyTime, deleteTask, toggleTaskCompletion, addDailyTask, updateDailyTask, deleteDailyTask, toggleDailyTaskCompletion, batchToggleDailyTasks, batchDeleteDailyTasks, addBundle, updateBundle, deleteBundle, addBundleTasks, batchUpdateBundleTasks, toggleBundleTaskCompletion, batchDeleteBundleTasks
  } = useTasks(authFetch, API, unlocked)

  // ------------- CALENDAR DATA LOGIC ===================================
  const calView = useCalendarView()
  // Lazy-load: only fetch calendar data once the calendar is actually used (peek opened/pinned, or
  // the /calendar route mounts) — so Notes/Tasks/etc. don't fire events + task requests on every load.
  const [calendarActive, setCalendarActive] = useState(false)
  const activateCalendar = useCallback(() => setCalendarActive(true), [])
  useEffect(() => { if (!calView.isHidden) setCalendarActive(true) }, [calView.isHidden])

  // Lifted to App level so the root-mounted peek and the /calendar route share one source.
  const {
    events: calendarEvents, addEvent, updateEvent, deleteEvent, addEvents, removeEventsBySchedule, recolorEventsBySchedule
  } = useCalendarEvents(authFetch, API, unlocked && calendarActive)
  const { schedules, createSchedule, restampSchedule, deleteSchedule, updateSchedule } = useSchedules(authFetch, API, unlocked && calendarActive)
  // Derived from the shared useTasks store (single source of truth) — new/edited
  // tasks reflect on the calendar live, and there's no second copy to duplicate.
  const { tasks: calendarTasks, undated: calendarUndated } = useCalendarTasks(tasks)
  // Recurring dailies + per-day completions (gated the same way so non-calendar pages stay quiet).
  const {
    recurringDailies, completions: dailyCompletions, toggleCompletion, addRecurring, removeRecurring
  } = useCalendarDailies(authFetch, API, unlocked && calendarActive)
  // Ephemeral ("today's") dailies come from the SHARED useTasks store (single source) so TasksHub
  // add/delete/edit reflect on the calendar live, with no refetch.
  const ephemeralDailies = useMemo(() => dailyTasks.filter(d => d.recurrence == null), [dailyTasks])

  // Retime/schedule/unschedule a task: patch the shared store immediately
  // (optimistic — the derived calendar lists update at once) and persist via
  // updateTask. Both act on the same useTasks store the calendar now reads.
  const onTaskRetime = useCallback((id, patch) => {
    patchTaskInCache(id, patch)
    updateTask(id, patch)
  }, [patchTaskInCache, updateTask])
  const onTaskSchedule = useCallback((taskId, due) => {
    patchTaskInCache(taskId, { due_date: due })
    updateTask(taskId, { due_date: due })
  }, [patchTaskInCache, updateTask])
  const onTaskUnschedule = useCallback((taskId) => {
    patchTaskInCache(taskId, { due_date: null })
    updateTask(taskId, { due_date: null })
  }, [patchTaskInCache, updateTask])

  // Persist a daily task from ANY surface (TasksHub, calendar quick-add, calendar create-modal) and,
  // if it's recurring, inject it into the calendar's separate recurring set so it plots immediately
  // (the two stores are separate).
  const createDailyTask = useCallback(async (title, priority, opts) => {
    const created = await addDailyTask(title, priority, opts)
    if (created && created.recurrence != null) addRecurring(created)
    return created
  }, [addDailyTask, addRecurring])

  // Quick-Add "Daily" (calendar): always 'normal' priority.
  const onCreateDaily = useCallback((title, opts) => createDailyTask(title, 'normal', opts), [createDailyTask])

  // AddTaskCard creates tasks (incl. daily drafts) via addTask; mirror any recurring dailies it
  // returns into the calendar's recurring set so they plot without a refetch.
  const addTaskSynced = useCallback(async (title, description, priority, dueDate, taskType) => {
    const result = await addTask(title, description, priority, dueDate, taskType)
    if (taskType === 'daily' && Array.isArray(result)) {
      for (const row of result) if (row?.recurrence != null) addRecurring(row)
    }
    return result
  }, [addTask, addRecurring])

  // Edit a daily and keep the calendar's recurring set in sync: a patch that sets recurrence adds/
  // updates the row there; clearing it (→ one-off) removes it. Used by TasksHub's per-task control.
  const updateDailyTaskSynced = useCallback(async (id, patch) => {
    const updated = await updateDailyTask(id, patch)
    if (updated && patch && Object.prototype.hasOwnProperty.call(patch, 'recurrence')) {
      if (updated.recurrence != null) addRecurring(updated)
      else removeRecurring(updated.id)
    }
    return updated
  }, [updateDailyTask, addRecurring, removeRecurring])

  // Ephemeral-daily edits from the calendar go straight through useTasks (shared store) so both
  // TasksHub and the calendar reflect them: onDailyTime = setDailyTime, onDailyDone = toggleDailyTaskCompletion.

  // ---- Plan mode (blocks-first): a transactional session over calendar BLOCKS. Enter snapshots the
  // events; while planning, block edits are staged in a working copy (NOT persisted) — new blocks are
  // ghosts, moved/resized/edited ones are marked; Apply diffs snapshot↔working → real mutations;
  // Discard drops the working copies. Plannable kinds: BLOCKS, dated TASKS (reschedule), UNDATED tasks
  // (schedule onto the grid), and ephemeral DAILIES (within-day time). Recurring dailies are excluded.
  const [planning, setPlanning] = useState(false)
  const [planSnapshot, setPlanSnapshot] = useState([]); const [planEvents, setPlanEvents] = useState([])
  const [planTaskSnap, setPlanTaskSnap] = useState([]); const [planTasks, setPlanTasks] = useState([])
  const [planUndatedSnap, setPlanUndatedSnap] = useState([]); const [planUndated, setPlanUndated] = useState([])
  const [planEphSnap, setPlanEphSnap] = useState([]); const [planEph, setPlanEph] = useState([])
  const planTempId = useRef(0)

  const enterPlan = useCallback(() => {
    const cp = arr => arr.map(x => ({ ...x }))
    setPlanSnapshot(cp(calendarEvents)); setPlanEvents(cp(calendarEvents))
    setPlanTaskSnap(cp(calendarTasks)); setPlanTasks(cp(calendarTasks))
    setPlanUndatedSnap(cp(calendarUndated)); setPlanUndated(cp(calendarUndated))
    setPlanEphSnap(cp(ephemeralDailies)); setPlanEph(cp(ephemeralDailies))
    setPlanning(true)
  }, [calendarEvents, calendarTasks, calendarUndated, ephemeralDailies])
  const discardPlan = useCallback(() => {
    setPlanning(false)
    setPlanEvents([]); setPlanSnapshot([]); setPlanTasks([]); setPlanTaskSnap([])
    setPlanUndated([]); setPlanUndatedSnap([]); setPlanEph([]); setPlanEphSnap([])
  }, [])
  const applyPlan = useCallback(() => {
    // blocks
    const evSnapIds = new Set(planSnapshot.map(e => e.id)); const evWorkIds = new Set(planEvents.map(e => e.id)); const evSnapById = new Map(planSnapshot.map(e => [e.id, e]))
    for (const e of planSnapshot) if (!evWorkIds.has(e.id)) deleteEvent(e.id)
    for (const e of planEvents) {
      const payload = { title: e.title, description: e.description, start_at: e.start_at, end_at: e.end_at, all_day: e.all_day, color: e.color, ref_type: e.ref_type, ref_id: e.ref_id }
      if (!evSnapIds.has(e.id)) addEvent(payload)
      else if (PLAN_EVENT_FIELDS.some(f => evSnapById.get(e.id)[f] !== e[f])) updateEvent(e.id, payload)
    }
    // tasks: reschedule (dated, due_date changed) or schedule (was undated → now dated)
    const tSnapById = new Map(planTaskSnap.map(t => [t.id, t])); const undatedSnapIds = new Set(planUndatedSnap.map(t => t.id))
    for (const t of planTasks) {
      const o = tSnapById.get(t.id)
      if (!o) { if (undatedSnapIds.has(t.id)) onTaskSchedule(t.id, t.due_date) }
      else if (o.due_date !== t.due_date) onTaskRetime(t.id, { due_date: t.due_date })
    }
    // tasks: unschedule (was dated in the snapshot → now in the undated working copy)
    for (const t of planUndated) if (tSnapById.has(t.id)) onTaskUnschedule(t.id)
    // ephemeral dailies: time set/cleared
    const ephSnapById = new Map(planEphSnap.map(d => [d.id, d]))
    for (const d of planEph) { const o = ephSnapById.get(d.id); if (o && (o.time || null) !== (d.time || null)) setDailyTime(d.id, d.time) }
    discardPlan()
  }, [planSnapshot, planEvents, planTaskSnap, planTasks, planUndated, planUndatedSnap, planEphSnap, planEph, addEvent, updateEvent, deleteEvent, onTaskRetime, onTaskSchedule, onTaskUnschedule, setDailyTime, discardPlan])

  // Staged mutations — used in place of the real ones while a session is active.
  const stagedAddEvent = useCallback((payload) => { const id = `plan-${planTempId.current++}`; setPlanEvents(prev => [...prev, { id, description: null, ...payload }]) }, [])
  const stagedUpdateEvent = useCallback((id, patch) => setPlanEvents(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e)), [])
  const stagedDeleteEvent = useCallback((id) => setPlanEvents(prev => prev.filter(e => e.id !== id)), [])
  const stagedRetimeTask = useCallback((id, patch) => setPlanTasks(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t)), [])
  const stagedScheduleTask = useCallback((id, due) => {
    const moved = planUndated.find(t => t.id === id)
    if (!moved) return
    setPlanUndated(prev => prev.filter(t => t.id !== id))
    setPlanTasks(prev => [...prev, { ...moved, due_date: due }])
  }, [planUndated])
  const stagedUnscheduleTask = useCallback((id) => {
    const moved = planTasks.find(t => t.id === id)
    if (!moved) return
    setPlanTasks(prev => prev.filter(t => t.id !== id))
    setPlanUndated(prev => [{ ...moved, due_date: null }, ...prev])
  }, [planTasks])
  const stagedSetDailyTime = useCallback((id, time) => setPlanEph(prev => prev.map(d => d.id === id ? { ...d, time } : d)), [])

  // Working copies annotated with plan state (new/edited) for draft styling.
  const planAnnotated = useMemo(() => {
    if (!planning) return calendarEvents
    const snapById = new Map(planSnapshot.map(e => [e.id, e]))
    return planEvents.map(e => { const o = snapById.get(e.id); const s = !o ? 'new' : (PLAN_EVENT_FIELDS.some(f => o[f] !== e[f]) ? 'edited' : null); return s ? { ...e, _planState: s } : e })
  }, [planning, planEvents, planSnapshot, calendarEvents])
  const planTasksAnnotated = useMemo(() => {
    if (!planning) return calendarTasks
    const snapById = new Map(planTaskSnap.map(t => [t.id, t]))
    return planTasks.map(t => { const o = snapById.get(t.id); const s = (!o || o.due_date !== t.due_date) ? 'edited' : null; return s ? { ...t, _planState: s } : t })
  }, [planning, planTasks, planTaskSnap, calendarTasks])
  const planEphAnnotated = useMemo(() => {
    if (!planning) return ephemeralDailies
    const snapById = new Map(planEphSnap.map(d => [d.id, d]))
    return planEph.map(d => { const o = snapById.get(d.id); const s = (o && (o.time || null) !== (d.time || null)) ? 'edited' : null; return s ? { ...d, _planState: s } : d })
  }, [planning, planEph, planEphSnap, ephemeralDailies])

  const planPending = useMemo(() => {
    if (!planning) return { total: 0 }
    let n = 0
    const evSnapIds = new Set(planSnapshot.map(e => e.id)); const evWorkIds = new Set(planEvents.map(e => e.id)); const evSnapById = new Map(planSnapshot.map(e => [e.id, e]))
    for (const e of planEvents) { if (!evSnapIds.has(e.id)) n++; else if (PLAN_EVENT_FIELDS.some(f => evSnapById.get(e.id)[f] !== e[f])) n++ }
    for (const e of planSnapshot) if (!evWorkIds.has(e.id)) n++
    const tSnapById = new Map(planTaskSnap.map(t => [t.id, t]))
    for (const t of planTasks) { const o = tSnapById.get(t.id); if (!o || o.due_date !== t.due_date) n++ }
    for (const t of planUndated) if (tSnapById.has(t.id)) n++ // unscheduled (dated → undated)
    const ephSnapById = new Map(planEphSnap.map(d => [d.id, d]))
    for (const d of planEph) { const o = ephSnapById.get(d.id); if (o && (o.time || null) !== (d.time || null)) n++ }
    return { total: n }
  }, [planning, planEvents, planSnapshot, planTasks, planTaskSnap, planUndated, planEph, planEphSnap])

  // ---- Schedule Designer: a blank-canvas mode to design a weekly timetable, then stamp it across a
  // date range as a named "schedule" (a group of concrete blocks). While designing, the calendar shows
  // ONLY the plotted working set (real items hidden); Apply → POST /schedules; close → drop the plot.
  const [designing, setDesigning] = useState(false)
  const [plotEvents, setPlotEvents] = useState([])
  const [editingSchedule, setEditingSchedule] = useState(null) // the schedule being edited in place (or null = new)
  const [dismissedConflicts, setDismissedConflicts] = useState(() => new Set())
  const plotTempId = useRef(0)
  const enterDesigner = useCallback((seed = [], editing = null) => { setPlotEvents(seed); setEditingSchedule(editing); setDismissedConflicts(new Set()); setDesigning(true); calView.setView('week') }, [calView])
  const exitDesigner = useCallback(() => { setDesigning(false); setPlotEvents([]); setEditingSchedule(null); setDismissedConflicts(new Set()) }, [])
  const plotAddEvent = useCallback((payload) => { const id = `plot-${plotTempId.current++}`; setPlotEvents(prev => [...prev, { id, description: null, ...payload }]) }, [])
  const plotUpdateEvent = useCallback((id, patch) => setPlotEvents(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e)), [])
  const plotDeleteEvent = useCallback((id) => setPlotEvents(prev => prev.filter(e => e.id !== id)), [])
  const dismissConflict = useCallback((id) => setDismissedConflicts(prev => new Set(prev).add(id)), [])
  // Timed plotted blocks that overlap another on the same weekday → flagged as conflicts (dismissable).
  const plotConflicts = useMemo(() => {
    const ids = new Set()
    const info = plotEvents.filter(e => !e.all_day && e.start_at).map(e => {
      const s = new Date(e.start_at), en = e.end_at ? new Date(e.end_at) : null
      const sm = s.getHours() * 60 + s.getMinutes()
      const em = en ? en.getHours() * 60 + en.getMinutes() : sm + 60
      return { id: e.id, wd: s.getDay(), sm, em: Math.max(em, sm + 1) }
    })
    for (let i = 0; i < info.length; i++) for (let j = i + 1; j < info.length; j++) {
      const a = info[i], b = info[j]
      if (a.wd === b.wd && a.sm < b.em && b.sm < a.em) { ids.add(a.id); ids.add(b.id) }
    }
    return ids
  }, [plotEvents])
  const plotAnnotated = useMemo(() => plotEvents.map(e => ({ ...e, _planState: 'new', _conflict: plotConflicts.has(e.id) && !dismissedConflicts.has(e.id) })), [plotEvents, plotConflicts, dismissedConflicts])
  const applyDesign = useCallback(async ({ name, color, from, to, exclude }) => {
    const events = stampWeeklyPattern(plotEvents, from, to, exclude || [])
    if (!events.length) return
    const colored = color ? events.map(e => ({ ...e, color: e.color || color })) : events
    // Store the pattern AND the apply context (range + skips) so Edit can prefill From/To/Skip.
    const template = { pattern: patternFromPlot(plotEvents), from, to, skip: exclude || [] }
    if (editingSchedule) {
      // Edit in place: replace this schedule's blocks with the freshly-stamped set.
      const result = await restampSchedule(editingSchedule.id, { name, color: color || null, events: colored, template })
      if (result) { removeEventsBySchedule(editingSchedule.id); addEvents(result.events); exitDesigner() }
    } else {
      const result = await createSchedule({ name, color: color || null, events: colored, template })
      if (result) { addEvents(result.events); exitDesigner() }
    }
  }, [plotEvents, editingSchedule, createSchedule, restampSchedule, addEvents, removeEventsBySchedule, exitDesigner])
  // template is { pattern, from, to, skip } (new) or a bare pattern array (legacy) — extract the pattern.
  const patternOf = (tpl) => Array.isArray(tpl) ? tpl : (tpl?.pattern || [])
  // Duplicate: load a saved schedule's pattern into the Designer to tweak + save as a NEW schedule.
  const onReopenSchedule = useCallback((schedule) => { enterDesigner(plotFromPattern(patternOf(schedule.template), calView.focusedDay), null) }, [enterDesigner, calView])
  // Edit in place: load the pattern AND remember which schedule we're updating (Apply replaces its blocks).
  const onEditSchedule = useCallback((schedule) => { enterDesigner(plotFromPattern(patternOf(schedule.template), calView.focusedDay), schedule) }, [enterDesigner, calView])

  // Schedule management — reflect the DB op in the events cache.
  const onDeleteSchedule = useCallback(async (id) => { if (await deleteSchedule(id)) removeEventsBySchedule(id) }, [deleteSchedule, removeEventsBySchedule])
  const onRecolorSchedule = useCallback(async (id, color) => { if (await updateSchedule(id, { color })) recolorEventsBySchedule(id, color) }, [updateSchedule, recolorEventsBySchedule])
  const onRenameSchedule = useCallback((id, name) => updateSchedule(id, { name }), [updateSchedule])

  // Effective sources + mutations: designer (blank plot) > plan session (staged) > real.
  const effEvents = designing ? plotAnnotated : (planning ? planAnnotated : calendarEvents)
  const effAddEvent = designing ? plotAddEvent : (planning ? stagedAddEvent : addEvent)
  const effUpdateEvent = designing ? plotUpdateEvent : (planning ? stagedUpdateEvent : updateEvent)
  const effDeleteEvent = designing ? plotDeleteEvent : (planning ? stagedDeleteEvent : deleteEvent)
  const effTasks = designing ? EMPTY_LIST : (planning ? planTasksAnnotated : calendarTasks)
  const effUndated = designing ? EMPTY_LIST : (planning ? planUndated : calendarUndated)
  const effEphemeral = designing ? EMPTY_LIST : (planning ? planEphAnnotated : ephemeralDailies)
  const effOnTaskRetime = planning ? stagedRetimeTask : onTaskRetime
  const effOnTaskSchedule = planning ? stagedScheduleTask : onTaskSchedule
  const effOnTaskUnschedule = planning ? stagedUnscheduleTask : onTaskUnschedule
  const effOnDailyTime = planning ? stagedSetDailyTime : setDailyTime
  // The peek is a glance at the REAL calendar — never the Designer's blank scratch plot.
  const peekEvents = designing ? calendarEvents : effEvents
  const peekTasks = designing ? calendarTasks : effTasks

  // Global Cmd/Ctrl+; toggles the peek; Esc closes it (when not typing in a field).
  useEffect(() => {
    if (!unlocked) return
    const onKey = (e) => {
      const el = document.activeElement
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if ((e.metaKey || e.ctrlKey) && e.key === ';') {
        if (typing) return
        e.preventDefault()
        calView.toggle()
      } else if (e.key === 'Escape' && !calView.isHidden && !typing) {
        calView.close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [unlocked, calView])

  // Auto-collapse the sidebar while the calendar is pinned to the half-split.
  useEffect(() => {
    if (calView.isHalf) setIsCollapsed(true)
  }, [calView.isHalf])

  // Props shared by the /calendar route and the half-split pane.
  const calendarProps = {
    authFetch, API,
    events: effEvents,
    addEvent: effAddEvent, updateEvent: effUpdateEvent, deleteEvent: effDeleteEvent,
    planning, enterPlan, applyPlan, discardPlan, planPending,
    designing, enterDesigner, exitDesigner, applyDesign, onDismissConflict: dismissConflict, editingSchedule,
    schedules, onDeleteSchedule, onRecolorSchedule, onRenameSchedule, onReopenSchedule, onEditSchedule,
    dailyTasks: recurringDailies, // all recurring dailies (not useTasks' paginated first page)
    ephemeralDailies: effEphemeral, // active one-off "today's tasks" — Day view + Week/Month badge
    dailyCompletions,
    onToggleDaily: toggleCompletion,
    onDailyTime: effOnDailyTime,
    onDailyDone: toggleDailyTaskCompletion,
    onCreateDaily,
    tasks: effTasks,
    undated: effUndated,
    onTaskRetime: effOnTaskRetime, onTaskSchedule: effOnTaskSchedule, onTaskUnschedule: effOnTaskUnschedule,
    onActivate: activateCalendar,
  }

  // Resizable half-split: halfPct = the calendar pane's width %. Drag the divider to adjust.
  const [halfPct, setHalfPct] = useState(() => {
    const v = Number(localStorage.getItem('cinder_cal_half_pct'))
    return v >= 25 && v <= 75 ? v : 50
  })
  const contentRowRef = useRef(null)
  const leftPaneRef = useRef(null)
  const splitDragRef = useRef(false)
  const latestPctRef = useRef(halfPct)
  const onSplitDown = (e) => { splitDragRef.current = true; try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* */ } }
  // Resize imperatively during the drag (no React re-render → the calendar pane doesn't repaint
  // every frame), then commit to state + localStorage on release.
  const onSplitMove = (e) => {
    if (!splitDragRef.current) return
    const r = contentRowRef.current?.getBoundingClientRect()
    if (!r) return
    const pct = Math.min(75, Math.max(25, ((r.right - e.clientX) / r.width) * 100))
    latestPctRef.current = pct
    if (leftPaneRef.current) leftPaneRef.current.style.flex = `0 0 ${100 - pct}%`
  }
  const onSplitUp = (e) => {
    splitDragRef.current = false
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* */ }
    setHalfPct(latestPctRef.current)
    try { localStorage.setItem('cinder_cal_half_pct', String(Math.round(latestPctRef.current))) } catch { /* */ }
  }


  //  Elements area
  const notesHubElement = (
    <NotesHub notes={notes}
    notebooks={notebooks}
    notesLoading={notesLoading}
    notebookNotesById={notebookNotesById}
    notesPagination={notesPagination}
    notebooksPagination={notebooksPagination}
    loadMoreNotes={loadMoreNotes}
    loadMoreNotebooks={loadMoreNotebooks}
    loadingMore={loadingMore}
    addNote={addNote}
    deleteNote={deleteNote}
    toggleFavorite={toggleFavorite}
    updateColor={updateColor}
    createNotebook={createNotebook}
    deleteNotebook={deleteNotebook}
    toggleFavoriteNotebook={toggleFavoriteNotebook}
    updateNotebookColor={updateNotebookColor}
    updateNotebookTags={updateNotebookTags}
    renameNotebook={renameNotebook}
    removeNoteFromNotebook={removeNoteFromNotebook}
    addNotesToNotebook={addNotesToNotebook}
    importMarkdownFiles={importMarkdownFiles}
    reorderNotes={reorderNotes}
    reorderNotebooks={reorderNotebooks}
    authFetch={authFetch}
    API={API}/>
  )
  const tasksHubElement = (
    <TasksHub
      authFetch={authFetch}
      API={API}
      tasks={tasks}
      dailyTasks={dailyTasks}
      tasksPagination={tasksPagination}
      dailyTasksPagination={dailyTasksPagination}
      loadMoreTasks={loadMoreTasks}
      loadMoreDailyTasks={loadMoreDailyTasks}
      loadingMore={tasksLoadingMore}
      loading={tasksLoading}
      addTask={addTaskSynced}
      updateTask={updateTask}
      deleteTask={deleteTask}
      toggleTaskCompletion={toggleTaskCompletion}
      addDailyTask={createDailyTask}
      updateDailyTask={updateDailyTaskSynced}
      deleteDailyTask={deleteDailyTask}
      toggleDailyTaskCompletion={toggleDailyTaskCompletion}
      batchToggleDailyTasks={batchToggleDailyTasks}
      batchDeleteDailyTasks={batchDeleteDailyTasks}
      bundles={bundles}
      bundlesPagination={bundlesPagination}
      loadMoreBundles={loadMoreBundles}
      addBundle={addBundle}
      updateBundle={updateBundle}
      deleteBundle={deleteBundle}
      addBundleTasks={addBundleTasks}
      batchUpdateBundleTasks={batchUpdateBundleTasks}
      toggleBundleTaskCompletion={toggleBundleTaskCompletion}
      batchDeleteBundleTasks={batchDeleteBundleTasks}
    />
  )

  // --cinder-sidebar-w exposes the sidebar's current width so full-bleed pages
  // (e.g. SandBoxPage) can absolutely-position themselves flush against it
  // without re-implementing the collapse logic.
  const sidebarW = unlocked ? (isCollapsed ? '0px' : '220px') : '0px'
  const style = {
    backgroundColor: "var(--bg-primary)",
    color: "var(--text-primary)",
    minHeight: "100vh",
    margin: 0,
    padding: 0,
    '--cinder-sidebar-w': sidebarW,
  };

  // Launch animation (once per session). Placed after all hooks so the auth/auto-open
  // effects keep running underneath while it plays — the app is ready by the time it
  // dismisses. `style` gives it the themed background behind the transparent overlay.
  if (showSplash) {
    return (
      <div style={{ ...style, minHeight: '100vh' }}>
        <SplashScreen onDone={() => setShowSplash(false)} />
      </div>
    )
  }

  // Hold the first paint until startup resolves.
  if (!authReady) {
    return <div style={{ ...style, minHeight: '100vh' }} />
  }

  // No Bag open → the desktop entry screen (no login, no accounts). While the
  // last Bag is being reopened on launch, hold a blank frame instead of flashing
  // the picker.
  if (!currentBag) {
    if (autoOpening || switching) return <div style={{ ...style, minHeight: '100vh' }} />
    return (
      <BagPicker
        recentBags={recentBags}
        onOpen={handleOpenBag}
        onCreate={handleCreateBag}
        onOpenRecent={handleOpenRecent}
        onRemoveRecent={handleRemoveRecent}
        busy={bagBusy}
      />
    )
  }


  return (

    <SettingsProvider authFetch={authFetch} API={API} isAuthed={unlocked}>
    <ApiProvider authFetch={authFetch} API={API} isAuthed={unlocked}>
    <SandboxViewProvider>
    <NoteSplitProvider>
    <PdfViewProvider>
    <div style={style}>

      {unlocked && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: '1px',
          background: 'linear-gradient(90deg, transparent 0%, rgba(240,184,64,0.3) 30%, rgba(240,184,64,0.5) 50%, rgba(240,184,64,0.3) 70%, transparent 100%)',
          zIndex: 999,
          pointerEvents: 'none',
        }} />
      )}

      <BrowserRouter>
        <NoteTabsProvider>
        <SidebarContext.Provider value={{ collapsed: isCollapsed, setCollapsed: setIsCollapsed }}>
        {/* Background effects — inside Router so StarCanvas can use useLocation() */}
        <StarCanvas />
        {/* "Show sidebar" button for pages without their own toolbar (Hubs/Calendar) */}
        {unlocked && <GlobalExpandButton />}
        <div style={{ display: "flex",
          flexDirection: "row",
          height: '100vh',
          margin: 0,
          padding: 0,
          backgroundColor: 'transparent',
          position: 'relative',
          zIndex: 5,
        }}>

          {/* Sidebar stays MOUNTED and slides off-canvas when collapsed (see the
              `.hidden` transform in Sidebar.module.css) — remounting it on every
              toggle re-rendered the whole notes list and caused the collapse lag.
              Expand via the contextual "show sidebar" buttons (tab bar / sandbox
              header / floating). */}
          {unlocked && (
            <Sidebar username={username}
              isCollapsed={isCollapsed}
              toggleSidebar={setIsCollapsed}
              notes={notes}
              notebooks={notebooks}
              currentNoteID={currentNoteID}
              setIsAuthed={closeBag}
              recentBags={recentBags}
              currentBagPath={currentBag?.path}
              onSwitchBag={switchBag}
            />
          )}


          {/* Blank space reserved for the fixed sidebar (0 when hidden). Reserved
              instantly (no width transition): animating width reflows the content —
              and the CodeMirror editor — every frame, which is what felt laggy. The
              sidebar itself still glides via its transform transition. */}
          {unlocked && (
            <div style={{
              width: isCollapsed ? '0px' : '220px',
              flexShrink: 0,  /* Prevents this from shrinking */
            }} />
          )}


          {/* The main page/s (the contents on the right, not sidebar). When the calendar is
              pinned, this becomes a 1fr/1fr split: routed content left, calendar pane right. */}
          <div ref={contentRowRef} style={{ flex: 1,
            display: 'flex',
            flexDirection: 'row',
            backgroundColor: 'transparent',
            minWidth: 0,  /* Allows flex item to shrink below content size */
            position: 'relative',
            /* Above the fixed sidebar (z-index 1000) so modal backdrops rendered inside this
               stacking context cover the full viewport — including the sidebar — instead of being
               trapped behind it. Content only overlaps the sidebar via those fixed backdrops. */
            zIndex: 1001,
          }}>
            <div ref={leftPaneRef} style={{
              flex: (unlocked && calView.isHalf) ? `0 0 ${100 - halfPct}%` : 1,
              padding: unlocked ? '0 40px' : '0',
              overflowY: 'auto',
              minWidth: 0,
            }}>

            {/* A Bag is always open here (else the BagPicker rendered instead). */}
            <Routes>
                  <Route path="/" element={notesHubElement} />
                  <Route path="/notes" element={notesHubElement} />
                  <Route path="/notes/:id" element={
                    <NotePageWrapper notes={notes}
                      addNote={addNote}
                      updateTask={updateTask}
                      bundles={bundles}
                      notesLoading={notesLoading}
                      editTitle={editTitle}
                      editBody={editBody}
                      updateTags={updateTags}
                      toggleFavorite={toggleFavorite}
                      updateColor={updateColor}
                      exportNote={exportNote}
                      onNoteChange={setCurrentNoteID}
                      setSidebarCollapsed={setIsCollapsed}
                      tasks={tasks}
                      toggleTaskCompletion={toggleTaskCompletion}
                      />
                    }
                  />
                  {/* <Route path="/notebooks/:id" element={Notebook} */}

                  <Route path="/tasks" element={tasksHubElement} />
                  <Route path="/sandboxes" element={
                    <Suspense fallback={<SandboxFallback />}>
                      <SandBoxes />
                    </Suspense>
                  } />
                  <Route path="/sandboxes/:id" element={
                    <Suspense fallback={<SandboxFallback />}>
                      <SandBoxPageWrapper notes={notes} tasks={tasks} toggleTaskCompletion={toggleTaskCompletion} />
                    </Suspense>
                  } />
                  <Route path="/calendar" element={<Calendar {...calendarProps} mode="full" />} />
                  <Route path="*" element={<NotFoundPage />} />
            </Routes>
            </div>

            {/* Calendar half-split pane (peek pinned) — draggable divider to resize. */}
            {unlocked && calView.isHalf && (
              <>
                <div
                  onPointerDown={onSplitDown}
                  onPointerMove={onSplitMove}
                  onPointerUp={onSplitUp}
                  title="Drag to resize"
                  style={{ flex: '0 0 6px', cursor: 'col-resize', backgroundColor: 'var(--border-default)', touchAction: 'none', zIndex: 6 }}
                />
                <div style={{
                  flex: '1 1 0',
                  minWidth: 0,
                  overflowY: 'auto',
                  backgroundColor: 'var(--bg-surface)',
                }}>
                  <Calendar {...calendarProps} mode="half" />
                </div>
              </>
            )}
          </div>
        </div>

        {/* Calendar peek drawer (root-mounted so it persists across routes) */}
        {unlocked && (
          <CalendarPeek
            events={peekEvents}
            tasks={peekTasks}
            dailyTasks={recurringDailies}
            dailyCompletions={dailyCompletions}
            onToggleDaily={toggleCompletion}
            addEvent={effAddEvent}
            onCreateDaily={onCreateDaily}
          />
        )}

        {/* Settings popup (rendered at app level, controlled by context) */}
        {unlocked && <SettingsPopup />}

        {/* Command palette (Ctrl/Cmd+Shift+P) — inside Router for navigation commands */}
        <CommandPalette notes={notes} tasks={tasks} addNote={addNote} closeBag={closeBag} />

        {/* Toast notifications (always available) */}
        <ToastContainer />

        </SidebarContext.Provider>
        </NoteTabsProvider>
      </BrowserRouter>
    </div>
    </PdfViewProvider>
    </NoteSplitProvider>
    </SandboxViewProvider>
    </ApiProvider>
    </SettingsProvider>

  )
}

export default App
