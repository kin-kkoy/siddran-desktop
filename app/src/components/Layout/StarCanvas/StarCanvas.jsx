import { useRef, useEffect, useSyncExternalStore } from 'react'
import { useLocation } from 'react-router-dom'
import { useSettings } from '../../../contexts/SettingsContext'
import { modalPresence } from '../../../utils/modalPresence'
import styles from './StarCanvas.module.css'

const TWO_PI = Math.PI * 2

const STAR_COLORS = [
  { color: [255, 210,  95], weight: 6  },
  { color: [255, 175,  80], weight: 4  },
  { color: [200, 150, 255], weight: 6  },
  { color: [150, 185, 255], weight: 7  },
  { color: [120, 225, 210], weight: 4  },
  { color: [255, 175, 195], weight: 3  },
  { color: [220, 215, 240], weight: 40 },
  { color: [200, 210, 255], weight: 20 },
  { color: [235, 230, 255], weight: 10 },
]

const COLOR_TABLE = STAR_COLORS.flatMap(({ color, weight }) =>
  Array(weight).fill(color)
)

function pickColor() {
  return COLOR_TABLE[Math.floor(Math.random() * COLOR_TABLE.length)]
}

// Label → angle map (canvas coords: y-down, so sin > 0 moves toward bottom)
export const DIRECTION_ANGLES = {
  '↑': Math.PI * 3 / 2,
  '↗': Math.PI * 7 / 4,
  '→': 0,
  '↘': Math.PI / 4,
  '↓': Math.PI / 2,
  '↙': Math.PI * 3 / 4,
  '←': Math.PI,
  '↖': Math.PI * 5 / 4,
}

function makeStar(radiusRange, radiusBase) {
  return {
    x:              Math.random(),
    y:              Math.random(),
    radius:         Math.random() * radiusRange + radiusBase,
    baseOpacity:    Math.random() * 0.45 + 0.15,
    range:          Math.random() * 0.12 + 0.04,
    phase:          Math.random() * Math.PI * 2,
    speed:          Math.random() * 0.6 + 0.2,
    driftMagnitude: Math.random() * 0.0025 + 0.0006,
    angleOffset:    (Math.random() - 0.5) * (Math.PI / 6),
    color:          pickColor(),
  }
}

function StarCanvas({ lessDistraction = false }) {
  const canvasRef = useRef(null)
  const { settings } = useSettings()
  const location = useLocation()
  // Note-page-specific gate: when on /notes/:id, also honor showStarsOnNotePage.
  // Acts as a gate on top of global showStars (both must be true).
  // Less-distraction mode (NotePage focus mode) forces stars off regardless.
  const onNotePage = /^\/notes\/[^/]+/.test(location.pathname)
  const notePageStarsAllowed = onNotePage ? settings.showStarsOnNotePage !== false : true
  // Sandbox editor occupies the whole viewport (and stars would be hidden
  // behind its dark surface anyway) — skip the rAF loop entirely on this route.
  const onSandboxEditor = /^\/sandboxes\/[^/]+/.test(location.pathname)
  const showStars   = settings.showStars !== false && notePageStarsAllowed && !lessDistraction && !onSandboxEditor
  const reduceStars = settings.reduceStars === true

  // Pause the animation while any modal is open — the stars are hidden behind the backdrop, and
  // the per-frame redraw otherwise competes for the main thread and makes the modal feel laggy.
  const anyModalOpen = useSyncExternalStore(modalPresence.subscribe, modalPresence.getCount, modalPresence.getCount) > 0
  const pausedByModalRef = useRef(false)
  useEffect(() => { pausedByModalRef.current = anyModalOpen }, [anyModalOpen])

  // Animation refs — no state needed; settings sync updates these directly
  const sizeRef         = useRef(settings.starSize         ?? 1.40)
  const driftSpeedRef   = useRef(settings.starDriftSpeed   ?? 3.90)
  const twinkleSpeedRef = useRef(settings.starTwinkleSpeed ?? 1.00)
  const twinkleDepthRef = useRef(settings.starTwinkleDepth ?? 1.65)
  const countRef        = useRef(settings.starCount        ?? 100)
  const directionRef    = useRef(DIRECTION_ANGLES[settings.starDirection ?? '↙'] ?? Math.PI * 3 / 4)
  const starsRef        = useRef([])
  const radiusRangeRef  = useRef(1.3)
  const radiusBaseRef   = useRef(0.4)

  // Keep refs in sync with settings so the canvas updates live while Settings is open
  useEffect(() => {
    sizeRef.current         = settings.starSize         ?? 1.40
    driftSpeedRef.current   = settings.starDriftSpeed   ?? 3.90
    twinkleSpeedRef.current = settings.starTwinkleSpeed ?? 1.00
    twinkleDepthRef.current = settings.starTwinkleDepth ?? 1.65
    countRef.current        = settings.starCount        ?? 100
    directionRef.current    = DIRECTION_ANGLES[settings.starDirection ?? '↙'] ?? Math.PI * 3 / 4
  }, [
    settings.starSize, settings.starDriftSpeed, settings.starTwinkleSpeed,
    settings.starTwinkleDepth, settings.starCount, settings.starDirection,
  ])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    if (!showStars) {
      const ctx = canvas.getContext('2d')
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      return
    }

    const ctx = canvas.getContext('2d')
    let animId

    const resize = () => {
      canvas.width  = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    const radiusRange = reduceStars ? 0.7 : 1.3
    const radiusBase  = reduceStars ? 0.2 : 0.4
    radiusRangeRef.current = radiusRange
    radiusBaseRef.current  = radiusBase

    starsRef.current = Array.from({ length: countRef.current }, () =>
      makeStar(radiusRange, radiusBase)
    )

    let paused   = false
    let lastTime = 0
    const onVisibility = () => { paused = document.hidden }
    document.addEventListener('visibilitychange', onVisibility)

    // Freeze the redraw while the user is actively scrolling — repainting a
    // full-viewport canvas every frame competes with the browser's scroll
    // compositing and can cause jank. Resume ~150ms after the last scroll event.
    // Capture phase so it catches scrolls from inner scrollers (note body, CM6)
    // too, since scroll events don't bubble.
    let scrolling = false
    let scrollTimer
    const onScroll = () => {
      scrolling = true
      clearTimeout(scrollTimer)
      scrollTimer = setTimeout(() => { scrolling = false }, 150)
    }
    window.addEventListener('scroll', onScroll, true)

    const draw = (time) => {
      animId = requestAnimationFrame(draw)
      if (paused || pausedByModalRef.current || scrolling) {
        lastTime = time // keep the clock fresh so drift doesn't lurch on resume
        return
      }

      const dt = lastTime ? (time - lastTime) / 1000 : 0
      lastTime = time

      const target = countRef.current
      while (starsRef.current.length < target)
        starsRef.current.push(makeStar(radiusRangeRef.current, radiusBaseRef.current))
      while (starsRef.current.length > target)
        starsRef.current.pop()

      const sz  = sizeRef.current
      const ds  = driftSpeedRef.current
      const ts  = twinkleSpeedRef.current
      const td  = twinkleDepthRef.current
      const dir = directionRef.current

      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const t = time / 1000

      for (const star of starsRef.current) {
        const angle = dir + star.angleOffset
        star.x += Math.cos(angle) * star.driftMagnitude * ds * dt
        star.y += Math.sin(angle) * star.driftMagnitude * ds * dt
        if (star.x < 0) star.x += 1
        if (star.x > 1) star.x -= 1
        if (star.y < 0) star.y += 1
        if (star.y > 1) star.y -= 1

        const opacity = star.baseOpacity + Math.sin(t * star.speed * ts + star.phase) * star.range * td
        const [r, g, b] = star.color
        ctx.beginPath()
        ctx.arc(
          star.x * canvas.width,
          star.y * canvas.height,
          star.radius * sz,
          0,
          TWO_PI
        )
        ctx.fillStyle = `rgba(${r},${g},${b},${Math.max(0, Math.min(1, opacity))})`
        ctx.fill()
      }
    }

    animId = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('scroll', onScroll, true)
      clearTimeout(scrollTimer)
    }
  }, [showStars, reduceStars])

  return <canvas ref={canvasRef} className={styles.canvas} />
}

export default StarCanvas
