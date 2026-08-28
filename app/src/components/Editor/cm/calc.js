import { Decoration, ViewPlugin, WidgetType, keymap } from '@codemirror/view'
import { Prec } from '@codemirror/state'

// Inline calculation. Type an arithmetic expression, end the line with `=`, and
// the result appears as GHOST TEXT after the caret — greyed, not in the document
// — accepted with Tab or Right arrow and dismissed by simply typing on.
//
// Ghost text rather than the completion popup: a calculation has exactly one
// answer, so a list to choose from is the wrong shape, and a popup covers the
// lines below the sum you are checking it against. It is also never inserted on
// its own, which is the part that matters — a note is the user's text, and an
// editor that silently rewrites it while they type is a worse editor.
//
// Deliberately NOT a completion source: this used to be one, and sharing
// `autocompletion({ override })` with the wikilink source meant the two had to be
// assembled in one place or one would silently disable the other. A decoration
// has no such coupling.
//
// The evaluator is a hand-written shunting-yard parser, not `eval`/`new Function`.
// Note bodies are arbitrary text and a note can arrive from a synced or
// hand-edited file, so nothing in a note is ever handed to the JS engine.
//
// Deliberately NOT supported in this first pass: variables, units, percentages
// (`%` reads as "percent" in a budget and as "modulo" in code — guessing wrong is
// worse than not offering), and thousands separators (`1,000` is ambiguous
// against a list). Each is additive later if it turns out to be wanted.

// ── tokenizer ────────────────────────────────────────────────────────────────

const OPS = {
  '+': { prec: 1, assoc: 'left', apply: (a, b) => a + b },
  '-': { prec: 1, assoc: 'left', apply: (a, b) => a - b },
  '*': { prec: 2, assoc: 'left', apply: (a, b) => a * b },
  '/': { prec: 2, assoc: 'left', apply: (a, b) => a / b },
  '^': { prec: 3, assoc: 'right', apply: (a, b) => a ** b },
}

// `×` and `÷` are accepted because they are what a person writing a budget by
// hand actually types, and `−` because some keyboards and pasted text use a real
// minus sign rather than a hyphen.
const ALIASES = { '×': '*', 'x': '*', '·': '*', '÷': '/', '−': '-', '–': '-' }

function tokenize(src) {
  const out = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === ' ' || ch === '\t') { i++; continue }

    if (ch >= '0' && ch <= '9') {
      let j = i
      while (j < src.length && src[j] >= '0' && src[j] <= '9') j++
      if (src[j] === '.') {
        j++
        // A trailing dot with no digits after it ("5.") is not a number we want
        // to guess at — bail rather than silently reading it as 5.
        if (!(src[j] >= '0' && src[j] <= '9')) return null
        while (j < src.length && src[j] >= '0' && src[j] <= '9') j++
      }
      out.push({ t: 'num', v: Number(src.slice(i, j)) })
      i = j
      continue
    }

    // A bare leading '.' as in ".5" — common enough to accept.
    if (ch === '.') {
      let j = i + 1
      if (!(src[j] >= '0' && src[j] <= '9')) return null
      while (j < src.length && src[j] >= '0' && src[j] <= '9') j++
      out.push({ t: 'num', v: Number(src.slice(i, j)) })
      i = j
      continue
    }

    if (ch === '(' || ch === ')') { out.push({ t: ch }); i++; continue }

    const op = ALIASES[ch] || ch
    if (OPS[op]) { out.push({ t: 'op', v: op }); i++; continue }

    return null // anything else and this is prose, not a sum
  }
  return out
}

// ── parse (shunting-yard) + evaluate ─────────────────────────────────────────

// Returns { value, ops } or null. `ops` counts binary operators, so the caller
// can decline to "calculate" a lone number — `42 =` needs no help.
export function evaluateExpression(src) {
  const tokens = tokenize(String(src ?? ''))
  if (!tokens || tokens.length === 0) return null

  const values = []
  const ops = []
  let binaryOps = 0
  // Tracks whether the next token sits where a VALUE is expected. That is how a
  // unary minus is told from a subtraction: `-5 + 2` and `3 * -2` both start a
  // value, `5 - 2` does not.
  let expectValue = true

  const applyTop = () => {
    const op = ops.pop()
    if (!op || op.t === '(') return false
    if (op.unary) {
      if (values.length < 1) return false
      values.push(-values.pop())
      return true
    }
    if (values.length < 2) return false
    const b = values.pop()
    const a = values.pop()
    values.push(OPS[op.v].apply(a, b))
    return true
  }

  for (const tok of tokens) {
    if (tok.t === 'num') {
      if (!expectValue) return null   // two numbers in a row: "10 20" is not a sum
      values.push(tok.v)
      expectValue = false
      continue
    }
    if (tok.t === '(') {
      if (!expectValue) return null   // "2(3)" — implicit multiplication is a guess
      ops.push({ t: '(' })
      expectValue = true
      continue
    }
    if (tok.t === ')') {
      if (expectValue) return null    // "(2 +)" or "()"
      let found = false
      while (ops.length) {
        if (ops[ops.length - 1].t === '(') { ops.pop(); found = true; break }
        if (!applyTop()) return null
      }
      if (!found) return null         // unbalanced
      expectValue = false
      continue
    }

    // operator
    if (expectValue) {
      if (tok.v !== '-' && tok.v !== '+') return null  // only +/- can be unary
      // Unary plus is a no-op; drop it rather than carrying a special case.
      if (tok.v === '-') ops.push({ t: 'op', v: '-', unary: true, prec: 4, assoc: 'right' })
      continue
    }
    const info = OPS[tok.v]
    while (ops.length) {
      const top = ops[ops.length - 1]
      if (top.t === '(') break
      const topPrec = top.unary ? top.prec : OPS[top.v].prec
      if (topPrec > info.prec || (topPrec === info.prec && info.assoc === 'left')) {
        if (!applyTop()) return null
      } else break
    }
    ops.push({ t: 'op', v: tok.v })
    binaryOps++
    expectValue = true
  }

  if (expectValue) return null        // trailing operator: "10 + 12 +"
  while (ops.length) {
    if (ops[ops.length - 1].t === '(') return null  // unbalanced
    if (!applyTop()) return null
  }
  if (values.length !== 1) return null

  const value = values[0]
  if (!Number.isFinite(value)) return null   // /0, or an overflow to Infinity
  return { value, ops: binaryOps }
}

// Binary floating point is not what someone adding up a budget means: the literal
// sum of 10 + 12 + 93 + 100.11 is 215.10999999999999, and offering that as the
// answer would read as a bug. Round off the representation error, then drop the
// trailing zeros it leaves behind.
export function formatResult(value) {
  if (!Number.isFinite(value)) return null
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value)
  // 10 significant decimals is far past anything a note needs and comfortably
  // inside a double's ~15-17 digits, so it only ever removes error.
  const rounded = Number.parseFloat(value.toPrecision(12))
  if (!Number.isFinite(rounded)) return null
  if (Number.isInteger(rounded) && Math.abs(rounded) < 1e15) return String(rounded)
  return String(rounded)
}

// The text before the caret that we are willing to read as a sum: an expression
// then `=`, optionally followed by spaces. Anchored so a match must reach the
// caret. Kept here rather than inline so the test can exercise the same pattern
// the editor uses.
export const CALC_LINE = /[\d.(][\d\s.,+\-*/^()×÷x·−–]*=[ \t]*$/

// Given the whole line up to the caret, return the suggestion or null.
export function calcSuggestion(textBeforeCaret) {
  const m = CALC_LINE.exec(textBeforeCaret || '')
  if (!m) return null
  const matched = m[0]
  const expr = matched.slice(0, matched.indexOf('='))
  const result = evaluateExpression(expr)
  if (!result) return null
  // A lone number is not a calculation; suggesting "5" for "5 =" is noise.
  if (result.ops === 0) return null
  const text = formatResult(result.value)
  if (text == null) return null
  return { text, from: matched.length }
}

// ── CodeMirror extension: ghost text + accept ────────────────────────────────

// The suggestion for the current caret position, or null. Pure over the state,
// so the decoration and the accept command cannot disagree about what is showing.
function suggestionAt(state) {
  const sel = state.selection.main
  if (!sel.empty) return null
  const line = state.doc.lineAt(sel.head)
  // Only at the end of a line. Mid-line, ghost text would push the rest of the
  // line sideways as you type, which reads as the note rearranging itself.
  if (sel.head !== line.to) return null
  const before = line.text.slice(0, sel.head - line.from)
  const suggestion = calcSuggestion(before)
  if (!suggestion) return null
  // Keep one space between `=` and the answer unless the user already left one.
  const gap = /[ \t]$/.test(before) ? '' : ' '
  return { insert: gap + suggestion.text, pos: sel.head }
}

class GhostWidget extends WidgetType {
  constructor(text) { super(); this.text = text }
  eq(other) { return other.text === this.text }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-calc-ghost'
    span.textContent = this.text
    // Not part of the document: keep it out of the accessibility tree and out of
    // anything that reads the editor's text content.
    span.setAttribute('aria-hidden', 'true')
    return span
  }
  // The widget is decoration, not content — never let a click inside it become a
  // document position.
  ignoreEvent() { return true }
}

function ghostDecorations(state) {
  const s = suggestionAt(state)
  if (!s) return Decoration.none
  return Decoration.set([
    // side: 1 keeps the widget AFTER the caret, so the caret stays visible at the
    // end of what the user actually typed.
    Decoration.widget({ widget: new GhostWidget(s.insert), side: 1 }).range(s.pos),
  ])
}

const ghostPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = ghostDecorations(view.state) }
  update(update) {
    if (update.docChanged || update.selectionSet || update.focusChanged) {
      this.decorations = ghostDecorations(update.state)
    }
  }
}, { decorations: v => v.decorations })

// Accept. Returns false when nothing is showing so the key falls through to what
// it normally does — Tab keeps indenting and moving between table cells, and
// Right arrow keeps moving the caret.
export function acceptCalcSuggestion(view) {
  const s = suggestionAt(view.state)
  if (!s) return false
  view.dispatch({
    changes: { from: s.pos, insert: s.insert },
    selection: { anchor: s.pos + s.insert.length },
    userEvent: 'input.complete',
    scrollIntoView: true,
  })
  return true
}

export const calcGhostText = [
  ghostPlugin,
  // Above the table and default keymaps so an accept wins, but only when there is
  // something to accept — see acceptCalcSuggestion.
  Prec.high(keymap.of([
    { key: 'Tab', run: acceptCalcSuggestion },
    { key: 'ArrowRight', run: acceptCalcSuggestion },
  ])),
]
