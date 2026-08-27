// Show a note or notebook where it actually lives, in the user's file manager.
//
// Notes are real .md files in the Bag, so there is a genuine path to point at.
// The Rust command confines the path to the open Bag before handing it to the OS
// and pre-selects the file where the desktop supports it, falling back to opening
// the containing folder. Same invoke idiom as htmlViewer.js — withGlobalTauri is
// on, so there is no shared wrapper to import.
import { getBagPath, safeName } from './localStore'
import { toast } from '../utils/toast'

const invoke = () =>
  (typeof window !== 'undefined' && (window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke)) || null

// Where a notebook lives. Notebooks have no `_path` of their own — the folder is
// derived the same way reconcileNotes creates it.
export const notebookPath = (notebook) => {
  const bag = getBagPath()
  if (!bag || !notebook?.name) return ''
  return `${bag}/notes/${safeName(notebook.name)}`
}

// Whether the action is worth offering at all: outside the desktop shell, or with
// no Bag open, there is nothing on disk to show.
export const canReveal = () => !!invoke() && !!getBagPath()

// This is user-initiated, so it fails LOUDLY — a note whose file was moved or
// deleted outside the app is exactly the case worth hearing about, and silence
// would read as the file manager simply not opening.
export async function revealPath(absPath) {
  const inv = invoke()
  if (!inv) { toast.error('Only available in the desktop app'); return false }
  if (!absPath) {
    toast.warning("This note hasn't been saved to disk yet — give it a moment")
    return false
  }
  try {
    await inv('reveal_in_file_manager', { path: absPath })
    return true
  } catch (e) {
    toast.error(e?.message || String(e) || 'Could not show this in the file manager')
    return false
  }
}

// A note's file. `_path` is set by the store when the note is written out, so a
// note created seconds ago may not have one yet (the flush is debounced).
export const revealNote = (note) => revealPath(note?._path)
export const revealNotebook = (notebook) => revealPath(notebookPath(notebook))
