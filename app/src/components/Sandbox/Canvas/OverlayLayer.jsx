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
            <div
                style={{
                    position: 'absolute',
                    top: 0, left: 0,
                    transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
                    transformOrigin: '0 0',
                    willChange: 'transform',
                }}
            >
                {children}
            </div>
        </div>
    )
}

export default OverlayLayer
