import { useEffect, useRef, useState } from 'react'
import { DEFAULT_TIMING, computeVars, totalDuration } from './splashTiming'
import styles from './SplashScreen.module.css'

// Launch animation: a zippered Bag drops in, the zipper pull slides across, and a
// burst of sparkles and arcs flies up out of the opened mouth — then the whole scene
// fades to reveal the app. (No zoom-into-the-bag; that read as disorienting.)
// Plays once per app session (gated by the caller via sessionStorage).

// Sparkle burst. Each particle flies from the bag's mouth along its own vector, with
// its own delay/size/spin, so the group reads as a firework rather than one shape
// scaling up. `arc` particles are the curved streaks; the rest are 4-point sparkles.
const STAR = 'M0 -9 C0.9 -3 3 -0.9 9 0 C3 0.9 0.9 3 0 9 C-0.9 3 -3 0.9 -9 0 C-3 -0.9 -0.9 -3 0 -9 Z'
const ARC = 'M-3 7 Q3 -5 1 -19'
const AMBER = '#f0b840'
const CREAM = '#ffe9b0'
const VIOLET = '#c9a2ff'

const PARTICLES = [
  { dx: -86, dy: -76, sc: 1.0, rot: -35, d: 0, fill: AMBER },
  { dx: -50, dy: -116, sc: 0.8, rot: 25, d: 90, arc: true, stroke: CREAM },
  { dx: -14, dy: -132, sc: 1.25, rot: 15, d: 40, fill: CREAM },
  { dx: 24, dy: -126, sc: 0.85, rot: -20, d: 120, arc: true, stroke: AMBER },
  { dx: 58, dy: -110, sc: 1.0, rot: 40, d: 60, fill: VIOLET },
  { dx: 92, dy: -72, sc: 0.85, rot: -30, d: 150, arc: true, stroke: AMBER },
  { dx: -106, dy: -36, sc: 0.65, rot: 45, d: 180, fill: AMBER },
  { dx: 108, dy: -40, sc: 0.7, rot: -45, d: 100, fill: CREAM },
  { dx: -34, dy: -98, sc: 0.7, rot: 10, d: 200, arc: true, stroke: VIOLET },
  { dx: 40, dy: -92, sc: 0.6, rot: -15, d: 230, fill: AMBER },
]
//
// Timing is fully parameterized (see splashTiming.js) and applied as CSS variables so
// the dev tuner (SplashDevPanel) can tweak the feel live. All values are milliseconds.

export default function SplashScreen({ onDone, timing }) {
  const t = { ...DEFAULT_TIMING, ...(timing || {}) }
  const doneRef = useRef(false)
  const [reduced] = useState(() => {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
  })

  const finish = () => {
    if (doneRef.current) return
    doneRef.current = true
    onDone?.()
  }

  useEffect(() => {
    // Safety net in case the terminating animationend never fires (backgrounded tab).
    const ms = reduced ? 700 : totalDuration(t) + 200
    const timer = setTimeout(finish, ms)
    const onKey = (e) => { if (e.key === 'Escape') finish() }
    window.addEventListener('keydown', onKey)
    return () => { clearTimeout(timer); window.removeEventListener('keydown', onKey) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      className={`${styles.overlay} ${reduced ? styles.reduced : ''}`}
      style={reduced ? undefined : computeVars(t)}
      onAnimationEnd={(e) => { if (reduced || /fade/i.test(e.animationName)) finish() }}
    >
      <div className={styles.stage}>
        <svg className={styles.bag} viewBox="0 0 240 240" aria-hidden="true">
          <defs>
            <linearGradient id="siddran-bag-body" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#2b2114" />
              <stop offset="1" stopColor="#15101c" />
            </linearGradient>
            <radialGradient id="siddran-bag-glow" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="#ffe9b0" />
              <stop offset="0.35" stopColor="#f0b840" />
              <stop offset="1" stopColor="#f0b840" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* interior glow — revealed as the mouth opens, then blooms for the dive */}
          <ellipse className={styles.glow} cx="120" cy="104" rx="66" ry="20" fill="url(#siddran-bag-glow)" />

          {/* Carry handle — feet land on the body's top edge so it reads attached. */}
          <path className={styles.handle} d="M98 88 C98 54 142 54 142 88"
            fill="none" stroke="#f0b840" strokeWidth="5" strokeLinecap="round" opacity="0.85" />

          {/* Body — one closed silhouette, gently flared toward the base. */}
          <path d="M56 106 Q56 84 78 84 H162 Q184 84 184 106 L190 190 Q192 214 166 214 H74 Q48 214 50 190 Z"
            fill="url(#siddran-bag-body)" stroke="#f0b840" strokeWidth="2.5" strokeOpacity="0.55" />

          {/* The mouth is deliberately STRAIGHT: the pull slides along it, and a
              curved seam meant the pull drifted off its own line mid-animation. */}
          <g className={styles.mouth}>
            <path className={styles.lip} d="M60 106 H180"
              fill="none" stroke="#f0b840" strokeWidth="3" strokeLinecap="round" />
          </g>

          {/* zipper teeth + sliding pull (same straight line) */}
          <path d="M60 106 H180" fill="none" stroke="#f0b840" strokeWidth="4"
            strokeLinecap="round" strokeDasharray="2 6" opacity="0.9" />
          <g className={styles.pull}>
            <circle cx="0" cy="0" r="7" fill="#15101c" stroke="#f0b840" strokeWidth="2.5" />
            <rect x="-2.5" y="6" width="5" height="12" rx="2.5" fill="#f0b840" />
          </g>

          {/* Sparkle burst out of the mouth. The outer <g> parks the origin AT the
              mouth using the transform attribute; each particle then animates with a
              CSS transform relative to it (mixing both on one element would clash). */}
          <g transform="translate(120 102)">
            {PARTICLES.map((p, i) => (
              <g
                key={i}
                className={styles.burst}
                style={{ '--dx': `${p.dx}px`, '--dy': `${p.dy}px`, '--sc': p.sc, '--rot': `${p.rot}deg`, '--pd': `${p.d}ms` }}
              >
                {p.arc
                  ? <path d={ARC} fill="none" stroke={p.stroke} strokeWidth="3" strokeLinecap="round" />
                  : <path d={STAR} fill={p.fill} />}
              </g>
            ))}
          </g>
        </svg>
      </div>
    </div>
  )
}
