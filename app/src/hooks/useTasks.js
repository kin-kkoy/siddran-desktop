import { useState, useEffect, useCallback } from "react";
import { toast } from "../utils/toast";
import logger from "../utils/logger";


// mini helper function for messages lol
function whatMessage(action, subAction = null) {
    const feedbackMessages = {
        deleted: [
            "Aaaand... it's history. 🦖",
            "Poof! Into the digital abyss it goes.",
            "Sent this one to a farm upstate. 🚜",
            "Deleted. We don't know her anymore. 💅",
            "Rest in pixels, old friend.",
            "Yeeted into the recycle bin. ☄️"
        ],
        created: [
            "It exists. Now what? 🤨",
            "A fresh start. Don't mess this one up.",
            "Brand new and already judging your progress.",
            "Added to the pile. 📁",
            "Witnessed. It's officially a thing now.",
            "The canvas is no longer blank. Scared?",
            "Birth certificate signed. ✍️"
        ],
        updated: [
            "Changed it again, did we?",
            "Applying the 'fix it' juice. 🧃",
            "Consider it tweaked.",
            "Polishing the edges. ✨",
            "It's different now. Slightly.",
            "Updated. The old version was mid anyway.",
            "Wait, was that a typo? Fixed it."
        ],
        completed: [
            "Finally. I was starting to worry. ☕",
            "Yay it's done!!!!!!!!!!!!!!!!!!!!!",
            "Off the to-do list and into the 'done' bin.",
            "Manifested into reality. Yup.",
            "You actually did the thing. Wow.",
            "Checkmark acquired. Move along.",
            "That's one less thing to ignore tomorrow."
        ],
        validation: {
            noTitle: [
                "A title would be nice, don't you think?",
                "Untitled? Bold choice. Too bold.",
                "Even 'Untitled' is a title. Try harder. 😤",
                "The title field is feeling neglected.",
            ],
            noTasks: [
                "You need at least one item. It's literally the point. 💨",
                "Empty list detected. What are we even doing here?",
                "No items? That's not a plan, that's a wish. 🌠",
                "Add something first. Anything. We believe in you.",
            ],
        },
        failed: {
            create: [
                "Birth certificate denied. 🚫",
                "The universe says 'maybe later'.",
                "It refused to be born. Re-evaluating life choices.",
                "Error: Commitment issues detected."
            ],
            update: [
                "The update didn't take. It likes its old self.",
                "Refused to change. Stubborn, isn't it?",
                "Nip/tuck failed. We're staying mid for now.",
                "Changes discarded like last year's trends."
            ],
            delete: [
                "It's fighting back. It won't leave. 🧟",
                "Immortal item detected. Try again.",
                "Deletion failed. It's too attached to you.",
                "The abyss spit it back out. Awkward."
            ],
            complete: [
                "Not so fast. Something's still broken.",
                "Completion denied. Did you actually finish it though?",
                "It's not over 'til the server sings. (It didn't).",
                "The finish line just moved. Sorry."
            ]
        }
    };

    // Logic to handle nested "failed" messages or standard messages
    const list = subAction
        ? feedbackMessages[action][subAction]
        : feedbackMessages[action];

    return list[Math.floor(Math.random() * list.length)];
}


// Custom hook for tasks, daily tasks, and bundles
export const useTasks = (authFetch, API, isAuthed) => {

    const [tasks, setTasks] = useState([])
    const [dailyTasks, setDailyTasks] = useState([])
    const [bundles, setBundles] = useState([])
    const [tasksPagination, setTasksPagination] = useState(null)
    const [dailyTasksPagination, setDailyTasksPagination] = useState(null)
    const [bundlesPagination, setBundlesPagination] = useState(null)
    const [loadingMore, setLoadingMore] = useState(false)
    const [loading, setLoading] = useState(true)


    // ----------- Fetch data on auth ================================================================
    useEffect(() => {
        if(!isAuthed) return

        const fetchAllTasks = async () => {
            try {
                const [res1, res2, res3] = await Promise.all([
                    authFetch(`${API}/tasks`),
                    authFetch(`${API}/daily-tasks`),
                    authFetch(`${API}/projects`)
                ])

                if(res1.ok) {
                    const data = await res1.json()
                    setTasks(data.tasks)
                    setTasksPagination(data.pagination)
                }
                if(res2.ok) {
                    const data2 = await res2.json()
                    setDailyTasks(data2.dailyTasks)
                    setDailyTasksPagination(data2.pagination)
                }
                if(res3.ok) {
                    const data3 = await res3.json()
                    setBundles(data3.projects)
                    setBundlesPagination(data3.pagination)
                }

            } catch (error) {
                logger.error(`Error fetching tasks:`, error)
            } finally {
                setLoading(false)
            }
        }

        fetchAllTasks()

    }, [isAuthed, authFetch, API])


    // ----------- Load More Functions (Pagination) ==========================================
    const loadMoreTasks = useCallback(async () => {
        if (!tasksPagination?.hasNextPage || loadingMore) return

        setLoadingMore(true)
        try {
            const response = await authFetch(
                `${API}/tasks?cursor=${tasksPagination.nextCursor}&limit=${tasksPagination.limit}`
            )
            if(response.ok) {
                const data = await response.json()
                setTasks(prev => [...prev, ...data.tasks])
                setTasksPagination(data.pagination)
            }
        } catch (error) {
            logger.error('Error loading more tasks:', error)
        } finally {
            setLoadingMore(false)
        }
    }, [authFetch, API, tasksPagination, loadingMore])

    const loadMoreDailyTasks = useCallback(async () => {
        if (!dailyTasksPagination?.hasNextPage || loadingMore) return

        setLoadingMore(true)
        try {
            const response = await authFetch(
                `${API}/daily-tasks?cursor=${dailyTasksPagination.nextCursor}&limit=${dailyTasksPagination.limit}`
            )
            if(response.ok) {
                const data = await response.json()
                setDailyTasks(prev => [...prev, ...data.dailyTasks])
                setDailyTasksPagination(data.pagination)
            }
        } catch (error) {
            logger.error('Error loading more daily tasks:', error)
        } finally {
            setLoadingMore(false)
        }
    }, [authFetch, API, dailyTasksPagination, loadingMore])

    const loadMoreBundles = useCallback(async () => {
        if(!bundlesPagination?.hasNextPage || loadingMore) return

        setLoadingMore(true)
        try {
            const response = await authFetch(
                `${API}/projects?cursor=${bundlesPagination.nextCursor}&limit=${bundlesPagination.limit}`
            )
            if(response.ok){
                const data = await response.json()
                setBundles(prev => [...prev, ...data.projects])
                setBundlesPagination(data.pagination)
            }
        } catch (error) {
            logger.error('Error loading more bundles:', error);
        }finally {
            setLoadingMore(false)
        }

    }, [authFetch, API, bundlesPagination, loadingMore])


    // ----------- Task Operations ===========================
    const addTask = useCallback(async (title, description, priority, dueDate, taskType) => {
        // if daily tasks
        if (taskType === 'daily') {
            if (!Array.isArray(title) || title.length === 0) {
                toast.warning(whatMessage("validation", "noTasks"))
                return
            }

            try {
                const res = await authFetch(`${API}/daily-tasks`, {
                    method: 'POST',
                    body: JSON.stringify({ tasks: title })
                })

                if(res.ok) {
                    const newTasks = await res.json()
                    setDailyTasks(prev => [...newTasks, ...prev])
                    return newTasks
                }

            } catch (error) {
                logger.error("Error adding daily tasks:", error)
                toast.error(whatMessage("failed", "create"))
            }

            return
        }

        // if normal tasks
        if (!title.trim()) {
            toast.warning(whatMessage("validation", "noTitle"))
            return
        }

        const tempId = `temp-${(crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random()}`}`
        const optimisticTask = {
            id: tempId,
            title,
            description: description ?? '',
            priority: priority ?? 'medium',
            due_date: dueDate ? new Date(dueDate).toISOString() : null,
            is_completed: false,
            created_at: new Date().toISOString(),
            _optimistic: true,
        }

        setTasks(prev => [optimisticTask, ...prev])

        try {
            const res = await authFetch(`${API}/tasks`, {
                method: 'POST',
                body: JSON.stringify({
                    title, description, priority,
                    due_date: dueDate ? new Date(dueDate).toISOString() : null
                })
            })

            if(!res.ok) throw new Error('Failed to create task')

            const newTask = await res.json()
            setTasks(prev => prev.map(t => t.id === tempId ? newTask : t))

        } catch (error) {
            logger.error("Error adding task:", error)
            setTasks(prev => prev.filter(t => t.id !== tempId))
            toast.error(whatMessage("failed", "create"))
        }
    }, [authFetch, API])

    const updateTask = useCallback(async (id, {title, description, is_completed, priority, due_date}) => {
        try {

            // get the passed values first
            const params = {title, description, is_completed, priority, due_date};

            //remove undefined fields (the params that weren't passed)
            const cleanParams = Object.fromEntries(
                Object.entries(params).filter(([_dirname, v]) => v !== undefined)
            );

            const res = await authFetch(`${API}/tasks/${id}`, {
                method: 'PUT',
                body: JSON.stringify(cleanParams)
            })

            if(res.ok){
                setTasks(prev => prev.map(task => task.id === id ? {...task, ...cleanParams} : task))
            }

        } catch (error) {
            logger.error("Error updating task:", error)
        }
    }, [authFetch, API])

    // Patch a task in this app-level cache WITHOUT a network call. Used by the Calendar (which
    // owns its own range-fetched task cache + the actual PUT) to keep TasksHub in sync after a
    // drag-reschedule, so it reflects the new due date without a page refresh.
    const patchTaskInCache = useCallback((id, patch) => {
        setTasks(prev => prev.map(task => task.id === id ? { ...task, ...patch } : task))
    }, [])

    // Set/clear an ephemeral daily's time from the Calendar (drag to a slot, or to/from all-day).
    // Lives here so it mutates the SHARED dailyTasks store → TasksHub + Calendar stay in sync.
    // Optimistic with revert. time = 'HH:MM' schedules; time = null makes it untimed.
    const setDailyTime = useCallback(async (id, time) => {
        let snap = null
        setDailyTasks(prev => { snap = prev.find(t => t.id === id) ?? null; return prev.map(t => t.id === id ? { ...t, time } : t) })
        try {
            const res = await authFetch(`${API}/daily-tasks/${id}`, { method: 'PUT', body: JSON.stringify({ time }) })
            if (!res.ok) throw new Error('Failed to set daily time')
        } catch (error) {
            logger.error('Error setting daily time:', error)
            if (snap) setDailyTasks(prev => prev.map(t => t.id === id ? snap : t))
            toast.error('Could not reschedule that daily.')
        }
    }, [authFetch, API])

    const deleteTask = useCallback(async (id) => {
        let removed = null
        setTasks(prev => {
            removed = prev.find(t => t.id === id) ?? null
            return prev.filter(task => task.id !== id)
        })

        if (typeof id === 'string' && id.startsWith('temp-')) return

        try {
            const res = await authFetch(`${API}/tasks/${id}`, { method: 'DELETE' })
            if(!res.ok) throw new Error('Failed to delete task')

        } catch (error) {
            logger.error("Error deleting task:", error)
            if (removed) setTasks(prev => [removed, ...prev])
            toast.error('Failed to delete task. Restored.')
        }
    }, [authFetch, API])

    const toggleTaskCompletion = useCallback(async (id, isCompleted) => {
        // Optimistic update
        setTasks(prev => prev.map(task =>
            task.id === id ? {...task, is_completed: isCompleted} : task
        ))

        try {
            await authFetch(`${API}/tasks/${id}`, {
                method: 'PUT',
                body: JSON.stringify({ is_completed: isCompleted })
            })

        } catch (error) {
            logger.error("Error updating task:", error)
            // Revert on error
            setTasks(prev => prev.map(task =>
                task.id === id ? {...task, is_completed: !isCompleted} : task
            ))
        }
    }, [authFetch, API])


    // ----------- Daily Task Operations ===========================
    // opts (optional): { recurrence, time } — a recurrence makes the daily non-expiring & recurring
    // (the calendar expands it per-day). Returns the created row (or null) so callers can sync it.
    const addDailyTask = useCallback(async (title, priority, opts = {}) => {

        if (!title?.trim()) {
            toast.warning(whatMessage("validation", "noTitle"))
            return null
        }

        try {
            const item = { title: title.trim(), priority }
            if (opts.recurrence !== undefined) item.recurrence = opts.recurrence
            if (opts.time !== undefined) item.time = opts.time

            const res = await authFetch(`${API}/daily-tasks`, {
                method: 'POST',
                body: JSON.stringify({ tasks: [item] })
            })

            if(res.ok) {
                const newTasks = await res.json()
                setDailyTasks(prev => [...newTasks, ...prev])
                return newTasks[0] || null
            }

        } catch (error) {
            logger.error("Error adding daily task:", error)
            toast.error(whatMessage("failed", "create"))
        }

        return null
    }, [authFetch, API])

    // `recurrence` may be a preset string, a { mask } object, or null (null = make it a one-off).
    // Null must survive the clean step, so only `undefined` is stripped. Returns the updated row.
    const updateDailyTask = useCallback(async (id, {title, priority, is_completed, recurrence}) => {
        try {

            // get the passed values first
            const params = {title, priority, is_completed, recurrence};

            //remove undefined fields (the params that weren't passed) — keep explicit nulls
            const cleanParams = Object.fromEntries(
                Object.entries(params).filter(([_dirname, v]) => v !== undefined)
            );

            const res = await authFetch(`${API}/daily-tasks/${id}`, {
                method: "PUT",
                body: JSON.stringify(cleanParams)
            });

            if(res.ok){
                const updated = await res.json()
                setDailyTasks(prev => prev.map(dailyTask => dailyTask.id === id ? {...dailyTask, ...updated} : dailyTask))
                return updated
            }

        } catch (error) {
            logger.error("Error updating daily task:", error)
        }
    }, [authFetch, API])

    const deleteDailyTask = useCallback(async (id) => {
        try {
            const res = await authFetch(`${API}/daily-tasks/${id}`, { method: "DELETE" })
            if(res.ok) {
                setDailyTasks(prev => prev.filter(task => task.id !== id))
            }
        } catch (error) {
            logger.error("Error deleting daily task:", error)
        }
    }, [authFetch, API])

    const toggleDailyTaskCompletion = useCallback(async (id, isCompleted) => {
        // Optimistic update
        setDailyTasks(prev => prev.map(task =>
            task.id === id ? {...task, is_completed: isCompleted} : task
        ))

        try {
            await authFetch(`${API}/daily-tasks/${id}`, {
                method: 'PUT',
                body: JSON.stringify({ is_completed: isCompleted })
            })

        } catch (error) {
            logger.error("Error updating daily task:", error)
            // Revert on error
            setDailyTasks(prev => prev.map(task =>
                task.id === id ? {...task, is_completed: !isCompleted} : task
            ))
        }
    }, [authFetch, API])

    // Batch toggle completion for daily tasks
    const batchToggleDailyTasks = useCallback(async (updates) => {
        // updates: [{ id, is_completed }, ...]
        if (!updates.length) return

        try {
            const res = await authFetch(`${API}/daily-tasks/batch-complete`, {
                method: 'PATCH',
                body: JSON.stringify({ tasks: updates })
            })

            if (!res.ok) throw new Error(`Batch toggle failed: ${res.status}`)

            const updatedTasks = await res.json()
            setDailyTasks(prev => prev.map(task => {
                const updated = updatedTasks.find(u => u.id === task.id)
                return updated ? { ...task, ...updated } : task
            }))
        } catch (error) {
            logger.error("Error batch toggling daily tasks:", error)
            throw error
        }
    }, [authFetch, API])

    // Batch delete daily tasks
    const batchDeleteDailyTasks = useCallback(async (ids) => {
        // ids: [id1, id2, ...]
        if (!ids.length) return

        try {
            const res = await authFetch(`${API}/daily-tasks/batch-delete`, {
                method: 'DELETE',
                body: JSON.stringify({ tasks: ids.map(id => ({ id })) })
            })

            if (!res.ok) throw new Error(`Batch delete failed: ${res.status}`)

            setDailyTasks(prev => prev.filter(task => !ids.includes(task.id)))
        } catch (error) {
            logger.error("Error batch deleting daily tasks:", error)
            throw error
        }
    }, [authFetch, API])


    // ----------- Bundle CRUD ===========================

    // POST create a bundle with tasks
    const addBundle = useCallback(async (title, tasks, color) => {

        // Validate - title
        if(!title.trim()){
            toast.warning(whatMessage("validation", "noTitle"))
            return
        }
        // Validate - tasks
        if (!Array.isArray(tasks) || tasks.length === 0) {
            toast.warning(whatMessage("validation", "noTasks"))
            return
        }

        try {

            const res = await authFetch(`${API}/projects`, {
                method: 'POST',
                body: JSON.stringify({ title, tasks, color })   // although color is optional, in the modal it'll have a color by default
            });

            if (res.ok){
                const newBundle = await res.json();
                setBundles(prev => [newBundle, ...prev])
                toast.success(whatMessage("created"))
            }

        } catch (error) {
            logger.error("Error adding bundle:", error)
            toast.error(whatMessage("failed", "create"))
        }


    }, [authFetch, API])

    // PUT update bundle metadata (title, color, is_completed)
    const updateBundle = useCallback(async (id, { title, color, is_completed }) => {
        try {

            // -- (dynamically take the params that are only defined) ---
            // get params first
            const params = {title, color, is_completed};
            // then clean the params
            const cleanParams = Object.fromEntries(
                Object.entries(params).filter(([_dirname, v]) => v !== undefined)
            );

            const res = await authFetch(`${API}/projects/${id}`, {
                method: 'PUT',
                body: JSON.stringify(cleanParams)
            })

            if(res.ok){
                setBundles(prev => prev.map(p => p.id === id ? { ...p, ...cleanParams } : p))
            }

        } catch (error) {
            logger.error("Error updating bundle:", error)
            toast.error(whatMessage("failed", "update"))
        }



    }, [authFetch, API])

    // DELETE delete bundle (cascades to its tasks)
    const deleteBundle = useCallback(async (id) => {
        try {
            const res = await authFetch(`${API}/projects/${id}`, { method: 'DELETE' })
            if(res.ok){
                toast.success(whatMessage("deleted"))
                setBundles(prev => prev.filter(p => p.id !== id))
            }
        } catch (error) {
            logger.error("Error deleting bundle:", error)
            toast.error(whatMessage("failed", "delete"))
        }
    }, [authFetch, API])


    // ----------- Bundle Task Operations ===========================

    // POST batch add tasks to a bundle
    const addBundleTasks = useCallback(async (bundleId, tasks) => {
        try {

            // Validate - tasks
            if (!Array.isArray(tasks) || tasks.length === 0) {
                toast.warning(whatMessage("validation", "noTasks"))
                return
            }

            const res = await authFetch(`${API}/projects/${bundleId}/tasks`, {
                method: 'POST',
                body: JSON.stringify({ tasks })
            })

            if(res.ok){
                const updatedBundle = await res.json()
                toast.success(whatMessage("created"));
                setBundles(bundle => bundle.map( p => p.id === bundleId ? { ...p, tasks: updatedBundle.tasks, priority: updatedBundle.priority } : p ));
            }

        } catch (error) {
            logger.error("Error creating tasks in the bundle:", error)
            toast.error(whatMessage("failed", "create"))
        }
    }, [authFetch, API])

    // PUT batch update bundle tasks
    const batchUpdateBundleTasks = useCallback(async (bundleId, tasks) => {

        try {

            // Validate - tasks
            if (!Array.isArray(tasks) || tasks.length === 0) {
                toast.warning(whatMessage("validation", "noTasks"))
                return
            }

            const res = await authFetch(`${API}/projects/${bundleId}/tasks`, {
                method: 'PUT',
                body: JSON.stringify({ tasks })
            });

            if(res.ok){
                const data = await res.json()
                toast.success(whatMessage("updated"));
                setBundles(bundle => bundle.map( p => p.id === bundleId ? { ...p, tasks: data.allTasks, priority: data.priority } : p ))
            }

        } catch (error) {
            logger.error("Error updating tasks in the bundle:", error)
            toast.error(whatMessage("failed", "update"))
        }
    }, [authFetch, API])

    // PUT toggle single task completion
    const toggleBundleTaskCompletion = useCallback(async (bundleId, taskId, isCompleted) => {

        // Find the bundle, find the task inside it, flip is_completed
        // On error, revert

        try {
            // optimistic update like toggleDailyTaskCompletion
            setBundles(bundle => bundle.map( p => p.id === bundleId ? { ...p, tasks: p.tasks.map( task => task.id === taskId ? {...task, is_completed: isCompleted} : task) } : p ))

            await authFetch(`${API}/projects/${bundleId}/tasks/${taskId}`, {
                method: 'PUT',
                body: JSON.stringify({ is_completed: isCompleted })
            })

        } catch (error) {
            // if failed then revert back (have to add this since we're going omptimistic update)
            setBundles(bundle => bundle.map( p => p.id === bundleId ? { ...p, tasks: p.tasks.map( task => task.id === taskId ? {...task, is_completed: !isCompleted} : task) } : p ))
            logger.error("Error completing task in the bundle:", error)
            toast.error(whatMessage("failed", "complete"))
        }
    }, [authFetch, API])

    // DELETE batch delete bundle tasks
    const batchDeleteBundleTasks = useCallback(async (bundleId, taskIds) => {
        try {

            // Validate - task IDs
            if (!Array.isArray(taskIds) || taskIds.length === 0) {
                toast.warning(whatMessage("validation", "noTasks"))
                return
            }

            const res = await authFetch(`${API}/projects/${bundleId}/tasks`, {
                method: 'DELETE',
                body: JSON.stringify({ tasks: taskIds.map(id => ({ id })) })
            })

            if(res.ok){
                toast.success(whatMessage("deleted"))
                setBundles(bundle => bundle.map( p => p.id === bundleId ? {...p, tasks: p.tasks.filter(task => !taskIds.includes(task.id))} : p ))
            }

        } catch (error) {
            logger.error("Error deleting tasks in the bundle:", error)
            toast.error(whatMessage("failed", "delete"))
        }
    }, [authFetch, API])


    return {
        tasks,
        dailyTasks,
        bundles,
        tasksPagination,
        dailyTasksPagination,
        bundlesPagination,
        loadMoreTasks,
        loadMoreDailyTasks,
        loadMoreBundles,
        loadingMore,
        loading,
        addTask,
        updateTask,
        patchTaskInCache,
        setDailyTime,
        deleteTask,
        toggleTaskCompletion,
        addDailyTask,
        updateDailyTask,
        deleteDailyTask,
        toggleDailyTaskCompletion,
        batchToggleDailyTasks,
        batchDeleteDailyTasks,
        addBundle,
        updateBundle,
        deleteBundle,
        addBundleTasks,
        batchUpdateBundleTasks,
        toggleBundleTaskCompletion,
        batchDeleteBundleTasks,
    }
}
