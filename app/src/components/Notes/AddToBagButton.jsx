import { useEffect, useRef } from 'react'
import { LuPackagePlus } from 'react-icons/lu'
import styles from '../../pages/Notes/NotePage.module.css'

const BEAT_EVERY_MS = 2800
const BEAT_RISE_MS = 300 // matches the .beat transition in NotePage.module.css

// "Add to Bag" on a file opened from the file manager (StagedNotesContext).
//
// The heartbeat glow is driven from here, not by a CSS `infinite` animation. An
// endless animation keeps WebKit producing a frame every vsync even through its
// flat part — measured at ~17% of a core on the headless output, against ~2%
// without it. A class flipped twice per beat only animates during the ~1.2s
// transition and leaves the window idle in between.
//
// It also stops while the window isn't focused (Siddran on the other monitor while
// you play something) and shows a steady soft glow instead, so the button is still
// easy to spot and costs nothing.
export default function AddToBagButton({ onClick, disabled, path }) {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    let interval = null
    let fall = null
    const beat = () => {
      el.classList.add(styles.beat)
      fall = setTimeout(() => el.classList.remove(styles.beat), BEAT_RISE_MS)
    }
    const start = () => {
      if (interval) return
      el.classList.remove(styles.resting)
      beat()
      interval = setInterval(beat, BEAT_EVERY_MS)
    }
    const stop = () => {
      clearInterval(interval); interval = null
      clearTimeout(fall)
      el.classList.remove(styles.beat)
      el.classList.add(styles.resting)
    }
    const sync = () => (document.hasFocus() && !document.hidden ? start() : stop())
    sync()
    window.addEventListener('focus', sync)
    window.addEventListener('blur', sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      stop()
      window.removeEventListener('focus', sync)
      window.removeEventListener('blur', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [])

  return (
    <button
      ref={ref}
      onClick={onClick}
      className={styles.addToBagBtn}
      disabled={disabled}
      title={`Not in your Bag yet — edits save to ${path}. Add a copy to the Bag; the original stays where it is.`}
    >
      <LuPackagePlus />
      Add to Bag
    </button>
  )
}
