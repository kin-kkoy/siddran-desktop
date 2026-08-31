// The noise an alarm makes.
//
// Two HTMLAudioElements rather than a WebAudio synth, deliberately:
// `audio.loop = true` is looped by the media pipeline, not by a JS timer. The
// whole requirement is "does not stop until dismissed", and that must not be
// JavaScript's job — a hidden, throttled page would stall a setTimeout-driven
// loop. An AudioContext also starts suspended on WebKit without a gesture.
//
// WebKitGTK gates programmatic play() behind a user gesture, and an alarm firing
// on a timer has none. `primeOnFirstGesture()` spends the session's first click
// on a silent play so later ones are allowed. The two elements are reused for
// every tone — only `src` changes — because the unlock belongs to the element,
// and a fresh Audio() per tone would be locked all over again.

// Each tone is normalised to the same peak and then scaled by its own gain, so
// "gentle" is genuinely quieter than "classic" at the same volume setting rather
// than merely different. Keys are the stored setting values.
export const ALARM_TONES = [
  { value: 'gentle', label: 'Gentle', file: '/sounds/alarm-gentle.ogg' },
  { value: 'bells', label: 'Bells', file: '/sounds/alarm-bells.ogg' },
  { value: 'pulse', label: 'Pulse', file: '/sounds/alarm-pulse.ogg' },
  { value: 'classic', label: 'Classic', file: '/sounds/alarm-classic.ogg' },
]

export const REMINDER_TONES = [
  { value: 'soft', label: 'Soft', file: '/sounds/chime-soft.ogg' },
  { value: 'chime', label: 'Chime', file: '/sounds/chime-chime.ogg' },
  { value: 'ping', label: 'Ping', file: '/sounds/chime-ping.ogg' },
  { value: 'wood', label: 'Wood', file: '/sounds/chime-wood.ogg' },
]

const fileFor = (tones, key) => (tones.find((t) => t.value === key) || tones[0]).file

let alarmEl = null
let chimeEl = null
let primed = false
let previewTimer = 0

function element(loop) {
  if (typeof Audio === 'undefined') return null
  const a = new Audio()
  a.loop = loop
  a.preload = 'auto'
  return a
}

function alarmAudio() {
  if (!alarmEl) alarmEl = element(true)
  return alarmEl
}

function chimeAudio() {
  if (!chimeEl) chimeEl = element(false)
  return chimeEl
}

// Changing src mid-play restarts the media; only touch it when the tone differs.
function selectTone(el, file) {
  if (!el) return
  if (!el.src.endsWith(file)) el.src = file
}

// Spend the first real user gesture of the session unlocking both elements.
export function primeOnFirstGesture({ alarmTone, reminderTone } = {}) {
  if (typeof window === 'undefined' || primed) return () => {}
  const unlock = () => {
    primed = true
    const a = alarmAudio(); const c = chimeAudio()
    selectTone(a, fileFor(ALARM_TONES, alarmTone))
    selectTone(c, fileFor(REMINDER_TONES, reminderTone))
    for (const el of [a, c]) {
      if (!el) continue
      el.muted = true
      Promise.resolve(el.play())
        .then(() => { el.pause(); el.currentTime = 0; el.muted = false })
        .catch(() => { el.muted = false })
    }
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
  }
  window.addEventListener('pointerdown', unlock)
  window.addEventListener('keydown', unlock)
  return () => {
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
  }
}

const clamp = (v) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0.7))

export function playChime(volume = 0.7, tone) {
  const a = chimeAudio()
  if (!a) return
  selectTone(a, fileFor(REMINDER_TONES, tone))
  a.volume = clamp(volume)
  a.currentTime = 0
  Promise.resolve(a.play()).catch(() => { /* silence is survivable */ })
}

export function startAlarm(volume = 0.7, tone) {
  const a = alarmAudio()
  if (!a) return
  clearTimeout(previewTimer)
  selectTone(a, fileFor(ALARM_TONES, tone))
  a.loop = true
  a.volume = clamp(volume)
  a.currentTime = 0
  Promise.resolve(a.play()).catch(() => { /* the modal and the OS notification remain */ })
}

export function stopAlarm() {
  clearTimeout(previewTimer)
  if (!alarmEl) return
  try { alarmEl.pause(); alarmEl.currentTime = 0; alarmEl.loop = true } catch { /* already gone */ }
}

// One pass of an alarm tone for the Settings preview — the point is to hear what
// it sounds like, not to be shouted at, so it does not loop.
export function previewAlarm(tone, volume = 0.7) {
  const a = alarmAudio()
  if (!a) return
  clearTimeout(previewTimer)
  selectTone(a, fileFor(ALARM_TONES, tone))
  a.loop = false
  a.volume = clamp(volume)
  a.currentTime = 0
  Promise.resolve(a.play()).catch(() => { /* nothing to preview */ })
  // Restore the looping default even if the element is reused by a real alarm.
  previewTimer = setTimeout(() => { a.loop = true }, 5000)
}

export function setAlarmVolume(volume) {
  if (alarmEl) alarmEl.volume = clamp(volume)
}
