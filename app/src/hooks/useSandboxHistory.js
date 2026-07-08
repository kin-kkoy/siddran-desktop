import { useCallback, useMemo, useRef, useState } from 'react'

/**
 * Inverse-command undo/redo for the sandbox. Wraps useSandbox's mutators and
 * returns history-aware versions under `do`. We use inverse commands (not whole
 * `items` snapshots) because base64 images would make array snapshots huge and
 * the localStorage budget is already watched near 3MB.
 *
 * A command is `{ undo, redo }`. The base mutation runs immediately; the command
 * only records how to reverse/replay it. New actions clear the redo stack.
 *
 * Transactions coalesce a gesture (a drag fires many updateItem calls; an
 * eraser drag many removeItem calls) into ONE undo step:
 *   beginTransaction() → ...many do.updateItem/removeItem... → endTransaction()
 * Updates are merged per-item; adds/removes are kept in order. Nested begins are
 * ref-counted so only the outermost end finalises.
 *
 * History never touches persistence — undo/redo just produce more setItems
 * calls, which useSandbox's existing 300ms debounce absorbs.
 */

const clone = (v) => (typeof structuredClone === 'function'
    ? structuredClone(v)
    : JSON.parse(JSON.stringify(v)))

// Capture the pre-mutation value of only the keys a patch touches.
const capturePrev = (item, patch) => {
    const prev = {}
    for (const k in patch) prev[k] = clone(item ? item[k] : undefined)
    return prev
}

export function useSandboxHistory({ addItem, updateItem, removeItem, getItemById }) {
    const undoStack = useRef([])
    const redoStack = useRef([])
    const txnRef = useRef(null) // { updates: Map, others: [], depth }

    const [canUndo, setCanUndo] = useState(false)
    const [canRedo, setCanRedo] = useState(false)
    const sync = useCallback(() => {
        setCanUndo(undoStack.current.length > 0)
        setCanRedo(redoStack.current.length > 0)
    }, [])

    // Record a finished command (its base mutation already ran).
    const push = useCallback((cmd) => {
        undoStack.current.push(cmd)
        redoStack.current = []
        sync()
    }, [sync])

    // Route a freshly-built command to the open transaction or straight to the
    // stack.
    const record = useCallback((cmd) => {
        if (txnRef.current) txnRef.current.others.push(cmd)
        else push(cmd)
    }, [push])

    const doAddItem = useCallback((partial) => {
        const created = addItem(partial)
        record({
            undo: () => removeItem(created.id),
            redo: () => addItem(clone(created)),
        })
        return created
    }, [addItem, removeItem, record])

    const doRemoveItem = useCallback((id) => {
        const snapshot = getItemById(id)
        if (!snapshot) { removeItem(id); return }
        const saved = clone(snapshot)
        removeItem(id)
        record({
            undo: () => addItem(clone(saved)),
            redo: () => removeItem(id),
        })
    }, [addItem, removeItem, getItemById, record])

    const doUpdateItem = useCallback((id, patch) => {
        const txn = txnRef.current
        if (txn) {
            if (!txn.updates.has(id)) {
                txn.updates.set(id, { before: capturePrev(getItemById(id), patch), patch: {} })
            } else {
                // Make sure newly-touched keys also get their pre-value captured.
                const entry = txn.updates.get(id)
                const before = entry.before
                const prevItem = getItemById(id)
                for (const k in patch) {
                    if (!(k in before)) before[k] = clone(prevItem ? prevItem[k] : undefined)
                }
            }
            updateItem(id, patch)
            Object.assign(txn.updates.get(id).patch, patch)
            return
        }
        const before = capturePrev(getItemById(id), patch)
        updateItem(id, patch)
        record({
            undo: () => updateItem(id, before),
            redo: () => updateItem(id, patch),
        })
    }, [updateItem, getItemById, record])

    const beginTransaction = useCallback(() => {
        if (txnRef.current) { txnRef.current.depth += 1; return }
        txnRef.current = { updates: new Map(), others: [], depth: 1 }
    }, [])

    const endTransaction = useCallback(() => {
        const txn = txnRef.current
        if (!txn) return
        if (txn.depth > 1) { txn.depth -= 1; return }
        txnRef.current = null

        const subs = []
        for (const [id, { before, patch }] of txn.updates) {
            subs.push({
                undo: () => updateItem(id, before),
                redo: () => updateItem(id, patch),
            })
        }
        subs.push(...txn.others)
        if (subs.length === 0) return
        if (subs.length === 1) { push(subs[0]); return }
        push({
            undo: () => { for (let i = subs.length - 1; i >= 0; i--) subs[i].undo() },
            redo: () => { for (let i = 0; i < subs.length; i++) subs[i].redo() },
        })
    }, [updateItem, push])

    const undo = useCallback(() => {
        const cmd = undoStack.current.pop()
        if (!cmd) return
        cmd.undo()
        redoStack.current.push(cmd)
        sync()
    }, [sync])

    const redo = useCallback(() => {
        const cmd = redoStack.current.pop()
        if (!cmd) return
        cmd.redo()
        undoStack.current.push(cmd)
        sync()
    }, [sync])

    const doApi = useMemo(() => ({
        addItem: doAddItem,
        updateItem: doUpdateItem,
        removeItem: doRemoveItem,
    }), [doAddItem, doUpdateItem, doRemoveItem])

    return { do: doApi, undo, redo, beginTransaction, endTransaction, canUndo, canRedo }
}
