import ListView from './ListView'

/**
 * View id (payload.view) → component. Each gets `{ item, source }` and talks
 * to the data only through `source` (dataSource.js). Sections 6–7 add Table,
 * Kanban, Timeline and Matrix here; until a view exists it renders as the
 * plain list, so a board made with a newer build still opens.
 */
const VIEW_COMPONENTS = {}

export const viewComponent = (id) => VIEW_COMPONENTS[id] || ListView
