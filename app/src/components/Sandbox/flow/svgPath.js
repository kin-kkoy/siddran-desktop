// A shape's outline as an SVG path string, from the same registry render
// functions the board's canvas uses — so a box in the node editor is the box
// you get on the board. The render functions draw with a 2D-context API; this
// records those calls as path commands instead.

import { renderShape } from '../shapes/registry'

const r2 = (v) => Math.round(v * 100) / 100

function recorder() {
  const d = []
  let cur = null, start = null
  const at = (x, y) => { cur = { x, y } }
  const ctx = {
    moveTo(x, y) { d.push(`M${r2(x)} ${r2(y)}`); at(x, y); start = { x, y } },
    lineTo(x, y) { d.push(cur ? `L${r2(x)} ${r2(y)}` : `M${r2(x)} ${r2(y)}`); if (!cur) start = { x, y }; at(x, y) },
    closePath() { d.push('Z'); if (start) at(start.x, start.y) },
    quadraticCurveTo(cx, cy, x, y) { d.push(`Q${r2(cx)} ${r2(cy)} ${r2(x)} ${r2(y)}`); at(x, y) },
    bezierCurveTo(a, b, c, e, x, y) { d.push(`C${r2(a)} ${r2(b)} ${r2(c)} ${r2(e)} ${r2(x)} ${r2(y)}`); at(x, y) },
    // Canvas arcTo: a corner of radius r between the lines cur→(x1,y1)→(x2,y2).
    arcTo(x1, y1, x2, y2, r) {
      const p0 = cur || { x: x1, y: y1 }
      const v1 = { x: p0.x - x1, y: p0.y - y1 }, v2 = { x: x2 - x1, y: y2 - y1 }
      const l1 = Math.hypot(v1.x, v1.y), l2 = Math.hypot(v2.x, v2.y)
      const cross = v1.x * v2.y - v1.y * v2.x
      if (!r || !l1 || !l2 || Math.abs(cross) < 1e-9) { ctx.lineTo(x1, y1); return }
      const ang = Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / (l1 * l2))))
      const t = r / Math.tan(ang / 2)
      const a = { x: x1 + (v1.x / l1) * t, y: y1 + (v1.y / l1) * t }
      const b = { x: x1 + (v2.x / l2) * t, y: y1 + (v2.y / l2) * t }
      ctx.lineTo(a.x, a.y)
      d.push(`A${r2(r)} ${r2(r)} 0 0 ${cross < 0 ? 1 : 0} ${r2(b.x)} ${r2(b.y)}`)
      at(b.x, b.y)
    },
    ellipse(cx, cy, rx, ry, rot, a0, a1, ccw = false) {
      let sweep = ccw ? a0 - a1 : a1 - a0
      if (sweep < 0) sweep += Math.PI * 2
      const full = sweep >= Math.PI * 2 - 1e-6
      const pt = (a) => ({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) })
      const p0 = pt(a0)
      ctx.lineTo(p0.x, p0.y)
      // SVG can't draw a whole ellipse in one arc: split it in two halves.
      const steps = full ? 2 : 1
      const each = (full ? Math.PI * 2 : sweep) / steps
      for (let k = 1; k <= steps; k++) {
        const a = ccw ? a0 - each * k : a0 + each * k
        const p = pt(a)
        d.push(`A${r2(rx)} ${r2(ry)} 0 ${each > Math.PI ? 1 : 0} ${ccw ? 0 : 1} ${r2(p.x)} ${r2(p.y)}`)
        at(p.x, p.y)
      }
    },
  }
  return { ctx, d }
}

/** The outline of a `kind` box of w×h, as an SVG path `d` in box-local coordinates. */
export function shapeOutline(kind, w, h, radius = 0) {
  const { ctx, d } = recorder()
  if (kind === 'ellipse') ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
  else if (!renderShape(ctx, kind, w, h, radius)) {
    // rect / roundedRect: Konva draws these natively, without a render fn.
    const r = Math.max(0, Math.min(radius, w / 2, h / 2))
    ctx.moveTo(r, 0); ctx.lineTo(w - r, 0); ctx.arcTo(w, 0, w, r, r); ctx.lineTo(w, h - r); ctx.arcTo(w, h, w - r, h, r)
    ctx.lineTo(r, h); ctx.arcTo(0, h, 0, h - r, r); ctx.lineTo(0, r); ctx.arcTo(0, 0, r, 0, r); ctx.closePath()
  }
  return d.join(' ')
}
