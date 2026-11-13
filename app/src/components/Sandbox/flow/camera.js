// The node editor's camera: { x, y, z } — the view's top-left in diagram
// coordinates, and its zoom.

// The outer band of the view (a share of its width/height on each side). A node
// that moves into it — or out of view — brings the camera along; anywhere
// inside, the view you set up is left alone.
export const EDGE_BAND = 0.1

/** The camera after making sure `box` sits inside the view's inner area. */
export function keepInView(c, box, size) {
  const axis = (pos, len, cam, view) => {
    const band = view * EDGE_BAND
    if (pos >= cam + band && pos + len <= cam + view - band) return cam
    // Halfway between the middle and the band, on the side it went out.
    const centre = pos + len / 2
    const side = centre < cam + view / 2 ? -1 : 1
    return centre - (view / 2 + side * (view / 2 - band) / 2)
  }
  const vw = size.w / c.z, vh = size.h / c.z
  const x = axis(box.x, box.w, c.x, vw), y = axis(box.y, box.h, c.y, vh)
  return x === c.x && y === c.y ? c : { ...c, x, y }
}
