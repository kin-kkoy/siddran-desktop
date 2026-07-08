import { useState } from 'react'
import TimeGrid from './TimeGrid.jsx'
import UnscheduledDrawer from './UnscheduledDrawer.jsx'
import styles from './DayView.module.css'

// Day view = single-column TimeGrid + the unscheduled-tasks drawer beside it. While a drawer task
// is being dragged, `drawerPreview` mirrors the drag into TimeGrid's drop indicators (timeline
// ghost + all-day chip), so the drawer drag shows the same affordance as a block drag.
export default function DayView({ dayISO, itemsAt, ephemeralAt, fill, onSlotClick, onEventClick, onRetime, onResizeEvent, undated, onSchedule, onUnschedule, onToggleDaily, onDailyTime, onDailyDone, onJumpToDay, onDismissConflict }) {
    const [drawerPreview, setDrawerPreview] = useState(null)
    return (
        <div className={`${styles.shell} ${fill ? styles.fill : ''}`}>
            <div className={styles.grid}>
                <TimeGrid
                    days={[dayISO]}
                    itemsAt={itemsAt}
                    ephemeralAt={ephemeralAt}
                    fill={fill}
                    onSlotClick={onSlotClick}
                    onEventClick={onEventClick}
                    onRetime={onRetime}
                    onResizeEvent={onResizeEvent}
                    onUnschedule={onUnschedule}
                    onToggleDaily={onToggleDaily}
                    onDailyTime={onDailyTime}
                    onDailyDone={onDailyDone}
                    onJumpToDay={onJumpToDay}
                    onDismissConflict={onDismissConflict}
                    externalPreview={drawerPreview}
                />
            </div>
            <UnscheduledDrawer tasks={undated} onSchedule={onSchedule} onDragPreview={setDrawerPreview} />
        </div>
    )
}
