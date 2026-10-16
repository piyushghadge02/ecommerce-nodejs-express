<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { Pencil, Plus, Search, SearchX } from 'lucide-vue-next'
import AdminLayout from '../components/AdminLayout.vue'
import ProductModal from '../components/ProductModal.vue'
import ProductThumb from '../components/ProductThumb.vue'
import Skeleton from '../components/Skeleton.vue'
import { apiError, productsApi } from '../api/client.js'
import { toast } from '../stores/toast.js'
import { formatDateTime, formatMoney, totalStock } from '../utils/format.js'

const CATEGORIES = ['peripherals', 'audio', 'cables', 'office']

const filters = reactive({
  q: '',
  category: '', // '' = all
  active: 'all', // 'all' | 'true' | 'false'
})

const products = ref([])
const loading = ref(false)
const error = ref(null)

const modalOpen = ref(false)
const editing = ref(null) // null → create

let qTimer = null

async function fetchProducts() {
  loading.value = true
  error.value = null
  try {
    const params = { active: filters.active }
    if (filters.q.trim()) params.q = filters.q.trim()
    if (filters.category) params.category = filters.category
    const { data } = await productsApi.list(params)
    products.value = Array.isArray(data) ? data : []
  } catch (err) {
    error.value = apiError(err, 'Could not load products')
  } finally {
    loading.value = false
  }
}

function onQInput() {
  clearTimeout(qTimer)
  qTimer = setTimeout(fetchProducts, 400)
}

watch([() => filters.category, () => filters.active], fetchProducts)

function openCreate() {
  editing.value = null
  modalOpen.value = true
}

function openEdit(p) {
  editing.value = p
  modalOpen.value = true
}

function onSaved() {
  modalOpen.value = false
  fetchProducts()
}

const shown = computed(() => products.value.length)

onMounted(fetchProducts)
</script>

<template>
  <AdminLayout>
    <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-bold text-stone-900 dark:text-stone-100 sm:text-2xl">Catalog Administration</h1>
        <p class="mt-1 text-sm text-stone-500 dark:text-stone-400">
          Product catalog lives in <strong class="font-semibold">MongoDB</strong>. Edits here never touch
          PostgreSQL order history or indexed Elasticsearch documents.
        </p>
      </div>
      <button
        class="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-soft hover:bg-indigo-700"
        @click="openCreate"
      >
        <Plus class="h-4 w-4" aria-hidden="true" />
        New Product
      </button>
    </div>

    <!-- Filters -->
    <div class="mb-4 flex flex-col gap-3 sm:flex-row">
      <div class="relative flex-1">
        <Search class="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-stone-400 dark:text-stone-500" aria-hidden="true" />
        <input
          v-model="filters.q"
          type="search"
          placeholder="Search title, description, tags…"
          aria-label="Search products"
          class="w-full rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 py-2.5 pr-4 pl-10 text-sm text-stone-900 dark:text-stone-100 shadow-sm placeholder-stone-400 dark:placeholder-stone-500 transition-soft focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          @input="onQInput"
        />
      </div>
      <select
        v-model="filters.category"
        aria-label="Filter by category"
        class="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-3 py-2.5 text-sm font-medium text-stone-700 dark:text-stone-300 shadow-sm transition-soft focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
      >
        <option value="">All categories</option>
        <option v-for="c in CATEGORIES" :key="c" :value="c" class="capitalize">{{ c }}</option>
      </select>
      <select
        v-model="filters.active"
        aria-label="Filter by active state"
        class="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-3 py-2.5 text-sm font-medium text-stone-700 dark:text-stone-300 shadow-sm transition-soft focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
      >
        <option value="all">All products</option>
        <option value="true">Active only</option>
        <option value="false">Inactive only</option>
      </select>
    </div>

    <div class="overflow-hidden rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 shadow-sm">
      <!-- Loading -->
      <div v-if="loading" class="space-y-3 p-5">
        <Skeleton cls="h-12 w-full" />
        <Skeleton cls="h-12 w-full" />
        <Skeleton cls="h-12 w-full" />
        <Skeleton cls="h-12 w-full" />
      </div>

      <!-- Error -->
      <div v-else-if="error" class="p-8 text-center" role="alert">
        <p class="font-semibold text-red-700 dark:text-red-200">Couldn't load the catalog</p>
        <p class="mt-1 text-sm text-red-600 dark:text-red-400">{{ error }}</p>
        <button
          class="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-soft hover:bg-indigo-700"
          @click="fetchProducts"
        >
          Retry
        </button>
      </div>

      <!-- Empty -->
      <div v-else-if="shown === 0" class="p-10 text-center">
        <SearchX class="mx-auto h-12 w-12 text-stone-300 dark:text-stone-600" aria-hidden="true" />
        <p class="mt-3 font-semibold text-stone-800 dark:text-stone-200">No products found</p>
        <p class="mt-1 text-sm text-stone-500 dark:text-stone-400">Adjust the filters, or create a new product.</p>
      </div>

      <!-- Table -->
      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-200 text-sm">
          <thead>
            <tr class="border-b border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-800 text-left text-xs font-semibold tracking-wide text-stone-500 dark:text-stone-400 uppercase">
              <th class="px-5 py-3">Product</th>
              <th class="px-5 py-3">Category</th>
              <th class="px-5 py-3 text-right">Price</th>
              <th class="px-5 py-3 text-center">Stock</th>
              <th class="px-5 py-3">Status</th>
              <th class="px-5 py-3">Updated</th>
              <th class="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-stone-100 dark:divide-stone-800">
            <tr v-for="p in products" :key="p.id" class="transition-soft hover:bg-stone-50 dark:hover:bg-stone-800">
              <td class="px-5 py-3">
                <div class="flex items-center gap-3">
                  <ProductThumb :category="p.category" :title="p.title" :sku="p.sku" :image="p.image" size="sm" class="shrink-0" />
                  <div class="min-w-0">
                    <p class="truncate font-medium text-stone-900 dark:text-stone-100">{{ p.title }}</p>
                    <p class="text-xs text-stone-400 dark:text-stone-500 tabular-nums">{{ p.sku }}</p>
                  </div>
                </div>
              </td>
              <td class="px-5 py-3">
                <span class="inline-flex items-center rounded-full bg-stone-100 dark:bg-stone-800 px-2 py-0.5 text-xs font-medium text-stone-600 dark:text-stone-300 capitalize">
                  {{ p.category }}
                </span>
              </td>
              <td class="px-5 py-3 text-right font-semibold text-stone-900 dark:text-stone-100 tabular-nums">{{ formatMoney(p.price) }}</td>
              <td class="px-5 py-3 text-center text-stone-600 dark:text-stone-300 tabular-nums">{{ totalStock(p) }}</td>
              <td class="px-5 py-3">
                <span
                  v-if="p.active"
                  class="inline-flex items-center rounded-full bg-emerald-100 dark:bg-emerald-950 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 dark:text-emerald-200 ring-1 ring-inset ring-emerald-200 dark:ring-emerald-900"
                >
                  Active
                </span>
                <span
                  v-else
                  class="inline-flex items-center rounded-full bg-stone-100 dark:bg-stone-800 px-2.5 py-0.5 text-xs font-semibold text-stone-500 dark:text-stone-400 ring-1 ring-inset ring-stone-200 dark:ring-stone-700"
                >
                  Inactive
                </span>
              </td>
              <td class="px-5 py-3 whitespace-nowrap text-stone-500 dark:text-stone-400">{{ formatDateTime(p.updated_at) }}</td>
              <td class="px-5 py-3 text-right">
                <button
                  class="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 dark:border-stone-800 px-2.5 py-1.5 text-xs font-semibold text-stone-600 dark:text-stone-300 transition-soft hover:bg-stone-50 dark:hover:bg-stone-800 hover:text-stone-900 dark:hover:text-stone-100"
                  @click="openEdit(p)"
                >
                  <Pencil class="h-3.5 w-3.5" aria-hidden="true" />
                  Edit
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <ProductModal :open="modalOpen" :product="editing" @close="modalOpen = false" @saved="onSaved" />
  </AdminLayout>
</template>
