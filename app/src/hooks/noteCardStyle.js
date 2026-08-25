// Note cards are drawn as two sheets of paper: a neutral surface carrying the
// words and a coloured sheet underneath carrying the note's identity. How the
// two sit is five independent axes rather than a list of hand-written looks, so
// the combinations compose:
//
//   exposure   how much of the sheet underneath shows
//   anchor     which corner it shows at
//   tilt       which way the paper leans
//   turns      which of the two sheets is the one that leans
//   vary       whether each note gets its own angle
//
// This module owns only the resolution — settings in, class keys and angles out.
// The geometry lives in Card.module.css.

export const EXPOSURES = ['minimal', 'small', 'wide', 'tab']
export const ANCHORS = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
export const TILTS = ['none', 'left', 'right']
export const TURNS = ['top', 'under']
export const SURPRISE = ['off', 'tilt', 'all']

export const CARD_DEFAULTS = {
  exposure: 'minimal',
  anchor: 'bottom-left',
  tilt: 'left',
  turns: 'under',
}

// CSS-module class keys, kept here so Card.jsx never spells a class name.
const CLASS = {
  exposure: { minimal: 'xMin', small: 'xSm', wide: 'xWide', tab: 'xTab' },
  anchor: {
    'top-left': 'atTl', 'top-right': 'atTr',
    'bottom-left': 'atBl', 'bottom-right': 'atBr',
  },
  tilt: { none: 'leanNone', left: 'leanLeft', right: 'leanRight' },
  turns: { top: 'turnsTop', under: 'turnsUnder' },
}

// FNV-1a. Small, stable, and — unlike Math.random — gives the same note the same
// angle on every render, which is the whole point: a tilt that changed as you
// scrolled would flicker, and one that changed on reorder would look broken.
function hash32(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function newLaunchSeed() {
  return (Math.random() * 0xffffffff) >>> 0
}

// One seed per app launch. This module is imported once, so "launch" means what
// it says — not per navigation, and not per render.
export const LAUNCH_SEED = newLaunchSeed()

const oneOf = (list, value, fallback) => (list.includes(value) ? value : fallback)

// Settings → the four axes plus how to angle each note.
export function resolveCardStyle(settings = {}, seed = LAUNCH_SEED) {
  const style = {
    exposure: oneOf(EXPOSURES, settings.noteCardExposure, CARD_DEFAULTS.exposure),
    anchor: oneOf(ANCHORS, settings.noteCardAnchor, CARD_DEFAULTS.anchor),
    tilt: oneOf(TILTS, settings.noteCardTilt, CARD_DEFAULTS.tilt),
    turns: oneOf(TURNS, settings.noteCardTurns, CARD_DEFAULTS.turns),
  }

  // "Surprise me every launch". `tilt` re-rolls only how the paper leans, so the
  // grid feels freshly handled without re-laying itself out; `all` re-rolls the
  // geometry too, which moves the colour to a different corner and changes its
  // size — a visibly different design each launch.
  const surprise = oneOf(SURPRISE, settings.noteCardSurprise, 'off')
  const roll = (list, axis) => list[hash32(seed + ':' + axis) % list.length]
  if (surprise !== 'off') {
    style.tilt = roll(TILTS, 'tilt')
    style.turns = roll(TURNS, 'turns')
  }
  if (surprise === 'all') {
    style.exposure = roll(EXPOSURES, 'exposure')
    style.anchor = roll(ANCHORS, 'anchor')
  }

  // Either toggle means "give each note its own angle". They differ only in
  // whether that angle survives a restart.
  style.vary = settings.noteCardVary === true || settings.noteCardVaryEachLaunch === true
  style.salt = settings.noteCardVaryEachLaunch === true ? seed : 0
  return style
}

export function cardClassNames(style, styles) {
  return [
    styles[CLASS.exposure[style.exposure]],
    styles[CLASS.anchor[style.anchor]],
    styles[CLASS.tilt[style.tilt]],
    styles[CLASS.turns[style.turns]],
  ].filter(Boolean).join(' ')
}

const MIN_TILT = 0.5
const MAX_TILT = 1.9

// A note's own angle. The DIRECTION always follows the setting — picking "Left"
// and getting a card that leans right would read as a bug, not as variety — so
// only the amount varies, between 0.5° and 1.9°.
export function tiltFor(noteId, salt = 0, direction = 'left') {
  if (direction !== 'left' && direction !== 'right') return 0
  const h = hash32(String(noteId) + ':' + salt)
  const magnitude = MIN_TILT + ((h % 8) / 7) * (MAX_TILT - MIN_TILT)
  const signed = direction === 'left' ? -magnitude : magnitude
  return Math.round(signed * 100) / 100
}
