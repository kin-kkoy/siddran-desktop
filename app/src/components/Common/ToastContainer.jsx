import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { toast } from '../../utils/toast'
import styles from './ToastContainer.module.css'

const AUTO_DISMISS_MS = 3000

function ToastContainer() {
    const [toasts, setToasts] = useState([])
    const timersRef = useRef(new Map())

    const removeToast = useCallback((id) => {
        const timer = timersRef.current.get(id)
        if (timer) {
            clearTimeout(timer)
            timersRef.current.delete(id)
        }
        setToasts(prev => prev.filter(t => t.id !== id))
    }, [])

    const scheduleDismiss = useCallback((id) => {
        if (timersRef.current.has(id)) return
        const timer = setTimeout(() => removeToast(id), AUTO_DISMISS_MS)
        timersRef.current.set(id, timer)
    }, [removeToast])

    useEffect(() => {
        const unsubscribe = toast.subscribe((payload) => {
            const { action, id } = payload

            if (action === 'dismiss') {
                removeToast(id)
                return
            }

            if (action === 'update') {
                setToasts(prev => prev.map(t =>
                    t.id === id ? { ...t, message: payload.message, type: payload.type, sticky: false } : t
                ))
                scheduleDismiss(id)
                return
            }

            // action === 'add'
            setToasts(prev => [...prev, payload])
            if (!payload.sticky) scheduleDismiss(id)
        })
        return unsubscribe
    }, [removeToast, scheduleDismiss])

    useEffect(() => {
        const timers = timersRef.current
        return () => {
            timers.forEach(clearTimeout)
            timers.clear()
        }
    }, [])

    if (toasts.length === 0) return null

    return createPortal(
        <div className={styles.container}>
            {toasts.map(t => (
                <div key={t.id} className={`${styles.toast} ${styles[t.type]}`}>
                    {t.type === 'loading' && <span className={styles.spinner} aria-hidden="true" />}
                    <span className={styles.message}>{t.message}</span>
                    {!t.sticky && (
                        <button onClick={() => removeToast(t.id)} className={styles.closeBtn}>
                            &times;
                        </button>
                    )}
                </div>
            ))}
        </div>,
        document.body
    )
}

export default ToastContainer
