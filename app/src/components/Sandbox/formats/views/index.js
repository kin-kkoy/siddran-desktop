import { LuTable2, LuSquareKanban, LuGrid2X2, LuChartGantt } from 'react-icons/lu'
import ListView from './ListView'
import TableView from './TableView'
import KanbanView from './KanbanView'
import MatrixView from './MatrixView'
import TimelineView from './TimelineView'
import { VIEWS } from '../formats'

/**
 * View id (payload.view) → component. Each gets `{ item, source }` and talks
 * to the data only through `source` (dataSource.js), plus `onConfig(fn)` to
 * change its own view settings (payload.table, payload.kanban…, one undo step
 * each). A view not built yet renders as the plain list, so a board made with
 * a newer build still opens.
 */
const VIEW_COMPONENTS = { table: TableView, kanban: KanbanView, timeline: TimelineView, matrix: MatrixView }

export const viewComponent = (id) => VIEW_COMPONENTS[id] || ListView
export const VIEW_ICONS = { table: LuTable2, kanban: LuSquareKanban, matrix: LuGrid2X2, timeline: LuChartGantt }
/** The views the switcher offers: the built ones (plus the current one, whatever it is). */
export const switchableViews = (current) => VIEWS.filter(v => VIEW_COMPONENTS[v.id] || v.id === current)
