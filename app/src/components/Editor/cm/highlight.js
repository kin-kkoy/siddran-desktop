import { HighlightStyle } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

// Syntax-highlight style for fenced code inside the editor (paired with
// markdown({ codeLanguages }) so the embedded language is actually parsed).
// Colours are drawn from Cinder's CSS variables so it tracks the active theme;
// a couple of accents are literal to widen the palette for code.
export const cinderHighlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.modifier], color: 'var(--accent-blue)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--accent-success)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--accent-warning)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--text-muted)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], color: '#c084fc' },
  { tag: [t.typeName, t.className, t.namespace], color: '#7ec8e3' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--text-primary)' },
  { tag: [t.variableName, t.definition(t.variableName)], color: 'var(--text-primary)' },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket, t.brace, t.paren], color: 'var(--text-secondary)' },
  { tag: [t.tagName, t.angleBracket], color: 'var(--accent-blue)' },
  { tag: [t.escape, t.meta], color: 'var(--text-muted)' },
  { tag: t.invalid, color: 'var(--accent-danger)' },
])
