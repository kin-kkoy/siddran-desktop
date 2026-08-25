import { describe, it, expect, beforeEach } from 'vitest'
import {
  readTrust, isTrusted, setTrusted, setDismissed, isDismissed,
  trustedPaths, forgetAllTrust, shouldPrompt, TRUST_PROMPT_MODES,
  allowedHosts, setAllowedHosts,
} from './htmlTrust.js'

const A = '/bags/A', B = '/bags/B'
const P = 'attachments/HTML Candidates/codebase-map.html'

beforeEach(() => {
  const store = new Map()
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
})

describe('trust storage', () => {
  it('records and reads trust per page', () => {
    expect(isTrusted(P, A)).toBe(false)
    setTrusted(P, true, A)
    expect(isTrusted(P, A)).toBe(true)
    expect(trustedPaths(A)).toEqual([P])
  })

  it('is scoped per Bag', () => {
    setTrusted(P, true, A)
    expect(isTrusted(P, B)).toBe(false)
  })

  it('untrusting removes the entry rather than storing false', () => {
    setTrusted(P, true, A)
    setTrusted(P, false, A)
    expect(isTrusted(P, A)).toBe(false)
    expect(trustedPaths(A)).toEqual([])
  })

  it('tracks dismissal separately from trust', () => {
    setDismissed(P, A)
    expect(isDismissed(P, A)).toBe(true)
    expect(isTrusted(P, A)).toBe(false)
  })

  // A reset that left dismissals behind would leave you silently opted out of
  // ever being asked again.
  it('forgetAll clears dismissals too', () => {
    setTrusted(P, true, A)
    setDismissed('other.html', A)
    forgetAllTrust(A)
    expect(trustedPaths(A)).toEqual([])
    expect(isDismissed('other.html', A)).toBe(false)
  })

  it('survives corrupt storage', () => {
    localStorage.setItem('siddran_html_trust:/bags/A', '{oops')
    expect(readTrust(A)).toEqual({ trusted: {}, dismissed: {}, hosts: {} })
    expect(isTrusted(P, A)).toBe(false)
  })

  it('ignores an empty path', () => {
    setTrusted('', true, A)
    expect(trustedPaths(A)).toEqual([])
    expect(isTrusted('', A)).toBe(false)
  })
})

describe('shouldPrompt', () => {
  const base = { mode: TRUST_PROMPT_MODES.ONCE, wantsFileAccess: true, trusted: false, dismissed: false }

  it('stays silent for a page that reads nothing', () => {
    expect(shouldPrompt({ ...base, wantsFileAccess: false })).toBe(false)
  })

  it('stays silent once the page is trusted', () => {
    expect(shouldPrompt({ ...base, trusted: true })).toBe(false)
    expect(shouldPrompt({ ...base, trusted: true, mode: TRUST_PROMPT_MODES.ALWAYS })).toBe(false)
  })

  it('never asks under "never"', () => {
    expect(shouldPrompt({ ...base, mode: TRUST_PROMPT_MODES.NEVER })).toBe(false)
    expect(shouldPrompt({ ...base, mode: TRUST_PROMPT_MODES.NEVER, dismissed: false })).toBe(false)
  })

  it('asks every time under "always", even after a dismissal', () => {
    expect(shouldPrompt({ ...base, mode: TRUST_PROMPT_MODES.ALWAYS })).toBe(true)
    expect(shouldPrompt({ ...base, mode: TRUST_PROMPT_MODES.ALWAYS, dismissed: true })).toBe(true)
  })

  it('asks once per page under "once"', () => {
    expect(shouldPrompt(base)).toBe(true)
    expect(shouldPrompt({ ...base, dismissed: true })).toBe(false)
  })
})


// The duplicate-key bug, and its self-migration.
describe('path spelling', () => {
  const RAW = 'attachments/Start Here/codebase-map.html'
  const ENC = 'attachments/Start%20Here/codebase-map.html'

  it('treats the encoded and raw spellings as one page', () => {
    setTrusted(ENC, true, A)
    expect(isTrusted(RAW, A)).toBe(true)
    expect(trustedPaths(A)).toHaveLength(1)
  })

  it('untrusting via one spelling clears the other', () => {
    setTrusted(RAW, true, A)
    setTrusted(ENC, false, A)
    expect(isTrusted(RAW, A)).toBe(false)
  })

  it('dismissal matches across spellings too', () => {
    setDismissed(ENC, A)
    expect(isDismissed(RAW, A)).toBe(true)
  })

  it('merges duplicate entries already on disk', () => {
    localStorage.setItem('siddran_html_trust:/bags/A', JSON.stringify({
      trusted: { [RAW]: true, [ENC]: true },
      dismissed: {},
    }))
    expect(trustedPaths(A)).toEqual([RAW])
  })
})


describe('per-page external hosts', () => {
  const P2 = 'attachments/_bundles/ab12/page.html'

  it('remembers approved hosts per page', () => {
    setAllowedHosts(P2, ['cdn.example.com', 'img.example.com'], A)
    expect(allowedHosts(P2, A)).toEqual(['cdn.example.com', 'img.example.com'])
    expect(allowedHosts('other.html', A)).toEqual([])
  })

  it('matches across path spellings, like trust does', () => {
    setAllowedHosts('attachments/Start%20Here/a.html', ['cdn.example.com'], A)
    expect(allowedHosts('attachments/Start Here/a.html', A)).toEqual(['cdn.example.com'])
  })

  it('dedupes and clears', () => {
    setAllowedHosts(P2, ['a.com', 'a.com', 'b.com'], A)
    expect(allowedHosts(P2, A)).toEqual(['a.com', 'b.com'])
    setAllowedHosts(P2, [], A)
    expect(allowedHosts(P2, A)).toEqual([])
  })

  it('is cleared by Forget all, alongside trust', () => {
    setAllowedHosts(P2, ['a.com'], A)
    forgetAllTrust(A)
    expect(allowedHosts(P2, A)).toEqual([])
  })
})
