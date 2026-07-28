// Splash timing model — the knobs and the derivation of every element's
// delay+duration from them. Kept separate from SplashScreen.jsx so that component
// file only exports a component (React Fast Refresh requirement). All values in ms.

export const DEFAULT_TIMING = {
  bagIn: 450,       // bag drop-in / settle
  zipDelay: 150,    // wait before the zipper starts sliding
  zip: 550,         // zipper slide-across duration
  burstDelay: 620,  // wait before the sparkles fly out of the opened bag
  burst: 950,       // sparkle flight duration
}

export function totalDuration(t) { return t.burstDelay + t.burst }

// Derive every element's delay+duration (as CSS variables) from the knobs.
export function computeVars(t) {
  const clamp = (n) => Math.max(100, Math.round(n))
  const glowDelay = t.zipDelay + t.zip * 0.5
  const lipDelay = t.zipDelay + t.zip * 0.45
  const total = t.burstDelay + t.burst
  return {
    '--bagIn-delay': '0ms', '--bagIn-dur': `${clamp(t.bagIn)}ms`,
    '--handle-delay': `${clamp(t.bagIn * 0.4)}ms`, '--handle-dur': `${clamp(t.bagIn * 1.1)}ms`,
    '--zip-delay': `${clamp(t.zipDelay)}ms`, '--zip-dur': `${clamp(t.zip)}ms`,
    '--glow-delay': `${clamp(glowDelay)}ms`, '--glow-dur': `${clamp(total - glowDelay)}ms`,
    '--lip-delay': `${clamp(lipDelay)}ms`, '--lip-dur': `${clamp(t.burstDelay + 200 - lipDelay)}ms`,
    '--burst-delay': `${clamp(t.burstDelay)}ms`, '--burst-dur': `${clamp(t.burst)}ms`,
    // The overlay fades once the sparkles are mostly spent — no zoom into the bag.
    '--fade-delay': `${clamp(total - 300)}ms`, '--fade-dur': '460ms',
  }
}
