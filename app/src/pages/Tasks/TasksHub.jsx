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
import { HiOutlineTrash, HiOutlineViewGrid, HiOutlineViewList, HiOutlineTemplate, HiOutlineViewBoards } from 'react-icons/hi'
import { LuCalendarDays } from 'react-icons/lu'
import BundleCard from "../../components/Tasks/BundleCard"
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
  deleteTask,
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

  // Persist view mode in localStorage
  const [viewMode, setViewMode] = useState(() => {
    return localStorage.getItem('tasksViewMode') || 'card'
  })
  const [layoutMode, setLayoutMode] = useState(() => {
    return localStorage.getItem('tasksLayoutMode') || 'packed'
  })
  const [sortBy, setSortBy] = useState('priority')
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

  useRowMasonry(packedRef, [sortedTasks.length, sortBy, sortDir, showCompleted, deadlineFilter, deadlineRange, dailyTasks.length, bundles.length, isDailyCardOpen, layoutMode, viewMode])

  const changeView = () => {
    const newMode = viewMode === "card" ? "list" : "card"
    setViewMode(newMode)
    localStorage.setItem('tasksViewMode', newMode)
  }

  const changeLayout = () => {
    const newMode = layoutMode === 'packed' ? 'sectioned' : 'packed'
    setLayoutMode(newMode)
    localStorage.setItem('tasksLayoutMode', newMode)
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
          <h1>Tasks<span className={styles.accent}>Hub</span><span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: '10px', fontSize: '14px', fontFamily: 'var(--font-body, inherit)' }}>{tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}{isSelectionMode && ` (${selectedTasks.length} selected)`}</span></h1>
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

            {/* Sort options */}
            <select
              value={sortBy}
              onChange={ e => setSortBy(e.target.value)}
              className={styles.sortSelect}
            >
              <option value="priority">Priority</option>
              <option value="dueDate">Deadline</option>
            </select>
            {sortBy === 'dueDate' && (
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

            {viewMode === 'card' && (
              <button onClick={changeLayout} className={styles.toggleBtn} title={layoutMode === 'packed' ? 'Sectioned view' : 'Packed view'}>
                {layoutMode === 'packed' ? <HiOutlineTemplate size={18} /> : <HiOutlineViewBoards size={18} />}
              </button>
            )}
            <button onClick={changeView} className={styles.toggleBtn} title={viewMode === "list" ? "Card View" : "List View"}>
              {viewMode === "list" ? <HiOutlineViewGrid size={18} /> : <HiOutlineViewList size={18} />}
            </button>
          </div>
        </div>

        
        {/* BODY ================================================================ */}

        {/* List mode */}
        {viewMode === 'list' && (
          <div className={styles.listView}>
            <AddTaskCard addTask={addTask} addBundle={addBundle} viewMode={viewMode} />
            <DailyTaskCard tasks={dailyTasks} toggleCompletion={toggleDailyTaskCompletion} deleteTask={deleteDailyTask} onOpenDetail={openDailyCardDetails} onOpenCard={() => setIsDailyCardOpen(true)} />
            {hasMoreDailyTasks && (
              <div ref={dailyTasksSentinelRef} className={styles.sentinel}>
                {loadingMore ? <span className={styles.loadingDots}>...</span> : <span className={styles.moreDots}>...</span>}
              </div>
            )}
            {bundles.length > 0 && bundles.map(bundle => (
              <BundleCard key={bundle.id} bundle={bundle} toggleBundleTaskCompletion={toggleBundleTaskCompletion} deleteBundle={deleteBundle} onOpenDetail={setOpenBundle} />
            ))}
            {hasMoreBundles && (
              <div ref={bundlesSentinelRef} className={styles.sentinel}>
                {loadingMore ? <span className={styles.loadingDots}>...</span> : <span className={styles.moreDots}>...</span>}
              </div>
            )}
            {loading ? (
              <p>Loading tasks...</p>
            ) : sortedTasks.length > 0 ? (
              sortedTasks.map(task => (
                <TaskCard key={task.id} task={task} deleteTask={deleteTask} toggleCompletion={toggleTaskCompletion} viewMode={viewMode} isSelectionMode={isSelectionMode} isSelected={selectedTasks.includes(task.id)} onToggleSelect={toggleTaskSelection} onOpenDetail={openCardDetails} />
              ))
            ) : (
              <div className={styles.emptyState}><p>No tasks yet. Create today's set of tasks or create a new task to do</p></div>
            )}
            {hasMoreTasks && (
              <div ref={tasksSentinelRef} className={styles.sentinel}>
                {loadingMore ? <span className={styles.loadingDots}>...</span> : <span className={styles.moreDots}>...</span>}
              </div>
            )}
          </div>
        )}

        {/* Packed card mode — single JS row-masonry grid */}
        {viewMode === 'card' && layoutMode === 'packed' && (
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
        {viewMode === 'card' && layoutMode === 'sectioned' && (
          <div className={styles.sectionedWrapper}>
            <div className={styles.sectionedPinned}>
              <AddTaskCard addTask={addTask} addBundle={addBundle} viewMode={viewMode} />
              <DailyTaskCard tasks={dailyTasks} toggleCompletion={toggleDailyTaskCompletion} deleteTask={deleteDailyTask} onOpenDetail={openDailyCardDetails} onOpenCard={() => setIsDailyCardOpen(true)} />
              {hasMoreDailyTasks && (
                <div ref={dailyTasksSentinelRef} className={styles.sentinel}>
                  {loadingMore ? <span className={styles.loadingDots}>...</span> : <span className={styles.moreDots}>...</span>}
                </div>
              )}
            </div>

            {(bundles.length > 0 || hasMoreBundles) && (
              <div className={styles.sectionedBundles}>
                {bundles.map(bundle => (
                  <BundleCard key={bundle.id} bundle={bundle} toggleBundleTaskCompletion={toggleBundleTaskCompletion} deleteBundle={deleteBundle} onOpenDetail={setOpenBundle} />
                ))}
                {hasMoreBundles && (
                  <div ref={bundlesSentinelRef} className={styles.sentinel}>
                    {loadingMore ? <span className={styles.loadingDots}>...</span> : <span className={styles.moreDots}>...</span>}
                  </div>
                )}
              </div>
            )}

            <div className={styles.gridView}>
              {loading ? (
                <p>Loading tasks...</p>
              ) : sortedTasks.length > 0 ? (
                sortedTasks.map(task => (
                  <TaskCard key={task.id} task={task} deleteTask={deleteTask} toggleCompletion={toggleTaskCompletion} viewMode={viewMode} isSelectionMode={isSelectionMode} isSelected={selectedTasks.includes(task.id)} onToggleSelect={toggleTaskSelection} onOpenDetail={openCardDetails} />
                ))
              ) : (
                <div className={styles.emptyState}><p>No tasks yet. Create today's set of tasks or create a new task to do</p></div>
              )}
              {hasMoreTasks && (
                <div ref={tasksSentinelRef} className={styles.sentinel}>
                  {loadingMore ? <span className={styles.loadingDots}>...</span> : <span className={styles.moreDots}>...</span>}
                </div>
              )}
            </div>
          </div>
        )}

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
