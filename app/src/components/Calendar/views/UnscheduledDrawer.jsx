import { useRef, useState } from 'react'
import styles from './UnscheduledDrawer.module.css'
import { pointToDayTime, snap15, minutesToTime } from './timeGridGeom'

const DRAG_THRESHOLD = 4

// Lists undated tasks. Drag one onto the time grid to schedule it (drop resolves to a day +
// time via slotFromPoint, then onSchedule(taskId, day, time) sets its due_date).
export default function UnscheduledDrawer({ tasks, onSchedule, onDragPreview }) {
    const drag = useRef(null)
    const ghostRef = useRef(null)
    const [dragTitle, setDragTitle] = useState(null)

    const positionGhost = (x, y) => {
        if (ghostRef.current) ghostRef.current.style.transform = `translate(${x + 12}px, ${y + 12}px)`
    }

    const onPointerDown = (e, task) => {
        drag.current = { task, startX: e.clientX, startY: e.clientY, dragging: false }
        e.preventDefault() // don't let the drag begin a text selection (stuttery highlight)
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* no-op */ }
    }
    const onPointerMove = (e) => {
        const st = drag.current
        if (!st) return
        if (!st.dragging) {
            if (Math.hypot(e.clientX - st.startX, e.clientY - st.startY) < DRAG_THRESHOLD) return
            st.dragging = true
            setDragTitle(st.task.title)
        }
        positionGhost(e.clientX, e.clientY)
        // Mirror the hover into TimeGrid's drop indicators (all-day cell, or a timeline ghost).
        if (onDragPreview) {
            const allDayCell = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-allday]')
            if (allDayCell) {
                onDragPreview({ type: 'allday', day: allDayCell.getAttribute('data-col'), label: st.task.title })
            } else {
                const pt = pointToDayTime(e.clientX, e.clientY)
                if (pt) {
                    const start = snap15(pt.minutes)
                    onDragPreview({ type: 'timeline', day: pt.day, startMin: start, endMin: start + 60, label: st.task.title })
                } else {
                    onDragPreview(null)
                }
            }
        }
    }
    const onPointerUp = (e) => {
        const st = drag.current
        drag.current = null
        try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* no-op */ }
        setDragTitle(null)
        onDragPreview?.(null)
        if (st?.dragging) {
            // Drop on the all-day row → schedule all-day (no time) on that cell's day.
            const allDayCell = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-allday]')
            if (allDayCell) {
                const day = allDayCell.getAttribute('data-col')
                if (day) onSchedule(st.task.id, day, null)
                return
            }
            const pt = pointToDayTime(e.clientX, e.clientY)
            if (pt) onSchedule(st.task.id, pt.day, minutesToTime(snap15(pt.minutes)))
        }
    }

    return (
        <aside className={styles.drawer} data-unschedule="1">
            <h4 className={styles.title}>Unscheduled · {tasks.length}</h4>
            {tasks.length === 0 ? (
                <div className={styles.empty}>Nothing unscheduled. <br /><small>Drag a task onto the grid to plan it, or drop one here to unschedule it.</small></div>
            ) : (
                tasks.map(t => (
                    <div
                        key={t.id}
                        className={styles.item}
                        title={t.title}
                        onPointerDown={(e) => onPointerDown(e, t)}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                    >
                        <span className={styles.grip}>⠿</span>
                        <span className={styles.itemTitle}>{t.title}</span>
                    </div>
                ))
            )}
            {dragTitle && <div ref={ghostRef} className={styles.ghost}>{dragTitle}</div>}
        </aside>
    )
}
