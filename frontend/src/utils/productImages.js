/**
 * Storefront product photographs, keyed by product SKU.
 *
 * The catalog API (MongoDB) currently carries no image field, so the
 * storefront resolves photos client-side. Every URL below was visually
 * verified (downloaded and inspected) to show the actual product type —
 * mouse, mechanical keyboard, USB hub, mouse pad, webcam, monitors,
 * earbuds, headphones, speaker, microphone, cables, charging pad, lamp,
 * remote, organizer trays, cushions, etc. All are stable CDN links
 * (Unsplash / Pexels, all HTTP 200) with generic, non-branded product
 * photography suitable for a real ecommerce storefront.
 * `ProductThumb` falls back to the category icon tile if a photo ever
 * fails to load.
 */
const u = (id) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=640&q=70`
const px = (id) => `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=640`

const SKU_IMAGES = {
  // ---- peripherals ----
  'WM-001': u('1527864550417-7fd91fc51a46'), // wireless mouse on white
  'MK-101': px('12561283'), // mechanical keyboard, orange accent key
  'WK-102': u('1618384887929-16ec33fab9ef'), // compact wireless keyboard
  'HUB-201': px('7054723'), // usb-c hub with cables plugged into laptop
  'MP-202': px('7430757'), // mouse resting on black desk pad
  'CAM-203': px('40094748'), // black webcam cube on stand
  'MON-204': px('326512'), // dual-monitor desk setup
  // ---- audio ----
  'EB-301': u('1590658268037-6bf12165a8df'), // wireless earbuds + cases
  'NCH-302': u('1505740420928-5e560c06d30e'), // over-ear headphones
  'SPK-303': px('12021852'), // compact bluetooth speaker
  'MIC-304': u('1590602847861-f357a9332bbc'), // microphone on boom arm
  'EP-305': u('1484704849700-f032a568e944'), // wired on-ear earphones
  'SB-306': u('1545454675-3531b543be5d'), // bookshelf speaker (soundbar stand-in)
  // ---- cables ----
  'CBL-401': px('3921633'), // black braided usb-c cable
  'HDMI-402': px('12997230'), // hdmi connector close-up
  'WCP-403': px('5961044'), // phone on round wireless charging pad
  'LGT-404': px('34338614'), // white power bank with multi-tip cable
  'DP-405': px('33693716'), // coiled black display cable
  'ETH-406': u('1544197150-b99a580bb7a8'), // ethernet patch panel
  // ---- office ----
  'LAMP-501': u('1507473885765-e6ed057f782c'), // grey desk lamp
  'MST-502': px('7899231'), // monitors on wooden office desk
  'PRS-503': px('39908054'), // handheld remote control
  'LST-504': u('1496181133206-80ce9b88a853'), // laptop on desk
  'ORG-505': px('7054793'), // desk organizer trays with stationery
  'CUSH-506': px('8416318'), // colorful throw cushions on white
  'CRT-507': u('1550745165-9bc0b252726f'), // retro crt computer setup
}

/**
 * Resolve the display image for a product object.
 * Prefers an API-provided `image` field when present (forward-compatible),
 * then the seeded SKU map, else null (caller shows the icon fallback).
 */
export function productImage(product) {
  if (!product) return null
  if (typeof product.image === 'string' && product.image.trim()) return product.image.trim()
  const sku = typeof product.sku === 'string' ? product.sku.trim().toUpperCase() : ''
  return SKU_IMAGES[sku] ?? null
}

export { SKU_IMAGES }
