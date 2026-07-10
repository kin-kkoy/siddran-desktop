// Splash timing model — the five knobs and the derivation of every element's
// delay+duration from them. Kept separate from SplashScreen.jsx so that component
// file only exports a component (React Fast Refresh requirement). All values in ms.

export const DEFAULT_TIMING = {
  bagIn: 450,      // bag drop-in / settle
  zipDelay: 150,   // wait before the zipper starts sliding
  zip: 550,        // zipper slide-across duration
  diveDelay: 800,  // wait before the camera dives in
  dive: 500,       // dive (zoom-into-bag) duration
}

export function totalDuration(t) { return t.diveDelay + t.dive }

// Derive every element's delay+duration (as CSS variables) from the five knobs.
export function computeVars(t) {
  const clamp = (n) => Math.max(100, Math.round(n))
  const glowDelay = t.zipDelay + t.zip * 0.45
  const lipDelay = t.zipDelay + t.zip * 0.4
  const sparkDelay = t.zipDelay + t.zip * 0.55
  const total = t.diveDelay + t.dive
  return {
    '--bagIn-delay': '0ms', '--bagIn-dur': `${clamp(t.bagIn)}ms`,
    '--handle-delay': `${clamp(t.bagIn * 0.4)}ms`, '--handle-dur': `${clamp(t.bagIn * 1.1)}ms`,
    '--zip-delay': `${clamp(t.zipDelay)}ms`, '--zip-dur': `${clamp(t.zip)}ms`,
    '--glow-delay': `${clamp(glowDelay)}ms`, '--glow-dur': `${clamp(total - glowDelay)}ms`,
    '--lip-delay': `${clamp(lipDelay)}ms`, '--lip-dur': `${clamp(t.diveDelay + t.dive * 0.3 - lipDelay)}ms`,
    '--spark-delay': `${clamp(sparkDelay)}ms`, '--spark-dur': `${clamp(t.diveDelay + t.dive * 0.5 - sparkDelay)}ms`,
    '--dive-delay': `${clamp(t.diveDelay)}ms`, '--dive-dur': `${clamp(t.dive)}ms`,
    '--fade-delay': `${clamp(t.diveDelay + t.dive * 0.55)}ms`, '--fade-dur': `${clamp(t.dive * 0.5 + 120)}ms`,
  }
}
