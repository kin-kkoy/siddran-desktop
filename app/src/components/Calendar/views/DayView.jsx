import { useState } from 'react'
import TimeGrid from './TimeGrid.jsx'
import UnscheduledDrawer from './UnscheduledDrawer.jsx'
import styles from './DayView.module.css'

// Day view = single-column TimeGrid + the unscheduled-tasks drawer beside it. While a drawer task
// is being dragged, `drawerPreview` mirrors the drag into TimeGrid's drop indicators (timeline
// ghost + all-day chip), so the drawer drag shows the same affordance as a block drag.
//
// In the 2-column layout (`day2col`) the whole day fits the viewport as two timelines and the
// Unscheduled drawer collapses to a toggle pop-over (to free the horizontal space).
export default function DayView({ dayISO, itemsAt, ephemeralAt, fill, day2col, dayBalanced, onToggleBalanced, onSlotClick, onEventClick, onRetime, onResizeEvent, undated, onSchedule, onUnschedule, onToggleDaily, onDailyTime, onDailyDone, onJumpToDay, onDismissConflict }) {
    const [drawerPreview, setDrawerPreview] = useState(null)
    const [unschedOpen, setUnschedOpen] = useState(false)
    const [canRebalance, setCanRebalance] = useState(false)

    const grid = (
        <TimeGrid
            days={[dayISO]}
            itemsAt={itemsAt}
            ephemeralAt={ephemeralAt}
            fill={fill}
            day2col={day2col}
            dayBalanced={dayBalanced}
            onRebalanceAvailable={setCanRebalance}
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
    )

    // 2-column: grid fills the width; Unscheduled is a toggle pop-over.
    if (day2col) {
        return (
            <div className={`${styles.shellSolo} ${styles.fill}`}>
                <div className={styles.grid}>{grid}</div>
                <div className={styles.unschedDock}>
                    {canRebalance && (
                        <button className={styles.rebalanceBtn} onClick={onToggleBalanced} title={dayBalanced ? 'Back to the noon split' : 'Rebalance to equal-height columns'}>
                            {dayBalanced ? '⇄ noon split' : '⇄ rebalance'}
                        </button>
                    )}
                    <button className={styles.unschedToggle} onClick={() => setUnschedOpen(o => !o)} aria-expanded={unschedOpen}>
                        Unscheduled · {undated.length}
                    </button>
                    {unschedOpen && (
                        <div className={styles.unschedPopover}>
                            <UnscheduledDrawer tasks={undated} onSchedule={onSchedule} onDragPreview={setDrawerPreview} />
                        </div>
                    )}
                </div>
            </div>
        )
    }

    return (
        <div className={`${styles.shell} ${fill ? styles.fill : ''}`}>
            <div className={styles.grid}>{grid}</div>
            <UnscheduledDrawer tasks={undated} onSchedule={onSchedule} onDragPreview={setDrawerPreview} />
        </div>
    )
}
