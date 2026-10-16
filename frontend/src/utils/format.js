const moneyFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

/** Format a numeric amount as $X.XX (tolerant of string/Decimal input). */
export function formatMoney(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return moneyFmt.format(n)
}

const dateFmt = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

const dateTimeFmt = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

export function formatDate(value) {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : dateFmt.format(d)
}

export function formatDateTime(value) {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : dateTimeFmt.format(d)
}

/** Total stock across variants (Mongo product doc). */
export function totalStock(product) {
  if (!product?.variants?.length) return 0
  return product.variants.reduce((n, v) => n + (Number(v.stock) || 0), 0)
}
