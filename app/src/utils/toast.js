// Event-emitter based toast system
// Can be called from anywhere (hooks, components, utils) without needing React context
let listeners = []
let nextId = 1

export const toast = {
  _emit(payload) {
    listeners.forEach(fn => fn(payload))
  },
  success: (message) => {
    const id = nextId++
    toast._emit({ id, message, type: 'success', action: 'add' })
    return id
  },
  error: (message) => {
    const id = nextId++
    toast._emit({ id, message, type: 'error', action: 'add' })
    return id
  },
  warning: (message) => {
    const id = nextId++
    toast._emit({ id, message, type: 'warning', action: 'add' })
    return id
  },
  loading: (message) => {
    const id = nextId++
    toast._emit({ id, message, type: 'loading', action: 'add', sticky: true })
    return id
  },
  dismiss: (id) => {
    toast._emit({ id, action: 'dismiss' })
  },
  update: (id, message, type = 'success') => {
    toast._emit({ id, message, type, action: 'update' })
  },
  subscribe: (fn) => {
    listeners.push(fn)
    return () => { listeners = listeners.filter(l => l !== fn) }
  }
}
