import axios from 'axios'

/**
 * API client for the FastAPI backend.
 * Base URL comes from VITE_API_URL (see repo-root .env.example).
 * When unset, same-origin relative URLs are used so Vite's dev/proxy
 * (`/api` -> http://127.0.0.1:8000) handles routing without CORS issues.
 * Set VITE_API_URL=http://localhost:8000 for an absolute dev backend, or to
 * the deployed API URL in production builds.
 */
const rawBase = (import.meta.env.VITE_API_URL ?? '').trim()
const baseURL = rawBase === '' ? '' : rawBase.replace(/\/$/, '')

export const api = axios.create({
  baseURL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
})

/** Extract a human-readable message from the backend error envelope {detail, code?}. */
export function apiError(err, fallback = 'Request failed') {
  const detail = err?.response?.data?.detail
  if (typeof detail === 'string' && detail) return detail
  if (Array.isArray(detail)) {
    // FastAPI validation errors: [{loc, msg, ...}]
    const msgs = detail.map((d) => d?.msg).filter(Boolean)
    if (msgs.length) return msgs.join('; ')
  }
  if (err?.code === 'ECONNABORTED') return 'Request timed out — the API may be unreachable.'
  if (err?.message === 'Network Error') return 'Cannot reach the API server. Is it running?'
  return err?.message || fallback
}

export const usersApi = {
  /** GET /api/users — the 8 seeded demo users (PostgreSQL). */
  list: () => api.get('/api/users'),
}

export const productsApi = {
  /** GET /api/products — MongoDB catalog. active: 'true' | 'false' | 'all'. */
  list: (params = {}) => api.get('/api/products', { params }),
  get: (id) => api.get(`/api/products/${id}`),
  /** POST /api/products — MongoDB only. */
  create: (body) => api.post('/api/products', body),
  /** PUT /api/products/{id} — MongoDB only (never rewrites PG/ES history). */
  update: (id, body) => api.put(`/api/products/${id}`, body),
}

export const ordersApi = {
  /** POST /api/orders — validated against Mongo, persisted transactionally in PG. */
  create: (body) => api.post('/api/orders', body),
  /** GET /api/orders/{id} — canonical order from PostgreSQL. */
  get: (id) => api.get(`/api/orders/${id}`),
  /** PATCH /api/orders/{id}/status — PG first, then ES sync. */
  updateStatus: (id, status) => api.patch(`/api/orders/${id}/status`, { status }),
}

export const searchApi = {
  /** POST /api/search/orders — Elasticsearch ONLY (hits + aggregations). */
  orders: (body) => api.post('/api/search/orders', body),
}

export { baseURL as apiBaseUrl }
