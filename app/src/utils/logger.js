// Dev-only logger — suppresses all output in production builds
const isDev = import.meta.env.DEV

const logger = {
  error: (...args) => { if (isDev) console.error(...args) },
  warn:  (...args) => { if (isDev) console.warn(...args) },
  log:   (...args) => { if (isDev) console.log(...args) },
}

export default logger
