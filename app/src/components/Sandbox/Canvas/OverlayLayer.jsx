/**
 * DOM overlay that shares the canvas viewport transform. Cards (notes, tasks
 * in Phase 2, images later) live here as real React DOM nodes — so they
 * remain crisp on zoom, accessible, copy/paste-able, and easy to event-handle.
 *
 * The container itself has `pointer-events: none` so it doesn't intercept the
 * pen; each card opts back in with `pointer-events: auto`.
 */
function OverlayLayer({ viewport, width, height, children }) {
    return (
        <div
            style={{
                position: 'absolute',
                top: 0, left: 0,
                width, height,
                overflow: 'hidden',
                pointerEvents: 'none',
            }}
        >
            {/* Pan with a plain translate, ROUNDED to whole pixels + promoted to its
                own compositor layer (translate3d + will-change). A fractional
                translate samples the layer texture off-grid → the "sharp at 0,0 but
                blurry once I pan" effect; rounding pins it to the pixel grid, and
                compositing keeps panning cheap (no per-frame repaint of the cards). */}
            <div
                style={{
                    position: 'absolute',
                    top: 0, left: 0,
                    transform: `translate3d(${Math.round(viewport.x)}px, ${Math.round(viewport.y)}px, 0)`,
                    transformOrigin: '0 0',
                    willChange: 'transform',
                }}
            >
                {/* ZOOM via the CSS `zoom` property, not `transform: scale()`. `zoom`
                    re-lays-out the cards at the target size so text stays razor-sharp
                    at any zoom (a scale() transform samples a base-res texture = the
                    blur). Coords are unchanged: a world point (x,y) lands at vx+x*zoom. */}
                <div style={{ zoom: viewport.zoom }}>
                    {children}
                </div>
            </div>
        </div>
    )
}

export default OverlayLayer
