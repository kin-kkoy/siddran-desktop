import { describe, it, expect } from 'vitest'
import { evaluateExpression, formatResult, calcSuggestion } from './calc'

const val = (src) => evaluateExpression(src)?.value

describe('evaluateExpression', () => {
  it('adds a run of numbers', () => {
    expect(val('10 + 12 + 93 + 100.11')).toBeCloseTo(215.11, 10)
  })

  it('honours precedence and parentheses', () => {
    expect(val('2 + 3 * 4')).toBe(14)
    expect(val('(2 + 3) * 4')).toBe(20)
    expect(val('2 * (3 + 4) - 5')).toBe(9)
  })

  it('is right-associative for exponentiation', () => {
    expect(val('2 ^ 3 ^ 2')).toBe(512)   // 2^(3^2), not (2^3)^2
  })

  it('handles unary minus, including after an operator', () => {
    expect(val('-5 + 2')).toBe(-3)
    expect(val('3 * -2')).toBe(-6)
    expect(val('-(2 + 3)')).toBe(-5)
    expect(val('10 - -5')).toBe(15)
  })

  it('accepts the symbols people actually type', () => {
    expect(val('6 × 7')).toBe(42)
    expect(val('84 ÷ 2')).toBe(42)
    expect(val('6 x 7')).toBe(42)
    expect(val('10 − 4')).toBe(6)
  })

  it('accepts a leading decimal point', () => {
    expect(val('.5 + .25')).toBe(0.75)
  })

  it('counts binary operators so a lone number can be declined', () => {
    expect(evaluateExpression('42')).toEqual({ value: 42, ops: 0 })
    expect(evaluateExpression('40 + 2').ops).toBe(1)
  })

  it('refuses prose and malformed sums', () => {
    expect(evaluateExpression('items and things')).toBeNull()
    expect(evaluateExpression('10 20')).toBeNull()       // two numbers, no operator
    expect(evaluateExpression('10 +')).toBeNull()        // trailing operator
    expect(evaluateExpression('(2 + 3')).toBeNull()      // unbalanced
    expect(evaluateExpression('2 + 3)')).toBeNull()
    expect(evaluateExpression('()')).toBeNull()
    expect(evaluateExpression('2(3)')).toBeNull()        // implicit multiplication is a guess
    expect(evaluateExpression('5.')).toBeNull()          // trailing dot
    expect(evaluateExpression('')).toBeNull()
  })

  it('refuses a result that is not finite', () => {
    expect(evaluateExpression('1 / 0')).toBeNull()
  })
})

describe('formatResult', () => {
  it('removes binary floating point error', () => {
    // The literal sum is 215.10999999999999; offering that would read as a bug.
    expect(formatResult(10 + 12 + 93 + 100.11)).toBe('215.11')
    expect(formatResult(0.1 + 0.2)).toBe('0.3')
  })

  it('leaves integers alone', () => {
    expect(formatResult(42)).toBe('42')
    expect(formatResult(-7)).toBe('-7')
  })

  it('keeps genuine decimals', () => {
    expect(formatResult(1 / 8)).toBe('0.125')
    expect(formatResult(2 / 3)).toBe('0.666666666667')
  })
})

describe('calcSuggestion', () => {
  it('suggests once the line ends in =', () => {
    expect(calcSuggestion('10 + 12 + 93 + 100.11 =').text).toBe('215.11')
    expect(calcSuggestion('10 + 12 =').text).toBe('22')
  })

  it('tolerates trailing space after the =', () => {
    expect(calcSuggestion('2 + 2 =  ').text).toBe('4')
  })

  it('reads only the sum at the end of a line of prose', () => {
    expect(calcSuggestion('Lunch and coffee: 12.50 + 3.75 =').text).toBe('16.25')
  })

  it('stays quiet without an =', () => {
    expect(calcSuggestion('10 + 12')).toBeNull()
  })

  it('stays quiet for a lone number', () => {
    expect(calcSuggestion('42 =')).toBeNull()
  })

  it('stays quiet for prose that happens to end in =', () => {
    expect(calcSuggestion('const total =')).toBeNull()
    expect(calcSuggestion('=')).toBeNull()
  })

  it('does not fire once the result has been accepted', () => {
    // The line now ends in a number, not `=`, so there is nothing to offer and
    // the suggestion cannot loop on its own output.
    expect(calcSuggestion('10 + 12 = 22')).toBeNull()
  })
})
