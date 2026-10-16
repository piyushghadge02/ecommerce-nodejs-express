<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { Plus, Trash2, X } from 'lucide-vue-next'
import { apiError, productsApi } from '../api/client.js'
import { toast } from '../stores/toast.js'
import { formatDateTime } from '../utils/format.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  /** null → create mode; product object → edit mode */
  product: { type: Object, default: null },
})

const emit = defineEmits(['close', 'saved'])

const CATEGORIES = ['peripherals', 'audio', 'cables', 'office']

const form = reactive({
  title: '',
  sku: '',
  description: '',
  price: '',
  category: 'peripherals',
  tags: '',
  active: true,
})
const attrRows = ref([{ k: '', v: '' }])
const variantRows = ref([{ sku: '', color: '', stock: '' }])
const errors = reactive({})
const saving = ref(false)

const isEdit = computed(() => !!props.product)
const title = computed(() => (isEdit.value ? 'Edit Product' : 'New Product'))

function resetForm() {
  const p = props.product
  form.title = p?.title ?? ''
  form.sku = p?.sku ?? ''
  form.description = p?.description ?? ''
  form.price = p?.price != null ? String(p.price) : ''
  form.category = p?.category ?? 'peripherals'
  form.tags = Array.isArray(p?.tags) ? p.tags.join(', ') : ''
  form.active = p?.active ?? true

  const attrs = p?.attributes && typeof p.attributes === 'object' ? p.attributes : {}
  const attrEntries = Object.entries(attrs)
  attrRows.value = attrEntries.length
    ? attrEntries.map(([k, v]) => ({ k, v: String(v ?? '') }))
    : [{ k: '', v: '' }]

  variantRows.value =
    Array.isArray(p?.variants) && p.variants.length
      ? p.variants.map((v) => ({
          sku: v.sku ?? '',
          color: v.color ?? '',
          stock: v.stock != null ? String(v.stock) : '',
        }))
      : [{ sku: '', color: '', stock: '' }]

  Object.keys(errors).forEach((k) => delete errors[k])
}

watch(() => props.open, (open) => { if (open) resetForm() }, { immediate: true })

function setError(key, msg) {
  if (msg) errors[key] = msg
  else delete errors[key]
}

function validate() {
  Object.keys(errors).forEach((k) => delete errors[k])
  let ok = true

  if (!form.title.trim()) { setError('title', 'Title is required.'); ok = false }
  if (!form.sku.trim()) { setError('sku', 'SKU is required.'); ok = false }
  const price = Number(form.price)
  if (form.price === '' || !Number.isFinite(price)) { setError('price', 'Price is required.'); ok = false }
  else if (price <= 0) { setError('price', 'Price must be greater than 0.'); ok = false }
  if (!CATEGORIES.includes(form.category)) { setError('category', 'Choose a category.'); ok = false }

  const filledVariants = variantRows.value.filter((r) => r.sku.trim())
  if (!filledVariants.length) { setError('variants', 'At least one variant with a SKU is required.'); ok = false }
  variantRows.value.forEach((r, i) => {
    const stock = r.stock === '' ? 0 : Number(r.stock)
    if (r.stock !== '' && (!Number.isFinite(stock) || stock < 0 || !Number.isInteger(stock))) {
      setError(`variant_stock_${i}`, 'Stock must be a whole number ≥ 0.')
      ok = false
    }
  })

  const seenAttrs = new Set()
  attrRows.value.forEach((r) => {
    if (r.k.trim()) {
      if (seenAttrs.has(r.k.trim())) { setError('attributes', `Duplicate attribute key "${r.k.trim()}".`); ok = false }
      seenAttrs.add(r.k.trim())
    }
  })

  return ok
}

function buildPayload() {
  const attributes = {}
  attrRows.value.forEach((r) => {
    if (r.k.trim()) attributes[r.k.trim()] = r.v
  })
  const variants = variantRows.value
    .filter((r) => r.sku.trim())
    .map((r) => ({
      sku: r.sku.trim(),
      color: r.color.trim(),
      stock: r.stock === '' ? 0 : Number(r.stock),
    }))
  return {
    sku: form.sku.trim(),
    title: form.title.trim(),
    description: form.description.trim(),
    price: Math.round(Number(form.price) * 100) / 100,
    category: form.category,
    tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
    attributes,
    variants,
    active: form.active,
  }
}

async function submit() {
  if (!validate()) {
    toast('Please fix the highlighted fields.', 'warning')
    return
  }
  saving.value = true
  try {
    const payload = buildPayload()
    if (isEdit.value) {
      await productsApi.update(props.product.id, payload)
      toast(`Product "${payload.title}" updated in MongoDB.`, 'success')
    } else {
      await productsApi.create(payload)
      toast(`Product "${payload.title}" created in MongoDB.`, 'success')
    }
    emit('saved')
  } catch (err) {
    toast(apiError(err, 'Could not save product'), 'error')
  } finally {
    saving.value = false
  }
}

function close() {
  if (!saving.value) emit('close')
}

const inputCls = (bad) =>
  `w-full rounded-lg border bg-white px-3 py-2 text-sm text-stone-900 placeholder-stone-400 transition-soft focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:bg-stone-900 dark:text-stone-100 dark:placeholder-stone-500 ${
    bad ? 'border-red-400 dark:border-red-500' : 'border-stone-300 dark:border-stone-700'
  }`
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-50" role="dialog" aria-modal="true" :aria-label="title">
    <div class="absolute inset-0 bg-stone-900/40" @click="close"></div>

    <div class="absolute inset-0 overflow-y-auto p-4 sm:p-6">
      <div class="mx-auto w-full max-w-2xl rounded-xl bg-white dark:bg-stone-900 shadow-2xl">
        <header class="flex items-center justify-between border-b border-stone-200 dark:border-stone-800 px-5 py-4">
          <div>
            <h2 class="text-base font-semibold text-stone-900">{{ title }}</h2>
            <p class="text-xs text-stone-500 dark:text-stone-400">Writes go to MongoDB only — order history is never rewritten.</p>
          </div>
          <button
            class="rounded-lg p-1.5 text-stone-500 dark:text-stone-400 transition-soft hover:bg-stone-100 hover:text-stone-800"
            aria-label="Close dialog"
            @click="close"
          >
            <X class="h-5 w-5" />
          </button>
        </header>

        <form class="space-y-5 px-5 py-5" novalidate @submit.prevent="submit">
          <!-- Basics -->
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="sm:col-span-2">
              <label class="mb-1 block text-sm font-medium text-stone-700 dark:text-stone-300" for="pm-title">Title *</label>
              <input id="pm-title" v-model="form.title" type="text" :class="inputCls(errors.title)" placeholder="Wireless Mouse" />
              <p v-if="errors.title" class="mt-1 text-xs text-red-600 dark:text-red-400">{{ errors.title }}</p>
            </div>
            <div>
              <label class="mb-1 block text-sm font-medium text-stone-700 dark:text-stone-300" for="pm-sku">SKU *</label>
              <input id="pm-sku" v-model="form.sku" type="text" :class="inputCls(errors.sku)" placeholder="WM-001" />
              <p v-if="errors.sku" class="mt-1 text-xs text-red-600 dark:text-red-400">{{ errors.sku }}</p>
            </div>
            <div>
              <label class="mb-1 block text-sm font-medium text-stone-700 dark:text-stone-300" for="pm-price">Price (INR ₹) *</label>
              <input id="pm-price" v-model="form.price" type="number" min="0.01" step="0.01" :class="inputCls(errors.price)" placeholder="50.16" />
              <p v-if="errors.price" class="mt-1 text-xs text-red-600 dark:text-red-400">{{ errors.price }}</p>
            </div>
            <div class="sm:col-span-2">
              <label class="mb-1 block text-sm font-medium text-stone-700 dark:text-stone-300" for="pm-desc">Description</label>
              <textarea id="pm-desc" v-model="form.description" rows="2" :class="inputCls(false)" placeholder="Short product description…" />
            </div>
            <div>
              <label class="mb-1 block text-sm font-medium text-stone-700 dark:text-stone-300" for="pm-cat">Category *</label>
              <select id="pm-cat" v-model="form.category" :class="inputCls(errors.category)">
                <option v-for="c in CATEGORIES" :key="c" :value="c">{{ c }}</option>
              </select>
              <p v-if="errors.category" class="mt-1 text-xs text-red-600 dark:text-red-400">{{ errors.category }}</p>
            </div>
            <div>
              <label class="mb-1 block text-sm font-medium text-stone-700 dark:text-stone-300" for="pm-tags">Tags (comma-separated)</label>
              <input id="pm-tags" v-model="form.tags" type="text" :class="inputCls(false)" placeholder="wireless, usb, office" />
            </div>
            <div class="flex items-center gap-2.5 sm:col-span-2">
              <button
                type="button"
                role="switch"
                :aria-checked="form.active"
                class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-soft"
                :class="form.active ? 'bg-indigo-600' : ' bg-stone-300 dark:bg-stone-700'"
                @click="form.active = !form.active"
              >
                <span
                  class="pointer-events-none absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-soft"
                  :class="form.active ? 'translate-x-5' : 'translate-x-0'"
                />
              </button>
              <span class="text-sm font-medium text-stone-700 dark:text-stone-300">
                {{ form.active ? 'Active — visible in the storefront' : 'Inactive — hidden from the storefront' }}
              </span>
            </div>
          </div>

          <!-- Attributes -->
          <fieldset class="rounded-xl border border-stone-200 dark:border-stone-800 p-4">
            <legend class="px-1 text-sm font-semibold text-stone-800 dark:text-stone-200">Attributes</legend>
            <div v-for="(row, i) in attrRows" :key="i" class="mb-2 flex gap-2">
              <input v-model="row.k" type="text" placeholder="key (e.g. color)" :class="inputCls(false)" :aria-label="`Attribute key ${i + 1}`" />
              <input v-model="row.v" type="text" placeholder="value (e.g. black)" :class="inputCls(false)" :aria-label="`Attribute value ${i + 1}`" />
              <button
                type="button"
                class="shrink-0 rounded-lg p-2 text-stone-400 dark:text-stone-500 transition-soft hover:bg-red-50 dark:hover:bg-red-950 hover:text-red-600 dark:hover:text-red-400"
                :aria-label="`Remove attribute ${i + 1}`"
                @click="attrRows.splice(i, 1)"
              >
                <Trash2 class="h-4 w-4" />
              </button>
            </div>
            <p v-if="errors.attributes" class="mb-2 text-xs text-red-600 dark:text-red-400">{{ errors.attributes }}</p>
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 dark:border-stone-800 px-2.5 py-1.5 text-xs font-medium text-stone-600 transition-soft hover:bg-stone-50 dark:hover:bg-stone-800"
              @click="attrRows.push({ k: '', v: '' })"
            >
              <Plus class="h-3.5 w-3.5" /> Add attribute
            </button>
          </fieldset>

          <!-- Variants -->
          <fieldset class="rounded-xl border border-stone-200 dark:border-stone-800 p-4">
            <legend class="px-1 text-sm font-semibold text-stone-800 dark:text-stone-200">Variants *</legend>
            <div class="mb-2 hidden grid-cols-[1fr_1fr_110px_40px] gap-2 text-xs font-medium text-stone-500 dark:text-stone-400 sm:grid">
              <span>Variant SKU *</span><span>Color</span><span>Stock</span><span></span>
            </div>
            <div v-for="(row, i) in variantRows" :key="i" class="mb-2 grid grid-cols-[1fr_1fr_110px_40px] gap-2">
              <input v-model="row.sku" type="text" placeholder="WM-001-BLK" :class="inputCls(false)" :aria-label="`Variant ${i + 1} SKU`" />
              <input v-model="row.color" type="text" placeholder="black" :class="inputCls(false)" :aria-label="`Variant ${i + 1} color`" />
              <input
                v-model="row.stock"
                type="number"
                min="0"
                step="1"
                placeholder="0"
                :class="inputCls(errors[`variant_stock_${i}`])"
                :aria-label="`Variant ${i + 1} stock`"
              />
              <button
                type="button"
                class="rounded-lg p-2 text-stone-400 dark:text-stone-500 transition-soft hover:bg-red-50 dark:hover:bg-red-950 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-30"
                :disabled="variantRows.length <= 1"
                :aria-label="`Remove variant ${i + 1}`"
                @click="variantRows.splice(i, 1)"
              >
                <Trash2 class="h-4 w-4" />
              </button>
              <p v-if="errors[`variant_stock_${i}`]" class="col-span-4 -mt-1 text-xs text-red-600 dark:text-red-400">
                {{ errors[`variant_stock_${i}`] }}
              </p>
            </div>
            <p v-if="errors.variants" class="mb-2 text-xs text-red-600 dark:text-red-400">{{ errors.variants }}</p>
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 dark:border-stone-800 px-2.5 py-1.5 text-xs font-medium text-stone-600 transition-soft hover:bg-stone-50 dark:hover:bg-stone-800"
              @click="variantRows.push({ sku: '', color: '', stock: '' })"
            >
              <Plus class="h-3.5 w-3.5" /> Add variant
            </button>
          </fieldset>

          <p v-if="isEdit && product?.updated_at" class="text-xs text-stone-400 dark:text-stone-500">
            Last updated: {{ formatDateTime(product.updated_at) }}
          </p>

          <div class="flex justify-end gap-2 border-t border-stone-200 dark:border-stone-800 pt-4">
            <button
              type="button"
              class="rounded-lg border border-stone-200 dark:border-stone-800 px-4 py-2 text-sm font-medium text-stone-700 dark:text-stone-300 transition-soft hover:bg-stone-50 dark:hover:bg-stone-800"
              @click="close"
            >
              Cancel
            </button>
            <button
              type="submit"
              :disabled="saving"
              class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-soft hover:bg-indigo-700 disabled:opacity-60"
            >
              {{ saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Product' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
