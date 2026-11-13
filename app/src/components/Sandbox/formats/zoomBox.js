/**
 * Keeping a widget's insides in proportion at any board zoom.
 *
 * The board zooms its cards with CSS `zoom` (sharp text at any zoom). But
 * WebKit has a "smart minimum" font size: text specified at 9px or more is
 * never drawn below 9px once zoom shrinks it, and WebKitGTK offers no way to
 * turn it off. Zoomed out, a widget's text (and everything sized in em) would
 * stop shrinking with the widget and look ever bigger inside it.
 *
 * So a widget cancels the board's zoom (`zoom: 1 / z`, its insides drawn at
 * zoom 1) and is laid out at its size on screen: its box and text size are
 * multiplied by z here, and its stylesheets size fixed things as
 * `calc(Npx * var(--z, 1))`. Outside a widget (pop-ups, full screen) --z is
 * unset, so the same rules read as plain px.
 */
export function widgetBox(item, zoom, font) {
    const z = zoom > 0 ? zoom : 1
    return {
        zoom: 1 / z,
        left: item.x * z, top: item.y * z, width: item.w * z, height: item.h * z,
        '--z': z,
        '--fmt-font': `${font * z}px`,
    }
}

/** A react-icons size that follows --z inside a widget: {...zIcon(13)}. */
export const zIcon = (n) => ({ size: n, style: { width: `calc(${n}px * var(--z, 1))`, height: `calc(${n}px * var(--z, 1))` } })
