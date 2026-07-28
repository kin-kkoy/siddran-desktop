import { useEffect, useRef, useState } from 'react'
import { DEFAULT_TIMING, computeVars, totalDuration } from './splashTiming'
import styles from './SplashScreen.module.css'

// Launch animation: a zippered Bag drops in, its zipper pull slides across and the
// mouth opens onto a glowing amber interior, then the "camera" dives into the open
// bag (the whole scene zooms into the mouth and fades) to reveal the app underneath.
// Plays once per app session (gated by the caller via sessionStorage).
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
      onAnimationEnd={(e) => { if (reduced || /dive|fade/i.test(e.animationName)) finish() }}
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
        </svg>
      </div>
    </div>
  )
}
