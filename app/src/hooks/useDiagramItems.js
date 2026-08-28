import { useCallback, useMemo, useRef, useState } from 'react'
import { newItemId } from './sandboxCache'

// An in-memory stand-in for `useSandbox(id)`.
//
// It exposes exactly the contract `useSandboxHistory` consumes — addItem /
// updateItem / removeItem / getItemById — but the items live in React state
// belonging to one diagram block instead of in a board's store. That is the
// whole trick behind editing a note's diagram with the real Sandbox canvas: the
// canvas, the selection overlay, the context toolbar and undo/redo never learn
// that there is no board behind them.
//
// Nothing here touches localStorage or the network. A diagram belongs to its
// note, and the note's own autosave is what persists it — a second, competing
// persistence path is exactly the kind of thing that makes two copies of the
// same drawing disagree.

export function useDiagramItems(initialItems) {
  const [items, setItems] = useState(() => (initialItems || []).map(clone))

  // Mutations have to be readable synchronously right after they are applied:
  // history's undo/redo closes over item snapshots, and SandboxCanvas commits a
  // shape and then immediately selects it. React state alone is a frame behind,
  // so the ref is the source of truth and state exists to trigger renders.
  const ref = useRef(items)
  const commit = useCallback((next) => {
    ref.current = next
    setItems(next)
  }, [])

  const addItem = useCallback((partial) => {
    const created = { ...clone(partial), id: partial?.id ?? newItemId() }
    commit([...ref.current, created])
    return created
  }, [commit])

  const updateItem = useCallback((id, patch) => {
    let updated = null
    const next = ref.current.map(it => {
      if (it.id !== id) return it
      updated = { ...it, ...patch }
      // Payload is patched, not replaced: the context toolbar sends
      // `{ payload: { fill } }` meaning "change the fill", not "this is now the
      // entire payload". Replacing it would silently drop a shape's text.
      if (patch && patch.payload) updated.payload = { ...it.payload, ...patch.payload }
      return updated
    })
    if (updated) commit(next)
    return updated
  }, [commit])

  const removeItem = useCallback((id) => {
    const next = ref.current.filter(it => it.id !== id)
    if (next.length !== ref.current.length) commit(next)
  }, [commit])

  const getItemById = useCallback((id) => ref.current.find(it => it.id === id) || null, [])

  return useMemo(
    () => ({ items, addItem, updateItem, removeItem, getItemById, itemsRef: ref }),
    [items, addItem, updateItem, removeItem, getItemById],
  )
}

// Structured copy so an undo snapshot can never alias the live item's payload.
function clone(item) {
  return { ...item, payload: item?.payload ? { ...item.payload } : {} }
}
