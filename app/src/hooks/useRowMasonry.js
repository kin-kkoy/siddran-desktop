import { useLayoutEffect } from 'react'

export function useRowMasonry(containerRef, deps) {
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    const relayout = () => {
      const rowHeight = 8, gap = 16
      Array.from(container.children).forEach(child => {
        const h = child.getBoundingClientRect().height
        const span = Math.ceil((h + gap) / (rowHeight + gap))
        child.style.gridRowEnd = `span ${span}`
      })
    }

    relayout()

    const ro = new ResizeObserver(relayout)
    Array.from(container.children).forEach(child => ro.observe(child))
    window.addEventListener('resize', relayout)

    return () => {
      ro.disconnect()
      window.removeEventListener('resize', relayout)
    }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
}
