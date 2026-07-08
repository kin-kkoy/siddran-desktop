// Obsidian-style inline syntaxes as Lezer markdown nodes, mirroring the Wikilink
// node in cm/wikilinks.js. Decorations live in cm/livePreview.js.
//   Highlight  ==text==
//   Hashtag    #tag
//   Spoiler    ||text||
//   Underline  <u>text</u>  (on-disk HTML; read side uses utils/remarkUnderline)
// Char codes: 61 '=', 35 '#', 124 '|', 60 '<', 62 '>', 47 '/', 117 'u', 85 'U',
//             32 ' ', 9 tab, 10 newline.
// Space/tab/newline, or -1 (out of range) — not valid content right inside a delimiter.
const isSpaceCode = (c) => c === 32 || c === 9 || c === 10 || c === -1
export const obsidianSyntax = {
  defineNodes: [{ name: 'Highlight' }, { name: 'Hashtag' }, { name: 'Spoiler' }, { name: 'Underline' }],
  parseInline: [
    {
      // <u>…</u> raw HTML — claim it BEFORE the built-in HTMLTag inline parser so
      // the whole span becomes one Underline node we can live-preview, instead of
      // two separate HTMLTag nodes shown as literal tags. Matches what the reading
      // view renders via utils/remarkUnderline (case-insensitive <u>/<U>).
      name: 'Underline',
      before: 'HTMLTag',
      parse(cx, next, pos) {
        if (next !== 60) return -1 // '<'
        const u = cx.char(pos + 1)
        if ((u !== 117 && u !== 85) || cx.char(pos + 2) !== 62) return -1 // 'u'/'U' then '>'
        let e = pos + 3
        while (e < cx.end) {
          if (cx.char(e) === 60 && cx.char(e + 1) === 47) { // '</'
            const c = cx.char(e + 2)
            if ((c === 117 || c === 85) && cx.char(e + 3) === 62) break // 'u'/'U' then '>'
          }
          e++
        }
        if (e >= cx.end) return -1 // no closing </u>
        return cx.addElement(cx.elt('Underline', pos, e + 4))
      },
    },
    {
      name: 'Highlight',
      before: 'Emphasis',
      parse(cx, next, pos) {
        if (next !== 61 || cx.char(pos + 1) !== 61) return -1
        // Tight delimiters: a non-space must sit just inside each `==`, so prose
        // like `a == b == c` isn't mis-highlighted while `==text==` still is.
        if (isSpaceCode(cx.char(pos + 2))) return -1
        let e = pos + 2
        while (e < cx.end && !(cx.char(e) === 61 && cx.char(e + 1) === 61)) e++
        if (e >= cx.end || isSpaceCode(cx.char(e - 1))) return -1
        return cx.addElement(cx.elt('Highlight', pos, e + 2))
      },
    },
    {
      name: 'Spoiler',
      before: 'Emphasis',
      parse(cx, next, pos) {
        if (next !== 124 || cx.char(pos + 1) !== 124) return -1
        if (isSpaceCode(cx.char(pos + 2))) return -1 // tight delimiters (see Highlight)
        let e = pos + 2
        while (e < cx.end && !(cx.char(e) === 124 && cx.char(e + 1) === 124)) e++
        if (e >= cx.end || isSpaceCode(cx.char(e - 1))) return -1
        return cx.addElement(cx.elt('Spoiler', pos, e + 2))
      },
    },
    {
      name: 'Hashtag',
      before: 'Link',
      parse(cx, next, pos) {
        if (next !== 35) return -1
        // Must start a word (preceded by whitespace or line/block start) so `a#b`
        // and `#fff` mid-word / colour codes don't match. At the very start of an
        // inline block cx.char(pos-1) is out of range — it returns -1 OR NaN
        // (charCodeAt of a negative index), and both mean "line start", so allow them.
        const prev = cx.char(pos - 1)
        const atStart = prev === -1 || Number.isNaN(prev)
        if (!atStart && prev !== 32 && prev !== 9 && prev !== 10) return -1
        const letter = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
        if (!letter(cx.char(pos + 1))) return -1
        const word = (c) => (c >= 48 && c <= 57) || letter(c) || c === 95 || c === 45 || c === 47
        let e = pos + 1
        while (e < cx.end && word(cx.char(e))) e++
        return cx.addElement(cx.elt('Hashtag', pos, e))
      },
    },
  ],
}
