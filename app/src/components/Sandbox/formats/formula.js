/**
 * Formula columns (spec §13.4.5, kept to arithmetic by the user's choice):
 * each row computes one number from its own fields.
 *
 *   {Price} * {Qty}        3/4 + 0.25        ({A} + {B}) / 2
 *   {Side}^2   {Side}²   {Side}³   √{Area}   sqrt({Area})   cbrt(27)
 *   round({Score} / 3, 2)  abs(x)  floor(x)  ceil(x)  min(a, b, …)  max(…)  pi
 *   50%  (= 0.5)           × ÷ − are the same as * / -
 *
 * A field is referenced by its name in braces. The expression is stored as
 * that text (`field.expr`), so it reads well in the board file and to the
 * CLI; renaming a field rewrites the references (fields.js updateField).
 *
 * Never `eval`: a small tokenizer and a precedence-climbing parser build a
 * tree, evaluated per record. An empty referenced value makes the result
 * empty (a Total with no Qty shows nothing, not 0). Errors are values the
 * cell shows ("#DIV/0", "#ERROR") — they never break the view.
 */
import { parseNumber, isEmptyValue } from './fields'

export class FormulaError extends Error {
    constructor(message, code = '#ERROR') { super(message); this.code = code }
}
const EMPTY = Symbol('empty')

// ---- tokens ----

const OPS = { '+': '+', '-': '-', '−': '-', '*': '*', '×': '*', '·': '*', '/': '/', '÷': '/', '^': '^', '%': '%', '(': '(', ')': ')', ',': ',', '√': '√', '²': '²', '³': '³' }

export function tokenize(src) {
    const out = []
    const s = String(src ?? '')
    let i = 0
    while (i < s.length) {
        const ch = s[i]
        if (/\s/.test(ch)) { i++; continue }
        if (/[0-9.]/.test(ch)) {
            const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i))
            if (!m) throw new FormulaError(`Can't read the number at “${s.slice(i, i + 6)}”`)
            out.push({ t: 'num', v: Number(m[0]) }); i += m[0].length; continue
        }
        if (ch === '{') {
            const j = s.indexOf('}', i + 1)
            if (j < 0) throw new FormulaError('A { has no closing }')
            out.push({ t: 'ref', v: s.slice(i + 1, j).trim() }); i = j + 1; continue
        }
        if (/[a-z_]/i.test(ch)) {
            const m = /^[a-z_][a-z0-9_]*/i.exec(s.slice(i))
            out.push({ t: 'id', v: m[0].toLowerCase() }); i += m[0].length; continue
        }
        if (OPS[ch]) { out.push({ t: 'op', v: OPS[ch] }); i++; continue }
        throw new FormulaError(`“${ch}” isn't something a formula understands`)
    }
    return out
}

// ---- parse: + - < * / < unary - √ < ^ (right) < postfix ² ³ % ----

const FUNCS = {
    sqrt: [1, 1, (x) => { if (x < 0) throw new FormulaError('Square root of a negative number'); return Math.sqrt(x) }],
    cbrt: [1, 1, Math.cbrt],
    abs: [1, 1, Math.abs],
    floor: [1, 1, Math.floor],
    ceil: [1, 1, Math.ceil],
    round: [1, 2, (x, n = 0) => { const k = 10 ** Math.max(0, Math.min(10, Math.round(n))); return Math.round(x * k) / k }],
    min: [1, Infinity, Math.min],
    max: [1, Infinity, Math.max],
    pow: [2, 2, Math.pow],
}
const CONSTS = { pi: Math.PI, e: Math.E }

export function parse(src) {
    const toks = tokenize(src)
    if (!toks.length) throw new FormulaError('Write a formula, e.g. {Price} * {Qty}')
    let p = 0
    const peek = () => toks[p]
    const isOp = (v) => peek()?.t === 'op' && peek().v === v
    const expect = (v) => { if (!isOp(v)) throw new FormulaError(`Expected “${v}”`); p++ }

    const expr = () => {
        let left = term()
        while (isOp('+') || isOp('-')) { const op = toks[p++].v; left = { k: 'bin', op, a: left, b: term() } }
        return left
    }
    const term = () => {
        let left = unary()
        while (isOp('*') || isOp('/')) { const op = toks[p++].v; left = { k: 'bin', op, a: left, b: unary() } }
        return left
    }
    const unary = () => {
        if (isOp('-')) { p++; return { k: 'neg', a: unary() } }
        if (isOp('+')) { p++; return unary() }
        if (isOp('√')) { p++; return { k: 'call', f: 'sqrt', args: [unary()] } }
        return power()
    }
    const power = () => {
        const base = postfix()
        if (isOp('^')) { p++; return { k: 'bin', op: '^', a: base, b: unary() } }   // right-assoc; 2^-1 works
        return base
    }
    const postfix = () => {
        let n = primary()
        for (;;) {
            if (isOp('²')) { p++; n = { k: 'bin', op: '^', a: n, b: { k: 'num', v: 2 } } }
            else if (isOp('³')) { p++; n = { k: 'bin', op: '^', a: n, b: { k: 'num', v: 3 } } }
            else if (isOp('%')) { p++; n = { k: 'bin', op: '/', a: n, b: { k: 'num', v: 100 } } }
            else return n
        }
    }
    const primary = () => {
        const tk = toks[p++]
        if (!tk) throw new FormulaError('The formula ends too soon')
        if (tk.t === 'num') return { k: 'num', v: tk.v }
        if (tk.t === 'ref') {
            if (!tk.v) throw new FormulaError('Empty {} — put a field name inside')
            return { k: 'ref', name: tk.v }
        }
        if (tk.t === 'id') {
            if (tk.v in CONSTS && !isOp('(')) return { k: 'num', v: CONSTS[tk.v] }
            const fn = FUNCS[tk.v]
            if (!fn) throw new FormulaError(`Unknown function “${tk.v}” — fields go in braces: {${tk.v}}`)
            expect('(')
            const args = []
            if (!isOp(')')) { args.push(expr()); while (isOp(',')) { p++; args.push(expr()) } }
            expect(')')
            if (args.length < fn[0] || args.length > fn[1]) throw new FormulaError(`${tk.v}() takes ${fn[0] === fn[1] ? fn[0] : `${fn[0]}–${fn[1] === Infinity ? 'many' : fn[1]}`} value${fn[1] === 1 ? '' : 's'}`)
            return { k: 'call', f: tk.v, args }
        }
        if (tk.t === 'op' && tk.v === '(') { const e = expr(); expect(')'); return e }
        throw new FormulaError(`Unexpected “${tk.v}”`)
    }
    const tree = expr()
    if (p < toks.length) throw new FormulaError(`Unexpected “${toks[p].v}”`)
    return tree
}

/** Field names a formula refers to (as written). */
export function refsOf(tree, out = new Set()) {
    if (!tree) return out
    if (tree.k === 'ref') out.add(tree.name)
    for (const c of [tree.a, tree.b, ...(tree.args || [])]) if (c) refsOf(c, out)
    return out
}

function run(tree, lookup) {
    switch (tree.k) {
        case 'num': return tree.v
        case 'ref': return lookup(tree.name)
        case 'neg': return -run(tree.a, lookup)
        case 'call': return FUNCS[tree.f][2](...tree.args.map(a => run(a, lookup)))
        default: {
            const a = run(tree.a, lookup), b = run(tree.b, lookup)
            switch (tree.op) {
                case '+': return a + b
                case '-': return a - b
                case '*': return a * b
                case '/': if (b === 0) throw new FormulaError('Divided by zero', '#DIV/0'); return a / b
                case '^': return a ** b
                default: throw new FormulaError(`Unknown operator ${tree.op}`)
            }
        }
    }
}

/** Check a formula against the fields it may use: '' if fine, else what's wrong. */
export function checkFormula(expr, fields, selfId) {
    try {
        const tree = parse(expr)
        const byName = new Map(fields.map(f => [f.name.toLowerCase(), f]))
        for (const n of refsOf(tree)) {
            const f = byName.get(n.toLowerCase())
            if (!f) return `No field named “${n}”`
            if (f.id === selfId) return 'A formula can’t use its own column'
        }
        return ''
    } catch (e) { return e.message }
}

/**
 * Records with every formula column computed: { records, errors } where a
 * record's computed values are in `values` like any other, and `errors` maps
 * record id → { [fieldId]: { code, message } }. Records come back as they
 * were when there are no formula columns.
 */
export function computeFormulas(fields, records) {
    const formulas = fields.filter(f => f.type === 'formula')
    if (!formulas.length) return { records, errors: new Map() }
    const byName = new Map(fields.map(f => [f.name.toLowerCase(), f]))
    const trees = new Map()
    for (const f of formulas) {
        try { trees.set(f.id, { tree: parse(f.expr || '') }) } catch (e) { trees.set(f.id, { err: e }) }
    }
    const errors = new Map()
    const out = records.map(rec => {
        const memo = new Map(), stack = new Set()
        const valueOf = (f) => {
            if (f.type !== 'formula') {
                const v = rec.values?.[f.id]
                if (isEmptyValue(v)) return f.type === 'check' ? 0 : EMPTY
                if (typeof v === 'number') return v
                if (typeof v === 'boolean') return v ? 1 : 0
                const n = parseNumber(Array.isArray(v) ? v[0] : v)
                if (n === undefined) throw new FormulaError(`“${f.name}” isn't a number here`, '#VALUE')
                return n
            }
            if (memo.has(f.id)) return memo.get(f.id)
            if (stack.has(f.id)) throw new FormulaError(`“${f.name}” uses itself (through another formula)`, '#CYCLE')
            const t = trees.get(f.id)
            if (t.err) throw t.err
            stack.add(f.id)
            let v
            try {
                v = run(t.tree, (name) => {
                    const g = byName.get(name.toLowerCase())
                    if (!g) throw new FormulaError(`No field named “${name}”`, '#NAME')
                    const x = valueOf(g)
                    if (x === EMPTY) throw EMPTY
                    return x
                })
            } catch (e) {
                if (e === EMPTY) v = EMPTY; else { stack.delete(f.id); throw e }
            }
            stack.delete(f.id)
            if (v !== EMPTY && !Number.isFinite(v)) throw new FormulaError('The result isn’t a finite number')
            memo.set(f.id, v)
            return v
        }
        const values = { ...rec.values }
        let errs = null
        for (const f of formulas) {
            try {
                const v = valueOf(f)
                if (v === EMPTY) delete values[f.id]; else values[f.id] = Math.round(v * 1e12) / 1e12   // 0.1+0.2 shows 0.3
            } catch (e) {
                delete values[f.id]
                ;(errs ||= {})[f.id] = { code: e.code || '#ERROR', message: e.message }
            }
        }
        if (errs) errors.set(rec.id, errs)
        return errs ? { ...rec, values, errors: errs } : { ...rec, values }
    })
    return { records: out, errors }
}

/** Rewrite references to a renamed field in a formula's text. */
export function renameRefs(expr, from, to) {
    if (!expr || !from) return expr
    const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return expr.replace(new RegExp(`\\{\\s*${esc}\\s*\\}`, 'gi'), `{${to}}`)
}
