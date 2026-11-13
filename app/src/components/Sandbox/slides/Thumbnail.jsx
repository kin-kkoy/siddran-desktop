import { memo } from 'react'
import { shapeOutline } from '../flow/svgPath'
import { isLineKind } from '../shapes/registry'
import { connectorPoints } from '../connectors/geometry'
import { isFrame, FRAME_DEFAULT_FILL } from '../frames/frames'
import { isFormat } from '../formats/formats'
import { resolveImageUrl } from '../../../utils/imageUpload'
import { contrastText, STICKY_DEFAULT } from '../text/textStyle'
import { CARD_TYPES } from './slides'

/**
 * A slide's miniature: what lies in the frame, drawn as SVG in the frame's
 * own coordinates. SVG rather than a Konva snapshot, so cards and widgets
 * (DOM on the board) show too, off-screen frames need no repaint, and it
 * costs nothing until the board changes.
 */

const fillOf = (f) => (f && f !== 'transparent' ? f : 'none')

function strokePath(flat) {
    if (!flat || flat.length < 4) return ''
    let d = `M${flat[0]} ${flat[1]}`
    for (let i = 2; i < flat.length; i += 2) d += `L${flat[i]} ${flat[i + 1]}`
    return d + 'Z'
}

const boxTransform = (it) => {
    const w = Math.abs(it.w ?? 0), h = Math.abs(it.h ?? 0)
    const r = it.rotation || 0
    return r ? `translate(${it.x} ${it.y}) rotate(${r} ${w / 2} ${h / 2})` : `translate(${it.x} ${it.y})`
}

function Lines({ text, w, h, size, color, pad = 6 }) {
    if (!text) return null
    const per = Math.max(4, Math.floor((w - pad * 2) / (size * 0.55)))
    const rows = []
    for (const para of String(text).split('\n')) {
        let line = ''
        for (const word of para.split(/\s+/)) {
            if ((line + ' ' + word).trim().length > per && line) { rows.push(line); line = word }
            else line = (line ? line + ' ' : '') + word
        }
        rows.push(line)
    }
    const max = Math.max(1, Math.floor((h - pad * 2) / (size * 1.25)))
    return (
        <text fill={color} fontSize={size} fontFamily="sans-serif">
            {rows.slice(0, max).map((r, i) => <tspan key={i} x={pad} y={pad + size * (1 + i * 1.25)}>{r}</tspan>)}
        </text>
    )
}

function Item({ it, byId }) {
    const p = it.payload || {}
    const w = Math.abs(it.w ?? 0), h = Math.abs(it.h ?? 0)
    if (it.type === 'connector') {
        const pts = connectorPoints(it, byId)
        if (!pts || pts.length < 4) return null
        return <polyline points={pts.join(' ')} fill="none" stroke={p.stroke || '#e2ddf5'} strokeWidth={p.strokeWidth || 2} />
    }
    if (it.type === 'stroke') {
        const flat = p.flatOutline
        if (!flat) return null
        let bw = p.baseW, bh = p.baseH
        if (bw == null || bh == null) {
            bw = 0; bh = 0
            for (let i = 0; i < flat.length; i += 2) { bw = Math.max(bw, flat[i]); bh = Math.max(bh, flat[i + 1]) }
        }
        const rw = it.w ?? bw, rh = it.h ?? bh
        const sx = bw ? rw / bw : 1, sy = bh ? rh / bh : 1
        const t = `translate(${it.x + rw / 2} ${it.y + rh / 2}) rotate(${it.rotation || 0}) scale(${sx} ${sy}) translate(${-bw / 2} ${-bh / 2})`
        return <path d={strokePath(flat)} transform={t} fill={p.color || '#e2ddf5'} />
    }
    if (it.type === 'image') {
        const href = resolveImageUrl(p.url ?? p.src)
        return href ? <image href={href} width={w} height={h} transform={boxTransform(it)} preserveAspectRatio="none" /> : null
    }
    if (it.type === 'text') {
        return <g transform={boxTransform(it)}><Lines text={p.text} w={w} h={h} size={p.fontSize || 16} color={p.color || '#e6e6ee'} pad={2} /></g>
    }
    if (CARD_TYPES.has(it.type) || isFormat(it)) {
        const label = isFormat(it) ? (p.title || 'Table') : it.type === 'pdf' ? (p.name || 'PDF') : it.type === 'note' ? 'Note' : 'Task'
        return (
            <g transform={boxTransform(it)}>
                <rect width={w} height={h} rx={8} fill="#2a2a33" stroke="rgba(255,255,255,0.18)" />
                {isFormat(it) && <rect width={w} height={Math.min(h, 34)} rx={8} fill="#34343f" />}
                <Lines text={label} w={w} h={Math.min(h, 60)} size={15} color="#c8c8d2" pad={10} />
            </g>
        )
    }
    if (it.type !== 'shape') return null
    if (isFrame(it)) {
        return <rect x={it.x} y={it.y} width={w} height={h} fill={fillOf(p.fill || FRAME_DEFAULT_FILL)} stroke="rgba(160,160,190,0.35)" />
    }
    const kind = p.kind || 'rect'
    if (isLineKind(kind) || kind === 'taperedArrow') {
        const bw = p.baseW || w || 1, bh = p.baseH || h || 1
        const pts = p.points || [0, 0, bw, bh]
        const sp = []
        for (let i = 0; i < pts.length; i += 2) sp.push(pts[i] * (w / bw), pts[i + 1] * (h / bh))
        return <g transform={boxTransform(it)}><polyline points={sp.join(' ')} fill="none" stroke={p.stroke || '#e2ddf5'} strokeWidth={p.strokeWidth || 2} strokeLinecap="round" /></g>
    }
    const sticky = kind === 'sticky'
    const fill = sticky ? (fillOf(p.fill) === 'none' ? STICKY_DEFAULT : p.fill) : fillOf(p.fill)
    const d = sticky ? `M0 0H${w}V${h}H0Z` : shapeOutline(kind, w, h, p.radius || (kind === 'roundedRect' ? 12 : 0))
    const textColor = p.textColor || (sticky ? contrastText(fill) : '#ffffff')
    return (
        <g transform={boxTransform(it)}>
            <path d={d} fill={fill} stroke={sticky ? 'none' : (p.stroke || 'none')} strokeWidth={p.strokeWidth || 0} />
            <Lines text={p.text} w={w} h={h} size={p.fontSize || (sticky ? 18 : 16)} color={textColor} pad={sticky ? 12 : 8} />
        </g>
    )
}

const Thumbnail = memo(function Thumbnail({ frame, contents, byId }) {
    const p = frame.payload || {}
    const id = `slide-clip-${frame.id}`
    return (
        <svg viewBox={`${frame.x} ${frame.y} ${Math.max(1, frame.w)} ${Math.max(1, frame.h)}`} preserveAspectRatio="xMidYMid meet"
            width="100%" height="100%" aria-hidden="true">
            <defs><clipPath id={id}><rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} /></clipPath></defs>
            <rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} fill="var(--bg-surface)" />
            <rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} fill={fillOf(p.fill || FRAME_DEFAULT_FILL)} />
            <g clipPath={`url(#${id})`}>
                {contents.map(it => <Item key={it.id} it={it} byId={byId} />)}
            </g>
        </svg>
    )
})

export default Thumbnail
