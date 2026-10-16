import { computed, reactive } from 'vue'

/**
 * Cart store — simple reactive state, persisted to localStorage.
 * Lines snapshot the product title/price at add-time for display only;
 * the server always re-validates prices from MongoDB at checkout.
 */
const STORAGE_KEY = 'poc-cart-v1'

function loadLines() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY))
    return Array.isArray(raw) ? raw.filter((l) => l && l.product_id && l.qty > 0) : []
  } catch {
    return []
  }
}

export const cart = reactive({
  lines: loadLines(), // [{ product_id, title, price, qty }]
})

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cart.lines))
  } catch {
    /* storage unavailable — cart still works in-memory */
  }
}

export function addToCart(product, qty = 1) {
  const n = Math.max(1, Math.floor(qty) || 1)
  const line = cart.lines.find((l) => l.product_id === product.id)
  if (line) {
    line.qty += n
    line.title = product.title
    line.price = product.price
  } else {
    cart.lines.push({
      product_id: product.id,
      title: product.title,
      price: product.price,
      qty: n,
    })
  }
  persist()
}

export function setLineQty(productId, qty) {
  const line = cart.lines.find((l) => l.product_id === productId)
  if (!line) return
  const n = Math.floor(qty) || 0
  if (n <= 0) {
    removeLine(productId)
    return
  }
  line.qty = n
  persist()
}

export function removeLine(productId) {
  const i = cart.lines.findIndex((l) => l.product_id === productId)
  if (i >= 0) cart.lines.splice(i, 1)
  persist()
}

export function clearCart() {
  cart.lines.splice(0, cart.lines.length)
  persist()
}

export const cartCount = computed(() => cart.lines.reduce((n, l) => n + l.qty, 0))

export const cartSubtotal = computed(() =>
  cart.lines.reduce((n, l) => n + l.qty * Number(l.price || 0), 0),
)
