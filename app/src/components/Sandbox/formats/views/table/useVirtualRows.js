import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * Draw only the rows in view once a table is long (spec R13.26).
 *
 * Under `threshold` items everything renders, exactly as before. Over it, the
 * items between the scroller's top and bottom (plus `overscan` px each side)
 * render, with spacers above and below holding the rest of the height, so
 * the scrollbar stays true.
 *
 * Rows wrap by default, so their heights differ. Each rendered row is
 * measured after layout (by its `data-vkey`) and remembered; rows not yet
 * seen count as the average of those that have been. The scrollbar can settle
 * a little the first time a long table is scrolled through.
 *
 * `items` are { key } objects; `bodyRef` is the element the rows sit in
 * (below the sticky header), inside `scrollRef`.
 */
export function useVirtualRows(items, scrollRef, bodyRef, { threshold = 200, overscan = 500, estimate = 34 } = {}) {
    const on = items.length > threshold
    const heights = useRef(new Map())
    const [, bump] = useState(0)
    const [view, setView] = useState({ top: 0, height: 800 })

    const read = useCallback(() => {
        const sc = scrollRef.current, body = bodyRef.current
        if (!sc || !body) return
        const top = sc.scrollTop - body.offsetTop
        setView(v => (Math.abs(v.top - top) < 1 && v.height === sc.clientHeight ? v : { top, height: sc.clientHeight }))
    }, [scrollRef, bodyRef])

    useEffect(() => {
        const sc = scrollRef.current
        if (!sc || !on) return
        // Scroll events come at most once a frame already; read straight away (setView skips no-op updates).
        sc.addEventListener('scroll', read, { passive: true })
        read()
        return () => sc.removeEventListener('scroll', read)
    }, [scrollRef, on, read])

    // Heights known so far, and their average for rows not yet drawn.
    const known = heights.current
    let sum = 0, n = 0
    for (const h of known.values()) { sum += h; n++ }
    const avg = n ? sum / n : estimate
    const hOf = (it) => known.get(it.key) ?? avg

    let first = 0, last = items.length - 1, padTop = 0, padBottom = 0
    if (on) {
        let y = 0, i = 0
        const lo = view.top - overscan, hi = view.top + view.height + overscan
        for (; i < items.length && y + hOf(items[i]) < lo; i++) y += hOf(items[i])
        first = i; padTop = y
        for (; i < items.length && y < hi; i++) y += hOf(items[i])
        last = i - 1
        for (; i < items.length; i++) padBottom += hOf(items[i])
    }

    // Measure what was drawn; re-render only if a height actually changed.
    useLayoutEffect(() => {
        if (!on) return
        const body = bodyRef.current
        if (!body) return
        let changed = false
        for (const el of body.querySelectorAll(':scope > [data-vkey]')) {
            const k = el.getAttribute('data-vkey'), h = el.offsetHeight
            if (h && Math.abs((known.get(k) ?? -1) - h) > 0.5) { known.set(k, h); changed = true }
        }
        if (changed) bump(x => x + 1)
    }, [on, items, view, first, last, bodyRef, known])   // re-measure when the rows or the window change; settles once heights stop changing

    /** The offset (px, from the top of the rows) of item `index` — to bring a row into view. */
    const offsetOf = useCallback((index) => {
        let y = 0
        for (let i = 0; i < index && i < items.length; i++) y += known.get(items[i].key) ?? avg
        return y
    }, [items, known, avg])

    return { on, first, last, padTop, padBottom, offsetOf, heightOf: (i) => hOf(items[i] || {}) }
}
