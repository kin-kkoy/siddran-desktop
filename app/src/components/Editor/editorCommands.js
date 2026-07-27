// Single source of truth for the note editor's formatting commands. Consumed by
// BOTH the dock (EditorDock.jsx, rendered as buttons) and the command palette
// (rendered as a searchable list), so the two can never drift apart.
//
// Each command: { id, title, keywords, icon, run(view) }. `run` takes a CodeMirror
// view and does its own dispatch + focus. `keywords` widen palette fuzzy-matching
// beyond the visible title.

import {
  FaBold, FaItalic, FaUnderline, FaStrikethrough, FaHeading, FaCode,
  FaLink, FaListUl, FaListOl, FaQuoteLeft, FaTable,
} from 'react-icons/fa'
import { MdCheckBox, MdHorizontalRule } from 'react-icons/md'
import { LuEyeOff, LuHighlighter, LuStickyNote, LuListTodo, LuShapes } from 'react-icons/lu'
import {
  wrapSelection, toggleLinePrefix, cycleHeading, insertHR, insertLink,
  insertWikilink, insertTable,
} from './cm/formatting'

// Formatting + insert commands, in dock order.
export const EDITOR_COMMANDS = [
  { id: 'bold', title: 'Bold', keywords: 'strong', icon: FaBold, run: v => wrapSelection(v, '**') },
  { id: 'italic', title: 'Italic', keywords: 'emphasis', icon: FaItalic, run: v => wrapSelection(v, '*') },
  { id: 'underline', title: 'Underline', keywords: '', icon: FaUnderline, run: v => wrapSelection(v, '<u>', '</u>') },
  { id: 'strike', title: 'Strikethrough', keywords: 'strike delete', icon: FaStrikethrough, run: v => wrapSelection(v, '~~') },
  { id: 'heading', title: 'Heading (cycle)', keywords: 'h1 h2 h3 title', icon: FaHeading, run: cycleHeading },
  { id: 'code', title: 'Inline code', keywords: 'monospace', icon: FaCode, run: v => wrapSelection(v, '`') },
  { id: 'highlight', title: 'Highlight', keywords: 'mark', icon: LuHighlighter, run: v => wrapSelection(v, '==') },
  { id: 'spoiler', title: 'Spoiler', keywords: 'hidden hide', icon: LuEyeOff, run: v => wrapSelection(v, '||') },
  { id: 'link', title: 'Link', keywords: 'url href', icon: FaLink, run: insertLink },
  { id: 'ul', title: 'Bullet list', keywords: 'unordered', icon: FaListUl, run: v => toggleLinePrefix(v, '- ') },
  { id: 'ol', title: 'Numbered list', keywords: 'ordered', icon: FaListOl, run: v => toggleLinePrefix(v, '1. ') },
  { id: 'check', title: 'Checkbox', keywords: 'task todo', icon: MdCheckBox, run: v => toggleLinePrefix(v, '- [ ] ') },
  { id: 'quote', title: 'Blockquote', keywords: 'quote', icon: FaQuoteLeft, run: v => toggleLinePrefix(v, '> ') },
  { id: 'table', title: 'Insert table', keywords: 'grid rows columns', icon: FaTable, run: insertTable },
  { id: 'hr', title: 'Horizontal rule', keywords: 'divider line', icon: MdHorizontalRule, run: insertHR },
]

// Wikilink commands (the dock keeps its own inline type-picker dropdown; the palette
// exposes each scope as its own searchable entry).
export const WIKILINK_COMMANDS = [
  { id: 'wikilink-note', title: 'Insert wikilink: note', keywords: 'link reference', icon: LuStickyNote, run: v => insertWikilink(v, '') },
  { id: 'wikilink-task', title: 'Insert wikilink: task', keywords: 'link reference', icon: LuListTodo, run: v => insertWikilink(v, 'task:') },
  { id: 'wikilink-sandbox', title: 'Insert wikilink: sandbox', keywords: 'link reference', icon: LuShapes, run: v => insertWikilink(v, 'sandbox:') },
]
