<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { Info, Package, Search, SearchX, Settings2, ShoppingCart, User } from 'lucide-vue-next'
import ProductCard from '../components/ProductCard.vue'
import CartDrawer from '../components/CartDrawer.vue'
import Skeleton from '../components/Skeleton.vue'
import { apiError, productsApi } from '../api/client.js'
import { cartCount } from '../stores/cart.js'
import { loadUsers, selectUser, userStore, selectedUser } from '../stores/user.js'
import { toast } from '../stores/toast.js'

const CATEGORIES = ['peripherals', 'audio', 'cables', 'office']

const products = ref([])
const loading = ref(false)
const error = ref(null)
const q = ref('')
const category = ref('') // '' = all
const cartOpen = ref(false)

let searchTimer = null

async function fetchProducts() {
  loading.value = true
  error.value = null
  try {
    const params = {}
    if (q.value.trim()) params.q = q.value.trim()
    if (category.value) params.category = category.value
    // NOTE: `active` is intentionally omitted → API returns active products only (MongoDB).
    const { data } = await productsApi.list(params)
    products.value = Array.isArray(data) ? data : []
  } catch (err) {
    error.value = apiError(err, 'Could not load products')
  } finally {
    loading.value = false
  }
}

function onSearchInput() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(fetchProducts, 400)
}

function pickCategory(c) {
  category.value = c
  fetchProducts()
}

const resultLabel = computed(() => {
  if (loading.value) return 'Loading products…'
  const n = products.value.length
  return n === 1 ? '1 product' : `${n} products`
})

onMounted(async () => {
  await loadUsers()
  fetchProducts()
})

function onUserChange(e) {
  selectUser(e.target.value)
  const u = selectedUser.value
  if (u) toast(`Browsing as ${u.name}`, 'info')
}
</script>

<template>
  <div class="min-h-screen bg-stone-50">
    <!-- Demo banner -->
    <div class="bg-indigo-700 text-white">
      <div class="mx-auto flex max-w-7xl items-center gap-2 px-4 py-2 text-xs font-medium sm:px-6">
        <Info class="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          <strong>Demo POC — no real authentication.</strong>
          Pick a seeded demo user below to shop as; nothing here is a real account.
        </span>
      </div>
    </div>

    <!-- Header -->
    <header class="sticky top-0 z-30 border-b border-stone-200 bg-white/95 backdrop-blur">
      <div class="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        <router-link to="/" class="flex items-center gap-2.5">
          <div class="rounded-lg bg-indigo-600 p-2">
            <Package class="h-5 w-5 text-white" aria-hidden="true" />
          </div>
          <div class="leading-tight">
            <p class="text-sm font-bold text-stone-900">Polyglot Commerce</p>
            <p class="hidden text-xs text-stone-500 sm:block">Storefront</p>
          </div>
        </router-link>

        <div class="ml-auto flex flex-wrap items-center gap-2 sm:gap-3">
          <label class="flex items-center gap-2 text-sm">
            <span class="hidden items-center gap-1 font-medium text-stone-600 sm:flex">
              <User class="h-4 w-4" aria-hidden="true" />
              Log In As
            </span>
            <select
              :value="userStore.selectedId ?? ''"
              :disabled="userStore.loading || !!userStore.error"
              class="max-w-44 rounded-lg border border-stone-300 bg-white px-2.5 py-2 text-sm font-medium text-stone-800 transition-soft focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100 sm:max-w-56"
              aria-label="Log in as demo user"
              @change="onUserChange"
            >
              <option v-if="userStore.loading" value="">Loading users…</option>
              <option v-else-if="userStore.error" value="">Users unavailable</option>
              <option v-for="u in userStore.users" :key="u.id" :value="u.id">{{ u.name }}</option>
            </select>
          </label>

          <router-link
            to="/admin"
            class="hidden items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-2 text-sm font-medium text-stone-600 transition-soft hover:bg-stone-50 hover:text-stone-900 sm:inline-flex"
          >
            <Settings2 class="h-4 w-4" aria-hidden="true" />
            Admin
          </router-link>

          <button
            class="relative inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white transition-soft hover:bg-indigo-700"
            aria-label="Open cart"
            @click="cartOpen = true"
          >
            <ShoppingCart class="h-4 w-4" aria-hidden="true" />
            <span class="hidden sm:inline">Cart</span>
            <span
              v-if="cartCount > 0"
              class="absolute -top-2 -right-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-400 px-1 text-[11px] font-bold text-stone-900 tabular-nums"
            >
              {{ cartCount }}
            </span>
          </button>
        </div>
      </div>
    </header>

    <main class="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
      <!-- Search + filters -->
      <div class="mb-6 space-y-4">
        <div class="relative max-w-xl">
          <Search class="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
          <input
            v-model="q"
            type="search"
            placeholder="Search products, tags, descriptions…"
            aria-label="Search products"
            class="w-full rounded-xl border border-stone-200 bg-white py-2.5 pr-4 pl-10 text-sm text-stone-900 shadow-sm placeholder-stone-400 transition-soft focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            @input="onSearchInput"
          />
        </div>

        <div class="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
          <button
            :class="[
              'rounded-full px-3.5 py-1.5 text-sm font-medium transition-soft',
              category === '' ? 'bg-stone-900 text-white' : 'border border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:text-stone-900',
            ]"
            @click="pickCategory('')"
          >
            All
          </button>
          <button
            v-for="c in CATEGORIES"
            :key="c"
            :class="[
              'rounded-full px-3.5 py-1.5 text-sm font-medium capitalize transition-soft',
              category === c ? 'bg-stone-900 text-white' : 'border border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:text-stone-900',
            ]"
            @click="pickCategory(c)"
          >
            {{ c }}
          </button>
        </div>
      </div>

      <p class="mb-4 text-sm text-stone-500" aria-live="polite">{{ resultLabel }}</p>

      <!-- Loading skeletons -->
      <div v-if="loading" class="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <div v-for="i in 8" :key="i" class="rounded-xl border border-stone-200 bg-white p-3 shadow-sm">
          <Skeleton cls="h-40 w-full" />
          <div class="space-y-2 p-1 pt-3">
            <Skeleton cls="h-4 w-2/3" />
            <Skeleton cls="h-3 w-full" />
            <Skeleton cls="h-3 w-5/6" />
            <Skeleton cls="h-9 w-full" />
          </div>
        </div>
      </div>

      <!-- Error state -->
      <div
        v-else-if="error"
        class="mx-auto max-w-md rounded-xl border border-red-200 bg-red-50 p-8 text-center"
        role="alert"
      >
        <p class="font-semibold text-red-800">Couldn't load the catalog</p>
        <p class="mt-1 text-sm text-red-700">{{ error }}</p>
        <button
          class="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-soft hover:bg-red-700"
          @click="fetchProducts"
        >
          Try again
        </button>
      </div>

      <!-- Empty state -->
      <div
        v-else-if="products.length === 0"
        class="mx-auto max-w-md rounded-xl border border-stone-200 bg-white p-10 text-center shadow-sm"
      >
        <SearchX class="mx-auto h-12 w-12 text-stone-300" aria-hidden="true" />
        <p class="mt-3 font-semibold text-stone-800">No products found</p>
        <p class="mt-1 text-sm text-stone-500">
          Try a different search term or category. Inactive products are hidden from the storefront.
        </p>
        <button
          class="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-soft hover:bg-indigo-700"
          @click="q = ''; pickCategory('')"
        >
          Clear filters
        </button>
      </div>

      <!-- Product grid -->
      <div v-else class="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <ProductCard v-for="p in products" :key="p.id" :product="p" />
      </div>
    </main>

    <CartDrawer :open="cartOpen" @close="cartOpen = false" />
  </div>
</template>
