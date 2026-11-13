import ListView from './ListView'
import TableView from './TableView'

/**
 * View id (payload.view) → component. Each gets `{ item, source }` and talks
 * to the data only through `source` (dataSource.js), plus `onConfig(fn)` to
 * change its own view settings (payload.table etc., one undo step each).
 * Section 7 adds Kanban, Timeline and Matrix here; until a view exists it
 * renders as the plain list, so a board made with a newer build still opens.
 */
const VIEW_COMPONENTS = { table: TableView }

export const viewComponent = (id) => VIEW_COMPONENTS[id] || ListView
