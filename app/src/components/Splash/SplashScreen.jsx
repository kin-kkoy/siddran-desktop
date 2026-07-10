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
          <ellipse className={styles.glow} cx="120" cy="96" rx="70" ry="22" fill="url(#siddran-bag-glow)" />

          {/* carry handle */}
          <path className={styles.handle} d="M90 96 C90 60 150 60 150 96"
            fill="none" stroke="#f0b840" strokeWidth="5" strokeLinecap="round" opacity="0.85" />

          {/* bag body */}
          <rect x="34" y="92" width="172" height="118" rx="26"
            fill="url(#siddran-bag-body)" stroke="#f0b840" strokeWidth="2.5" strokeOpacity="0.55" />

          {/* the opening "mouth" that splits along the zipper */}
          <g className={styles.mouth}>
            <path className={styles.lip} d="M40 100 Q120 84 200 100"
              fill="none" stroke="#f0b840" strokeWidth="3" strokeLinecap="round" />
          </g>

          {/* zipper teeth + sliding pull */}
          <path d="M40 100 Q120 84 200 100" fill="none" stroke="#f0b840" strokeWidth="4"
            strokeLinecap="round" strokeDasharray="2 6" opacity="0.9" />
          <g className={styles.pull}>
            <circle cx="0" cy="0" r="7" fill="#15101c" stroke="#f0b840" strokeWidth="2.5" />
            <rect x="-2.5" y="6" width="5" height="12" rx="2.5" fill="#f0b840" />
          </g>

          {/* four-point sparkle (the Siddran mark) rising out of the open bag */}
          <path className={styles.spark}
            d="M120 84 L124 96 L136 100 L124 104 L120 116 L116 104 L104 100 L116 96 Z"
            fill="#ffe9b0" />
        </svg>
      </div>
    </div>
  )
}
