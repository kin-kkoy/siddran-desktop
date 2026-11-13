import { useLayoutEffect, useRef } from 'react'

/**
 * Keeping a widget's insides in proportion at any board zoom.
 *
 * The board zooms its cards with CSS `zoom` (sharp text at any zoom). But
 * WebKit has a "smart minimum" font size: text *specified* at 9px or more is
 * never drawn below 9px once zoom shrinks it, and WebKitGTK offers no way to
 * turn it off. Zoomed out, a widget's text (and everything sized in em) would
 * stop shrinking with the widget and look ever bigger inside it.
 *
 * Text specified below 9px is exempt. So when the board is zoomed out, a
 * widget is laid out at 1/k scale and magnified k times with its own `zoom`:
 * its box and text size are divided by k here, and every fixed size inside it
 * is written `calc(Npx * var(--z, 1))` with --z = 1/k. On screen nothing
 * changes — its text is just specified small enough to shrink with the widget.
 *
 * k = the smallest whole number with zoom × k ≥ 1 (1 at 100 % and above, the
 * plain layout). That keeps every text exempt (anything the board shrinks
 * below 9px is specified under 9px), and keeps hairlines thin: WebKit rounds a
 * border thinner than 1px up to 1px *before* zooming, so a border draws
 * zoom × k px — between 1 and ~1.5. k changes only when the zoom crosses
 * 1/2, 1/3, 1/4…, so zooming re-renders a widget a handful of times, not on
 * every wheel step; the board's CSS zoom does the rest.
 *
 * Outside a widget (pop-ups, full screen, the Notes page, which share some of
 * these stylesheets) --z is unset, so the same rules read as plain px.
 */
export const innerScale = (zoom) => (zoom >= 1 || !(zoom > 0) ? 1 : Math.ceil(1 / zoom - 1e-6))

export function widgetBox(item, font, k = 1) {
    return {
        zoom: k,
        left: item.x / k, top: item.y / k, width: item.w / k, height: item.h / k,
        '--z': 1 / k,
        '--fmt-font': `${font / k}px`,
    }
}

/**
 * When k changes, everything inside is laid out at a new scale: scrolled areas
 * (a Timeline at today, a long Table, a Doc) keep showing the same content.
 * The positions are read while rendering, before the new scale reaches the
 * page — by the time an effect runs, the browser has already squeezed them to
 * fit the smaller content.
 */
export function useKeepScroll(ref, k) {
    const prev = useRef(k)
    const snap = useRef(null)
    // Deliberately reads the DOM while rendering (before the commit).
    if (prev.current !== k && ref.current && !snap.current) {
        snap.current = [...ref.current.querySelectorAll('[data-sb-scroll], .cm-scroller')].map(el => [el, el.scrollLeft, el.scrollTop])
    }
    useLayoutEffect(() => {
        const from = prev.current, saved = snap.current
        prev.current = k
        snap.current = null
        if (from === k || !saved) return
        const f = from / k
        for (const [el, left, top] of saved) { el.scrollLeft = left * f; el.scrollTop = top * f }
    }, [k, ref])
}

/** A react-icons size that follows --z inside a widget: {...zIcon(13)}. */
export const zIcon = (n) => ({ size: n, style: { width: `calc(${n}px * var(--z, 1))`, height: `calc(${n}px * var(--z, 1))` } })
