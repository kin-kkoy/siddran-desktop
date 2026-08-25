import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { scanHtml, wantsTrust, wantsFontNotice, wantsFetchWarning } from './htmlScan.js'

describe('scanHtml', () => {
  it('finds nothing in a plain self-contained page', () => {
    const s = scanHtml('<html><style>body{color:red}</style><p>hi</p></html>')
    expect(s.external).toEqual([])
    expect(s.usesStorage).toBe(false)
    expect(s.usesNetworkApi).toBe(false)
  })

  it('separates font hosts from everything else', () => {
    const s = scanHtml(`
      <link href="https://fonts.googleapis.com/css2?family=Inter">
      <script src="https://cdn.example.com/lib.js"></script>
      <img src="https://images.example.com/a.png">
    `)
    expect(s.fontHosts).toEqual(['fonts.googleapis.com'])
    expect(s.blockedHosts.sort()).toEqual(['cdn.example.com', 'images.example.com'])
  })

  it('dedupes repeated URLs', () => {
    const s = scanHtml('<img src="https://a.com/1.png"><img src="https://a.com/1.png">')
    expect(s.external).toHaveLength(1)
  })

  it('catches protocol-relative URLs in attributes but not bare // comments', () => {
    expect(scanHtml('<script src="//cdn.example.com/x.js">').blockedHosts).toEqual(['cdn.example.com'])
    expect(scanHtml('<script>// just a comment\nlet a = 1 // b</script>').external).toEqual([])
  })

  it('detects each storage API', () => {
    const s = scanHtml('localStorage.setItem("a",1); indexedDB.open("x"); sessionStorage.clear()')
    expect(s.usesStorage).toBe(true)
    expect(s.storageApis.sort()).toEqual(['indexedDB', 'localStorage', 'sessionStorage'])
  })

  it('detects runtime network APIs', () => {
    expect(scanHtml('fetch("./data.json")').usesNetworkApi).toBe(true)
    expect(scanHtml('new XMLHttpRequest()').usesNetworkApi).toBe(true)
    expect(scanHtml('new WebSocket("wss://x")').usesNetworkApi).toBe(true)
    expect(scanHtml('<p>no scripts here</p>').usesNetworkApi).toBe(false)
  })

  it('tolerates junk input', () => {
    expect(() => scanHtml(null)).not.toThrow()
    expect(() => scanHtml(undefined)).not.toThrow()
    expect(scanHtml(null).external).toEqual([])
  })
})

describe('prompt decisions', () => {
  const plain = scanHtml('<p>hi</p>')
  const storagey = scanHtml('localStorage.setItem("a",1)')
  const fonty = scanHtml('<link href="https://fonts.gstatic.com/x.woff2">')
  const fetchy = scanHtml('fetch("./data.json")')

  it('stays silent on a page that trips nothing', () => {
    expect(wantsTrust(plain)).toBe(false)
    expect(wantsFontNotice(plain, false)).toBe(false)
    expect(wantsFetchWarning(plain, false)).toBe(false)
  })

  it('offers trust only when the page wants to remember something', () => {
    expect(wantsTrust(storagey)).toBe(true)
    expect(wantsTrust(fonty)).toBe(false)
  })

  it('warns about fonts only while they are switched off', () => {
    expect(wantsFontNotice(fonty, false)).toBe(true)
    expect(wantsFontNotice(fonty, true)).toBe(false)
  })

  it('warns about fetch only while the page is untrusted (opaque origin)', () => {
    expect(wantsFetchWarning(fetchy, false)).toBe(true)
    expect(wantsFetchWarning(fetchy, true)).toBe(false)
  })
})

// The files this feature actually exists to open. Guards the "most pages open
// with no chrome" claim against regressions in the heuristics.
describe('against the real reference pages', () => {
  const cases = [
    ['../../../references/landscape-view-prototype.html', { trust: false, font: false }],
    ['../../../references/codebase-map.html', { trust: true, font: false }],
  ]
  for (const [rel, expected] of cases) {
    const path = new URL(rel, import.meta.url).pathname
    const run = existsSync(path) ? it : it.skip
    run(`${rel.split('/').pop()} → trust:${expected.trust} font:${expected.font}`, () => {
      const s = scanHtml(readFileSync(path, 'utf8'))
      expect(wantsTrust(s)).toBe(expected.trust)
      expect(wantsFontNotice(s, false)).toBe(expected.font)
    })
  }
})
