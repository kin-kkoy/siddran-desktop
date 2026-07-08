import TimeGrid from './TimeGrid.jsx'
import { weekDays, isoDate } from '../calendarDates'

// Week view = the shared TimeGrid over the Monday-start week containing `anchor` (a Date).
export default function WeekView({ anchor, itemsAt, ephemeralAt, fill, onSlotClick, onEventClick, onRetime, onResizeEvent, onToggleDaily, onDailyTime, onDailyDone, onJumpToDay, onDismissConflict }) {
    const days = weekDays(anchor).map(isoDate)
    return (
        <TimeGrid
            days={days}
            itemsAt={itemsAt}
            ephemeralAt={ephemeralAt}
            fill={fill}
            onSlotClick={onSlotClick}
            onEventClick={onEventClick}
            onRetime={onRetime}
            onResizeEvent={onResizeEvent}
            onToggleDaily={onToggleDaily}
            onDailyTime={onDailyTime}
            onDailyDone={onDailyDone}
            onJumpToDay={onJumpToDay}
            onDismissConflict={onDismissConflict}
        />
    )
}
