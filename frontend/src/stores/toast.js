import { reactive } from 'vue'

/**
 * Minimal toast store. Types: 'success' | 'error' | 'info' | 'warning'.
 * Toasts auto-dismiss after 4.5s; the <Toast/> component renders them.
 */
let seq = 0

export const toasts = reactive([])

export function toast(message, type = 'info') {
  const id = ++seq
  toasts.push({ id, message: String(message), type })
  setTimeout(() => dismissToast(id), 4500)
  return id
}

export function dismissToast(id) {
  const i = toasts.findIndex((t) => t.id === id)
  if (i >= 0) toasts.splice(i, 1)
}
