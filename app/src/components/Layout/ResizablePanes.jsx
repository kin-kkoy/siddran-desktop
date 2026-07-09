import { useState, useRef, useEffect, useCallback } from 'react'
import styles from './ResizablePanes.module.css'

export default function ResizablePanes({ 
  left, 
  right, 
  initialLeftWidth = 50, 
  minLeftWidth = 10, 
  maxLeftWidth = 90,
  leftClassName = '',
  rightClassName = ''
}) {
  const [leftWidth, setLeftWidth] = useState(initialLeftWidth)
  const containerRef = useRef(null)
  const [isDragging, setIsDragging] = useState(false)

  const startDrag = (e) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const onMouseMove = useCallback((e) => {
    if (!isDragging || !containerRef.current) return
    const containerRect = containerRef.current.getBoundingClientRect()
    let newWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100
    newWidth = Math.max(minLeftWidth, Math.min(maxLeftWidth, newWidth))
    setLeftWidth(newWidth)
  }, [isDragging, minLeftWidth, maxLeftWidth])

  const onMouseUp = useCallback(() => {
    if (isDragging) setIsDragging(false)
  }, [isDragging])

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    } else {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [isDragging, onMouseMove, onMouseUp])

  return (
    <div className={styles.container} ref={containerRef}>
      <div 
        className={`${styles.pane} ${leftClassName}`} 
        style={{ width: `${leftWidth}%` }}
      >
        {left}
      </div>
      
      <div 
        className={`${styles.divider} ${isDragging ? styles.dividerDragging : ''}`}
        onMouseDown={startDrag}
      >
        <div className={styles.dividerHandle} />
      </div>
      
      <div 
        className={`${styles.pane} ${rightClassName}`} 
        style={{ width: `${100 - leftWidth}%` }}
      >
        {right}
      </div>
      
      {/* Overlay to capture mouse events over iframes (e.g. PDF viewer) during drag */}
      {isDragging && <div className={styles.overlay} />}
    </div>
  )
}
