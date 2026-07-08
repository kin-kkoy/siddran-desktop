import { useEffect } from 'react'

// Tiny external store tracking how many modals are currently mounted, so background effects (the
// StarCanvas rAF loop) can pause while a modal is open. A modal opts in by calling
// useModalPresence() — it increments on mount, decrements on unmount.
let count = 0
const subscribers = new Set()
const emit = () => subscribers.forEach(fn => fn())

export const modalPresence = {
    push() { count += 1; emit() },
    pop() { count = Math.max(0, count - 1); emit() },
    subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn) },
    getCount: () => count,
}

// Call inside a modal component; counts it as "open" for its lifetime.
export function useModalPresence() {
    useEffect(() => {
        modalPresence.push()
        return () => modalPresence.pop()
    }, [])
}
