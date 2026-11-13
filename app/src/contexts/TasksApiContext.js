import { createContext, useContext } from 'react'

/**
 * The app's tasks store (hooks/useTasks.js), for things deep in a page that
 * show or edit real tasks — a Format widget linked to tasks, on any board
 * mount (full page, dock, split). Its mutators write through the Bag store
 * (desktop/localStore.js) and its live sync, so nothing here touches files.
 *
 * value: { tasks, bundles, api: { addTask, updateTask, toggleTaskCompletion,
 *          addBundleTasks, batchUpdateBundleTasks, toggleBundleTaskCompletion } }
 */
const TasksApiContext = createContext({ tasks: [], bundles: [], api: {} })

export const TasksApiProvider = TasksApiContext.Provider
export const useTasksApi = () => useContext(TasksApiContext)
