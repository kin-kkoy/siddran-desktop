import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import { useSearchParams } from "react-router-dom"
import { toast } from "../../utils/toast"
import TaskCard from "../../components/Tasks/TaskCard"
import AddTaskCard from "../../components/Tasks/AddTaskCard"
import styles from './TasksHub.module.css'
import DailyTaskCard from "../../components/Tasks/DailyTaskCard"
import ConfirmModal from "../../components/Common/ConfirmModal"
import TaskDetailsModal from "../../components/Common/TaskDetailsModal"
import DailyTaskModal from "../../components/Common/DailyTaskModal"
import { HiOutlineTrash, HiOutlineViewGrid, HiOutlineTemplate, HiOutlineViewBoards } from 'react-icons/hi'
import { LuCalendarDays } from 'react-icons/lu'
import BundleCard from "../../components/Tasks/BundleCard"
import {
  readPlacements, writePlacements, placementFor, setPlacement, prunePlacements,
  ROUTINES_COL, DAILY_KEY, bundleKey,
} from "../../hooks/kanbanBoard"
import BundleDetailModal from "../../components/Common/BundleDetailModal"
import { useRowMasonry } from '../../hooks/useRowMasonry'
import Skeleton from "../../components/Common/Skeleton"
import { useCalendarView } from '../../contexts/CalendarViewContext'

function TasksHub({
  authFetch,
  API,
  tasks,
  dailyTasks,
  tasksPagination,
  dailyTasksPagination,
  loadMoreTasks,
  loadMoreDailyTasks,
  loadingMore,
  loading,
  addTask,
  updateTask,
  deleteTask, setTaskOrders,
  toggleTaskCompletion,
  addDailyTask,
  updateDailyTask,
  deleteDailyTask,
  toggleDailyTaskCompletion,
  batchToggleDailyTasks,
  batchDeleteDailyTasks,
  bundles,
  bundlesPagination,
  loadMoreBundles,
  addBundle,
  updateBundle,
  deleteBundle,
  addBundleTasks,
  batchUpdateBundleTasks,
  toggleBundleTaskCompletion,
  batchDeleteBundleTasks,
}) {

  const calendarView = useCalendarView()

  // Persist view mode in localStorage. Two views only: 'card' (masonry) | 'kanban'.
  // ('list' is a legacy value; the old 'sectioned' card layout has been removed.)
  const [viewMode, setViewMode] = useState(() => {
    const m = localStorage.getItem('tasksViewMode')
    return m === 'kanban' || m === 'list' ? 'kanban' : 'card'
  })
  // Sort is remembered per view, because the two want different defaults: a kanban
  // board is an arrangement you make by hand, while the card grid is a list you want
  // ordered by something. Sharing one value meant switching to kanban re-sorted your
  // board out from under you, and dragging then left the card grid stuck on Manual.
  const [sortByView, setSortByView] = useState({ card: 'priority', kanban: 'manual' })
  const sortBy = sortByView[viewMode] ?? 'priority'
  const setSortBy = useCallback(
    (next) => setSortByView(prev => ({ ...prev, [viewMode]: next })),
    [viewMode],
  )
  const [sortDir, setSortDir] = useState('asc') // sorting direction (ascending/descending)
  const [showCompleted, setShowCompleted] = useState(true)
  const [deadlineFilter, setDeadlineFilter] = useState('all')
  const [deadlineRange, setDeadlineRange] = useState('all')
  const [isSelectionMode, setIsSelectionMode] = useState(false)
  const [selectedTasks, setSelectedTasks] = useState([]) // for deleting
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [openTask, setOpenTask] = useState(null)
  const [openDailyTask, setOpenDailyTask] = useState(null)
  const [openBundle, setOpenBundle] = useState(null)
  const [isDailyCardOpen, setIsDailyCardOpen] = useState(false)

  // Calendar deep-link bridge: ?task= / ?daily= / ?bundle= opens that item's detail modal, then
  // clears the param. The object is fetched by-id (works even if it's past the loaded page); a
  // missing/orphaned target degrades gracefully (toast, no modal).
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    const taskId = searchParams.get('task')
    const dailyId = searchParams.get('daily')
    const bundleId = searchParams.get('bundle')
    if (!taskId && !dailyId && !bundleId) return

    let cancelled = false
    const fetchById = async (resource, id) => {
      try {
        const res = await authFetch(`${API}/${resource}/${id}`)
        if (!res.ok) { toast.error('That linked item no longer exists.'); return null }
        return await res.json()
      } catch {
        toast.error('Could not open that linked item.')
        return null
      }
    }

    const open = async () => {
      let obj = null
      if (taskId) obj = await fetchById('tasks', taskId)
      else if (dailyId) obj = await fetchById('daily-tasks', dailyId)
      else if (bundleId) obj = await fetchById('projects', bundleId)
      if (cancelled) return
      if (obj) {
        if (taskId) setOpenTask(obj)
        else if (dailyId) setOpenDailyTask(obj)
        else if (bundleId) setOpenBundle(obj)
      }
      const next = new URLSearchParams(searchParams)
      next.delete('task'); next.delete('daily'); next.delete('bundle')
      setSearchParams(next, { replace: true })
    }
    open()
    return () => { cancelled = true }
  }, [searchParams, authFetch, API, setSearchParams])

  const tasksSentinelRef = useRef(null)
  const dailyTasksSentinelRef = useRef(null)
  const bundlesSentinelRef = useRef(null)
  const scrollIntentTimeoutRef = useRef(null)
  const packedRef = useRef(null)

  const hasMoreTasks = tasksPagination?.hasNextPage
  const hasMoreDailyTasks = dailyTasksPagination?.hasNextPage
  const hasMoreBundles = bundlesPagination?.hasNextPage

  // Filter tasks: show completed/in progress then show including any of the 3: today within today/3 days/ this week
  // Memoized so the filter+sort (and their per-task new Date()) only re-run when an input actually
  // changes — not on every render (e.g. entering selection mode or toggling one task). `tasks` grows
  // unbounded via infinite scroll, so doing this inline each render was needless O(n log n) work.
  const filteredTasks = useMemo(() => {
    // Compute "today" once for the whole pass instead of per task.
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return tasks.filter(task => {
      if(!showCompleted) return task.is_completed === false
      return true
    }).filter(task => {
      if (deadlineFilter === 'all') return true
      if (!task.due_date) return false

      const due = new Date(task.due_date)
      due.setHours(0, 0, 0, 0)

      if (deadlineFilter === 'today')   return due.getTime() === today.getTime()
      if (deadlineFilter === 'overdue') return due.getTime() < today.getTime()

      // deadlineFilter === 'hasDeadline'
      if (deadlineRange === 'all') return true
      if (deadlineRange === '3days') {
        const threeDays = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000)
        return due <= threeDays
      }
      if (deadlineRange === 'week') {
        const week = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000)
        return due <= week
      }
    })
  }, [tasks, showCompleted, deadlineFilter, deadlineRange])

  // Sort tasks: incomplete first, then by priority (High -> Normal -> Low)
  const sortedTasks = useMemo(() => {
    const priorityOrder = { high: 0, normal: 1, low: 2 }
    return [...filteredTasks].sort((a, b) => {
      // First sort by completion status (incomplete first)
      if (a.is_completed !== b.is_completed) {
        return a.is_completed ? 1 : -1
      }

      // Manual order, set by dragging on the kanban board. Tasks never dragged fall
      // to the end, then break ties by priority so the board still reads sensibly the
      // first time you switch to it.
      if (sortBy === 'manual') {
        const ao = Number.isFinite(a.order) ? a.order : Infinity
        const bo = Number.isFinite(b.order) ? b.order : Infinity
        if (ao !== bo) return ao - bo
        return (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1)
      }

      // Sort by priority within each group
      if(sortBy === 'priority') return (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1)

      // Or sort by due date
      if(sortBy === 'dueDate'){

        // check if both have date or are null
        if(!a.due_date && !b.due_date) return 0
        if(!a.due_date) return 1
        if(!b.due_date) return -1

        //if both have dates then compare and sort
        if(sortDir === 'dsc'){
          return new Date(a.due_date) - new Date(b.due_date)
        }else{
          return new Date(b.due_date) - new Date(a.due_date)
        }
      }

    })
  }, [filteredTasks, sortBy, sortDir])

  // Intersection Observer for tasks infinite scroll
  useEffect(() => {
    if (!hasMoreTasks || loadingMore) return

    const sentinel = tasksSentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries
        if (entry.isIntersecting && !loadingMore) {
          // Delay fetch to detect scroll intent (user must keep scrolling)
          scrollIntentTimeoutRef.current = setTimeout(() => {
            loadMoreTasks()
          }, 300)
        } else {
          // User scrolled away - cancel pending fetch
          if (scrollIntentTimeoutRef.current) {
            clearTimeout(scrollIntentTimeoutRef.current)
          }
        }
      },
      {
        root: null,
        rootMargin: '100px', // Trigger slightly before sentinel is visible
        threshold: 0
      }
    )

    observer.observe(sentinel)

    return () => {
      observer.disconnect()
      if (scrollIntentTimeoutRef.current) {
        clearTimeout(scrollIntentTimeoutRef.current)
      }
    }
  }, [hasMoreTasks, loadingMore, loadMoreTasks])

  // Intersection Observer for daily tasks infinite scroll
  useEffect(() => {
    if (!hasMoreDailyTasks || loadingMore) return

    const sentinel = dailyTasksSentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries
        if (entry.isIntersecting && !loadingMore) {
          setTimeout(() => {
            loadMoreDailyTasks()
          }, 300)
        }
      },
      {
        root: null,
        rootMargin: '100px',
        threshold: 0
      }
    )

    observer.observe(sentinel)

    return () => observer.disconnect()
  }, [hasMoreDailyTasks, loadingMore, loadMoreDailyTasks])

  // Intersection Observer for bundles infinite scroll
  useEffect(() => {
    if (!hasMoreBundles || loadingMore) return

    const sentinel = bundlesSentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries
        if (entry.isIntersecting && !loadingMore) {
          setTimeout(() => {
            loadMoreBundles()
          }, 300)
        }
      },
      { root: null, rootMargin: '100px', threshold: 0 }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMoreBundles, loadingMore, loadMoreBundles])

  useRowMasonry(packedRef, [sortedTasks.length, sortBy, sortDir, showCompleted, deadlineFilter, deadlineRange, dailyTasks.length, bundles.length, isDailyCardOpen, viewMode])

  const changeView = () => {
    const newMode = viewMode === "card" ? "kanban" : "card"
    setViewMode(newMode)
    localStorage.setItem('tasksViewMode', newMode)
  }

  // Kanban: group the (already sorted/filtered) tasks into priority columns, and
  // reprioritize on drop.
  // Routines is where dailies and bundles live until you put them somewhere else.
  // It is NOT a priority — a bundle parked in "High" isn't high priority, it just
  // sits there, which is why its placement is an arrangement rather than a field.
  const KANBAN_COLS = [
    { key: 'high', label: 'High priority' },
    { key: 'normal', label: 'Normal' },
    { key: 'low', label: 'Low priority' },
    { key: ROUTINES_COL, label: 'Routines' },
  ]
  const tasksByPriority = useMemo(() => {
    const g = { high: [], normal: [], low: [] }
    for (const t of sortedTasks) (g[t.priority] || g.normal).push(t)
    return g
  }, [sortedTasks])
  // Kanban drag & drop.
  //
  // Nothing here calls setState while a drag is in flight. A re-render replaces the
  // card being dragged, and the browser cancels the drag the moment its source node
  // leaves the DOM — so the placeholder is drawn by toggling classes on nodes React
  // already owns, never by moving DOM around (which the reconciler can choke on at
  // the next render). State only changes on drop, once the drag is over.
  const [placements, setPlacements] = useState(() => readPlacements())

  // Cards that aren't tasks: the single Today's Tasks card, plus one per bundle.
  const routineCards = useMemo(() => {
    const out = []
    if (dailyTasks.length > 0) out.push({ kind: 'daily', key: DAILY_KEY })
    for (const b of bundles) out.push({ kind: 'bundle', key: bundleKey(b.id), bundle: b })
    return out
  }, [dailyTasks.length, bundles])

  // Forget placements for bundles that no longer exist, or they hold slots forever.
  //
  // Gated on the bundles having actually loaded. On the first render `bundles` is
  // still [] , so pruning against it declared every placement dead and wrote the
  // empty result to disk — the arrangement was wiped on every single launch.
  // `bundlesPagination` is only set after a real response, so it's the honest signal.
  useEffect(() => {
    if (!bundlesPagination) return
    const live = routineCards.map(r => r.key)
    setPlacements(prev => {
      const next = prunePlacements(prev, live)
      if (Object.keys(next).length === Object.keys(prev).length) return prev
      writePlacements(next)
      return next
    })
  }, [routineCards, bundlesPagination])

  // One ordered list per column, tasks and routine cards interleaved by `order`.
  const boardCols = useMemo(() => {
    const cols = {}
    for (const c of KANBAN_COLS) cols[c.key] = []
    for (const key of ['high', 'normal', 'low']) {
      for (const t of tasksByPriority[key]) {
        cols[key].push({
          kind: 'task', key: `task:${t.id}`, task: t,
          order: Number.isFinite(t.order) ? t.order : Number.MAX_SAFE_INTEGER,
        })
      }
    }
    for (const r of routineCards) {
      const p = placementFor(placements, r.key)
      const col = cols[p.col] ? p.col : ROUTINES_COL
      cols[col].push({ ...r, order: p.order })
    }
    for (const k of Object.keys(cols)) cols[k].sort((a, b) => a.order - b.order)
    return cols
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasksByPriority, routineCards, placements])

  const dragIdRef = useRef(null)
  const colBodyRefs = useRef({})
  const colElRefs = useRef({})     // the visible board box — where the glow belongs
  const colDropRefs = useRef({})   // the full-height column — the actual drop target
  const hintRefs = useRef({})      // "Drop in X", positioned into the visible part
  const dragFromColRef = useRef(null)  // which column the drag started in
  const dropTargetRef = useRef(null)   // last (column:index) painted, to avoid redundant work
  const paintRef = useRef(null)        // pending rAF, so we repaint at most once a frame

  // Just the in-column placeholder, leaving the board outline alone.
  const clearSlots = useCallback(() => {
    for (const key of Object.keys(colBodyRefs.current)) {
      const body = colBodyRefs.current[key]
      if (!body) continue
      body.querySelectorAll('.' + styles.gapBefore).forEach(el => el.classList.remove(styles.gapBefore))
      const tail = body.querySelector('.' + styles.tailSlot)
      if (tail) tail.classList.remove(styles.tailOn)
    }
  }, [])

  const clearDropUI = useCallback(() => {
    dropTargetRef.current = null
    if (paintRef.current) { cancelAnimationFrame(paintRef.current); paintRef.current = null }
    clearSlots()
    for (const key of Object.keys(colElRefs.current)) {
      colElRefs.current[key]?.classList.remove(styles.colOver)
    }
    for (const key of Object.keys(hintRefs.current)) {
      hintRefs.current[key]?.classList.remove(styles.hintOn)
    }
    for (const key of Object.keys(colDropRefs.current)) {
      colDropRefs.current[key]?.classList.remove(styles.hitOver)
    }
  }, [clearSlots])

  // Which index the pointer sits at, ignoring the card being dragged.
  const dropIndexAt = useCallback((body, clientY) => {
    const cards = [...body.querySelectorAll('.' + styles.kanbanCardWrap)]
      .filter(el => el.dataset.cardKey !== dragIdRef.current)
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect()
      if (clientY < r.top + r.height / 2) return { index: i, cards }
    }
    return { index: cards.length, cards }
  }, [])

  const onKanbanDragOver = useCallback((e, colKey) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const body = colBodyRefs.current[colKey]
    if (!body) return

    const { index, cards } = dropIndexAt(body, e.clientY)
    const at = colKey + ':' + index
    if (dropTargetRef.current === at) return
    dropTargetRef.current = at

    // Paint at most once per frame. `dragover` fires far faster than the screen
    // refreshes, and while crossing cards the index changes on nearly every event —
    // repainting each one is what made it strobe while moving but settle when still.
    if (paintRef.current) cancelAnimationFrame(paintRef.current)
    paintRef.current = requestAnimationFrame(() => {
      paintRef.current = null
      // Only the column that owns the drop keeps its outline; swap rather than
      // clear-then-add, so approaching a neighbour never blanks both.
      for (const key of Object.keys(colElRefs.current)) {
        colElRefs.current[key]?.classList.toggle(styles.colOver, key === colKey)
      }
      // The column can be taller than the window, so anchoring the hint to the top
      // or the drop slot puts it off screen exactly when it's needed. Centre it in
      // the visible slice instead.
      for (const key of Object.keys(colDropRefs.current)) {
        colDropRefs.current[key]?.classList.toggle(styles.hitOver, key === colKey)
      }
      // Moving a card within its own column is a rearrange, not a move — you can
      // already see exactly where it will land, so naming the column is noise.
      const sameCol = dragFromColRef.current === colKey
      for (const key of Object.keys(hintRefs.current)) {
        const hint = hintRefs.current[key]
        if (!hint) continue
        hint.classList.toggle(styles.hintOn, key === colKey && !sameCol)
        if (key !== colKey || sameCol) continue
        const box = colDropRefs.current[key]?.getBoundingClientRect()
        if (!box) continue
        const top = Math.max(box.top, 0)
        const bottom = Math.min(box.bottom, window.innerHeight)
        hint.style.top = `${(top + bottom) / 2 - box.top}px`
      }
      clearSlots()
      if (index < cards.length) cards[index].classList.add(styles.gapBefore)
      else {
        const tail = body.querySelector('.' + styles.tailSlot)
        if (tail) tail.classList.add(styles.tailOn)
      }
    })
  }, [clearSlots, dropIndexAt])

  const onKanbanDrop = (e, colKey) => {
    e.preventDefault()
    const body = colBodyRefs.current[colKey]
    const index = body ? dropIndexAt(body, e.clientY).index : 0
    const dragged = e.dataTransfer.getData('text/plain')
    dragIdRef.current = null
    clearDropUI()
    if (!dragged) return

    const from = boardCols[colKey].filter(it => it.key !== dragged)
    const moving =
      Object.values(boardCols).flat().find(it => it.key === dragged)
    if (!moving) return
    from.splice(Math.min(index, from.length), 0, moving)

    // Renumber the whole column so tasks and routine cards share one sequence —
    // that shared numbering is what lets them interleave at all.
    const taskOrders = []
    let nextPlacements = placements
    from.forEach((it, i) => {
      if (it.kind === 'task') taskOrders.push({ id: it.task.id, order: i })
      else nextPlacements = setPlacement(nextPlacements, it.key, colKey, i)
    })

    // A task dropped into a priority column adopts it. Routines columns carry no
    // priority meaning, so a task landing there keeps whatever it had.
    if (moving.kind === 'task' && colKey !== ROUTINES_COL && moving.task.priority !== colKey) {
      updateTask(moving.task.id, { priority: colKey })
    }
    if (taskOrders.length) setTaskOrders(taskOrders)
    if (nextPlacements !== placements) {
      setPlacements(nextPlacements)
      writePlacements(nextPlacements)
    }
    if (sortBy !== 'manual') setSortBy('manual')
  }


  // Selecting Task Logic
  const openDailyCardDetails = (task) => {
    setOpenDailyTask(task);
  }
  const openCardDetails = useCallback((task) => {
    setOpenTask(task);
  }, [])
  
  // Toggle Selection for DELETING ------
  const toggleSelectionMode = () => {
    setIsSelectionMode(!isSelectionMode)
    setSelectedTasks([])
  }

  const toggleTaskSelection = useCallback((taskId) => {
    setSelectedTasks(prev =>
      prev.includes(taskId) ? prev.filter(id => id !== taskId) : [...prev, taskId]
    )
  }, [])

  const handleBatchDelete = () => {
    if (selectedTasks.length === 0) return
    setShowDeleteModal(true)
  }

  const confirmBatchDelete = () => {
    selectedTasks.forEach(id => deleteTask(id))
    setSelectedTasks([])
    setIsSelectionMode(false)
    setShowDeleteModal(false)
  }


  if (loading && tasks.length === 0 && dailyTasks.length === 0 && bundles.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <Skeleton width="200px" height="36px" />
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
            <Skeleton width="140px" height="32px" radius={6} />
            <Skeleton width="120px" height="32px" radius={6} />
            <Skeleton width="120px" height="32px" radius={6} />
            <Skeleton width="36px" height="32px" radius={6} />
            <Skeleton width="36px" height="32px" radius={6} />
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={`d${i}`} width="100%" height="180px" radius={10} />
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={`b${i}`} width="100%" height="160px" radius={10} />
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={`t${i}`} width="100%" height="120px" radius={10} />
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>

        <div className={styles.header}>
          <h1>Tasks<span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: '10px', fontSize: '14px', fontFamily: 'var(--font-body, inherit)' }}>{tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}{isSelectionMode && ` (${selectedTasks.length} selected)`}</span></h1>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            {/* Filter options */}
            <button
              onClick={() => setShowCompleted(prev => !prev)}
              className={styles.toggleBtn}
            >
              {showCompleted ? 'Hide completed' : 'Show completed'}
            </button>
            <select
              value={deadlineFilter}
              onChange={e => { setDeadlineFilter(e.target.value); setDeadlineRange('all') }}
              className={styles.sortSelect}
            >
              <option value="all">All tasks</option>
              <option value="today">Due Today</option>
              <option value="overdue">Overdue</option>
              <option value="hasDeadline">Other deadline</option>
            </select>
            {deadlineFilter === 'hasDeadline' && (
              <select value={deadlineRange} onChange={e => setDeadlineRange(e.target.value)} className={styles.sortSelect}>
                <option value="all">Any date</option>
                <option value="3days">Within 3 days</option>
                <option value="week">Within a week</option>
              </select>
            )}

            {/* Sort options — hidden on the kanban board, which is ordered by hand. */}
            {viewMode !== 'kanban' && (
            <select
              value={sortBy}
              onChange={ e => setSortBy(e.target.value)}
              className={styles.sortSelect}
            >
              <option value="priority">Priority</option>
              <option value="dueDate">Deadline</option>
            </select>
            )}
            {viewMode !== 'kanban' && sortBy === 'dueDate' && (
              <select value={sortDir} onChange={ e => setSortDir(e.target.value)} className={styles.sortSelect}>
                <option value="asc">Earliest</option>
                <option value="dsc">Furthest</option>
              </select>
            )}

            {/* Delete button - always visible */}
            <button
              onClick={isSelectionMode ? handleBatchDelete : toggleSelectionMode}
              className={styles.batchDeleteBtn}
              disabled={isSelectionMode && selectedTasks.length === 0}
              title={isSelectionMode ? "Delete selected tasks" : "Select tasks to delete"}
            >
              <HiOutlineTrash size={18} />
            </button>

            {/* Calendar peek */}
            <button
              onClick={() => calendarView.toggle()}
              className={styles.toggleBtn}
              title="Calendar peek (⌘;)"
            >
              <LuCalendarDays size={18} />
            </button>

            {/* Cancel button - only in selection mode */}
            {isSelectionMode && (
              <button onClick={toggleSelectionMode} className={styles.toggleBtn}>
                Cancel
              </button>
            )}

            <button onClick={changeView} className={styles.toggleBtn} title={viewMode === "kanban" ? "Card View" : "Kanban View"}>
              {viewMode === "kanban" ? <HiOutlineViewGrid size={18} /> : <HiOutlineViewBoards size={18} />}
            </button>
          </div>
        </div>

        
        {/* BODY ================================================================ */}

        {/* Kanban mode — priority columns; drag a task between columns to reprioritize */}
        {viewMode === 'kanban' && (
          <div className={styles.kanbanWrapper}>
            {/* Only the add bar is pinned now — dailies and bundles are cards on the
                board, so they no longer cost a band of vertical space whether or not
                there is anything in them. */}
            <div className={styles.kanbanTop}>
              <AddTaskCard addTask={addTask} addBundle={addBundle} viewMode="list" />
            </div>

            {loading ? (
              <p>Loading tasks...</p>
            ) : (
              <div className={styles.kanbanBoard}>
                {KANBAN_COLS.map(col => (
                  <div
                    key={col.key}
                    ref={el => { colDropRefs.current[col.key] = el }}
                    className={styles.kanbanCol}
                    onDragOver={e => onKanbanDragOver(e, col.key)}
                    onDrop={e => onKanbanDrop(e, col.key)}
                  >
                    <div className={styles.dropHint} ref={el => { hintRefs.current[col.key] = el }}>
                      Drop in {col.label}
                    </div>
                    <div className={styles.kanbanColInner} ref={el => { colElRefs.current[col.key] = el }}>
                    <div className={styles.kanbanColHead}>
                      <span className={`${styles.kanbanDot} ${styles['dot_' + col.key]}`} />
                      <span className={styles.kanbanColTitle}>{col.label}</span>
                      <span className={styles.kanbanCount}>{boardCols[col.key].length}</span>
                    </div>
                    <div className={styles.kanbanColBody} ref={el => { colBodyRefs.current[col.key] = el }}>
                      {boardCols[col.key].map(item => (
                        <div
                          key={item.key}
                          className={styles.kanbanCardWrap}
                          data-card-key={item.key}
                          draggable
                          onDragStart={e => {
                            dragIdRef.current = item.key
                            dragFromColRef.current = col.key
                            e.dataTransfer.effectAllowed = 'move'
                            e.dataTransfer.setData('text/plain', item.key)
                            // Class only — a re-render here would kill the drag.
                            const el = e.currentTarget
                            requestAnimationFrame(() => el.classList.add(styles.lifted))
                          }}
                          onDragEnd={e => {
                            e.currentTarget.classList.remove(styles.lifted)
                            dragIdRef.current = null
                            dragFromColRef.current = null
                            clearDropUI()
                          }}
                        >
                          {item.kind === 'task' && (
                            <TaskCard task={item.task} deleteTask={deleteTask} toggleCompletion={toggleTaskCompletion} viewMode="card" isSelectionMode={isSelectionMode} isSelected={selectedTasks.includes(item.task.id)} onToggleSelect={toggleTaskSelection} onOpenDetail={openCardDetails} />
                          )}
                          {item.kind === 'daily' && (
                            <DailyTaskCard tasks={dailyTasks} toggleCompletion={toggleDailyTaskCompletion} deleteTask={deleteDailyTask} onOpenDetail={openDailyCardDetails} onOpenCard={() => setIsDailyCardOpen(true)} />
                          )}
                          {item.kind === 'bundle' && (
                            <BundleCard bundle={item.bundle} toggleBundleTaskCompletion={toggleBundleTaskCompletion} deleteBundle={deleteBundle} onOpenDetail={setOpenBundle} />
                          )}
                        </div>
                      ))}
                      {boardCols[col.key].length === 0 && (
                        <div className={styles.kanbanEmpty}>
                          {col.key === ROUTINES_COL ? 'Dailies and bundles land here' : 'Drop a task here'}
                        </div>
                      )}
                      {/* Always rendered, so opening it is a class toggle rather than a
                          DOM insertion — see the note on onKanbanDrop. */}
                      <div className={styles.tailSlot} />
                    </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {hasMoreTasks && (
              <div ref={tasksSentinelRef} className={styles.sentinel}>
                {loadingMore ? <span className={styles.loadingDots}>...</span> : <span className={styles.moreDots}>...</span>}
              </div>
            )}
          </div>
        )}

        {/* Packed card mode — single JS row-masonry grid */}
        {viewMode === 'card' && (
          <div className={styles.packedGrid} ref={packedRef}>
            <AddTaskCard addTask={addTask} addBundle={addBundle} viewMode={viewMode} />
            <DailyTaskCard tasks={dailyTasks} toggleCompletion={toggleDailyTaskCompletion} deleteTask={deleteDailyTask} onOpenDetail={openDailyCardDetails} onOpenCard={() => setIsDailyCardOpen(true)} />
            {hasMoreDailyTasks && (
              <div ref={dailyTasksSentinelRef} className={styles.packedSentinel}>
                {loadingMore ? <span className={styles.loadingDots}>...</span> : <span className={styles.moreDots}>...</span>}
              </div>
            )}
            {bundles.length > 0 && bundles.map(bundle => (
              <BundleCard key={bundle.id} bundle={bundle} toggleBundleTaskCompletion={toggleBundleTaskCompletion} deleteBundle={deleteBundle} onOpenDetail={setOpenBundle} />
            ))}
            {hasMoreBundles && (
              <div ref={bundlesSentinelRef} className={styles.packedSentinel}>
                {loadingMore ? <span className={styles.loadingDots}>...</span> : <span className={styles.moreDots}>...</span>}
              </div>
            )}
            {loading ? (
              <p style={{ gridColumn: '1 / -1' }}>Loading tasks...</p>
            ) : sortedTasks.length > 0 ? (
              sortedTasks.map(task => (
                <TaskCard key={task.id} task={task} deleteTask={deleteTask} toggleCompletion={toggleTaskCompletion} viewMode={viewMode} isSelectionMode={isSelectionMode} isSelected={selectedTasks.includes(task.id)} onToggleSelect={toggleTaskSelection} onOpenDetail={openCardDetails} />
              ))
            ) : (
              <div className={styles.emptyStatePacked}><p>No tasks yet. Create today's set of tasks or create a new task to do</p></div>
            )}
            {hasMoreTasks && (
              <div ref={tasksSentinelRef} className={styles.packedSentinel}>
                {loadingMore ? <span className={styles.loadingDots}>...</span> : <span className={styles.moreDots}>...</span>}
              </div>
            )}
          </div>
        )}

        {/* Sectioned card mode — pinned row, projects grid, tasks masonry */}

        {/* Open task details Modal for DAILY TASK */}
        {isDailyCardOpen && <DailyTaskModal
          tasks={dailyTasks}
          toggleCompletion={toggleDailyTaskCompletion}
          addDailyTask={addDailyTask}
          updateDailyTask={updateDailyTask}
          deleteTask={deleteDailyTask}
          batchToggleDailyTasks={batchToggleDailyTasks}
          batchDeleteDailyTasks={batchDeleteDailyTasks}
          onOpenDetail={openDailyCardDetails}
          onClose={() => setIsDailyCardOpen(false)}
        />}
        {openDailyTask && <TaskDetailsModal 
          onClose={() => setOpenDailyTask(null)}
          task = {openDailyTask}
          updateTask={updateDailyTask}
          isDailyTask={true}
        />}
        
        {/* Open Task details Modal for NORMAL TASK*/}
        {openTask && <TaskDetailsModal 
          onClose={() => setOpenTask(null)}
          task = {openTask}
          updateTask={updateTask}
        />}

        {openBundle && <BundleDetailModal
          bundle={openBundle}
          onClose={() => setOpenBundle(null)}
          updateBundle={updateBundle}
          deleteBundle={deleteBundle}
          addBundleTasks={addBundleTasks}
          batchUpdateBundleTasks={batchUpdateBundleTasks}
          batchDeleteBundleTasks={batchDeleteBundleTasks}
          toggleBundleTaskCompletion={toggleBundleTaskCompletion}
        />}

        {/* Delete Confirmation Modal */}
        <ConfirmModal
          isOpen={showDeleteModal}
          onClose={() => setShowDeleteModal(false)}
          onConfirm={confirmBatchDelete}
          title="Delete Tasks"
          message={`Are you sure you want to delete ${selectedTasks.length} selected task(s)? This action cannot be undone.`}
          confirmText="Delete"
          cancelText="Cancel"
        />

    </div>
  )
}

export default TasksHub
