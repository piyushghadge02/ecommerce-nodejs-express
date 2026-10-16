<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import {
  ArrowDownWideNarrow,
  Clock,
  Hourglass,
  PackageCheck,
  Receipt,
  RotateCcw,
  Search,
  SearchX,
  SlidersHorizontal,
  Wallet,
} from 'lucide-vue-next'
import AdminLayout from '../components/AdminLayout.vue'
import KpiCard from '../components/KpiCard.vue'
import Pagination from '../components/Pagination.vue'
import Skeleton from '../components/Skeleton.vue'
import StatusBadge from '../components/StatusBadge.vue'
import { apiError, searchApi } from '../api/client.js'
import { toast } from '../stores/toast.js'
import { formatDateTime, formatMoney } from '../utils/format.js'

const STATUSES = ['PENDING', 'PROCESSING', 'SHIPPED']

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first', sort_by: 'order_date', sort_dir: 'desc' },
  { value: 'oldest', label: 'Oldest first', sort_by: 'order_date', sort_dir: 'asc' },
  { value: 'total_desc', label: 'Total: high to low', sort_by: 'total_amount', sort_dir: 'desc' },
  { value: 'total_asc', label: 'Total: low to high', sort_by: 'total_amount', sort_dir: 'asc' },
  { value: 'id_desc', label: 'Order ID: high to low', sort_by: 'order_id', sort_dir: 'desc' },
  { value: 'id_asc', label: 'Order ID: low to high', sort_by: 'order_id', sort_dir: 'asc' },
]

const filters = reactive({
  q: '',
  statuses: [...STATUSES],
  date_from: '',
  date_to: '',
  min_total: '',
  max_total: '',
  sort: 'newest',
  page: 1,
  page_size: 20,
})

const showFilters = ref(false)
const loading = ref(false)
const error = ref(null)
const result = ref(null)

let qTimer = null

function buildBody() {
  const sort = SORT_OPTIONS.find((s) => s.value === filters.sort) ?? SORT_OPTIONS[0]
  const body = {
    page: filters.page,
    page_size: filters.page_size,
    sort_by: sort.sort_by,
    sort_dir: sort.sort_dir,
  }
  if (filters.q.trim()) body.q = filters.q.trim()
  if (filters.statuses.length > 0 && filters.statuses.length < STATUSES.length) {
    body.statuses = [...filters.statuses]
  }
  if (filters.date_from) body.date_from = filters.date_from
  if (filters.date_to) body.date_to = filters.date_to
  const min = Number(filters.min_total)
  if (filters.min_total !== '' && Number.isFinite(min)) body.min_total = min
  const max = Number(filters.max_total)
  if (filters.max_total !== '' && Number.isFinite(max)) body.max_total = max
  return body
}

async function runSearch() {
  loading.value = true
  error.value = null
  try {
    const { data } = await searchApi.orders(buildBody())
    result.value = data
  } catch (err) {
    error.value = apiError(err, 'Search failed')
    toast(error.value, 'error')
  } finally {
    loading.value = false
  }
}

function resetFilters() {
  filters.q = ''
  filters.statuses = [...STATUSES]
  filters.date_from = ''
  filters.date_to = ''
  filters.min_total = ''
  filters.max_total = ''
  filters.sort = 'newest'
  filters.page = 1
  // q is not watched (debounced) — always re-run so "Clear filters"
  // recovers from a q-only empty state instead of staying stale.
  runSearch()
}

function onQInput() {
  clearTimeout(qTimer)
  qTimer = setTimeout(() => {
    filters.page = 1
    runSearch()
  }, 450)
}

// Re-run on any non-q filter change; q is debounced above.
watch(
  () => [filters.statuses, filters.date_from, filters.date_to, filters.min_total, filters.max_total, filters.sort],
  () => {
    filters.page = 1
    runSearch()
  },
  { deep: true },
)

const orders = computed(() => result.value?.orders ?? [])
const totalPages = computed(() => result.value?.total_pages ?? 0)
const total = computed(() => result.value?.total ?? 0)
const aggs = computed(() => result.value?.aggs ?? { revenue: 0, by_status: {}, total_orders: 0 })
const statusCount = (s) => aggs.value.by_status?.[s] ?? 0

const hasActiveFilters = computed(
  () =>
    filters.q.trim() !== '' ||
    filters.statuses.length < STATUSES.length ||
    filters.date_from !== '' ||
    filters.date_to !== '' ||
    filters.min_total !== '' ||
    filters.max_total !== '',
)

function toggleStatus(s) {
  const i = filters.statuses.indexOf(s)
  if (i >= 0) filters.statuses.splice(i, 1)
  else filters.statuses.push(s)
}

function onPage(p) {
  filters.page = p
  runSearch()
}

onMounted(runSearch)
</script>

<template>
  <AdminLayout>
    <!-- Page header -->
    <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-bold text-stone-900 dark:text-stone-100 sm:text-2xl">Order Search Dashboard</h1>
        <p class="mt-1 text-sm text-stone-500 dark:text-stone-400">
          Search and analytics powered by <strong class="font-semibold">Elasticsearch</strong> — full-text
          over customer names, emails, and item titles.
        </p>
      </div>
      <button
        class="inline-flex items-center gap-2 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-3.5 py-2 text-sm font-medium text-stone-700 dark:text-stone-300 shadow-sm transition-soft hover:bg-stone-50 dark:hover:bg-stone-800 lg:hidden"
        @click="showFilters = !showFilters"
      >
        <SlidersHorizontal class="h-4 w-4" aria-hidden="true" />
        Filters
      </button>
    </div>

    <!-- KPI cards (from ES aggregations over the current filter set) -->
    <div class="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5">
      <KpiCard title="Revenue" :value="formatMoney(aggs.revenue)" :icon="Wallet" accent="bg-indigo-100 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400" sub="Filtered result set" />
      <KpiCard title="Total orders" :value="aggs.total_orders ?? total" :icon="Receipt" accent="bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300" sub="Matching orders" />
      <KpiCard title="Pending" :value="statusCount('PENDING')" :icon="Hourglass" accent="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" />
      <KpiCard title="Processing" :value="statusCount('PROCESSING')" :icon="Clock" accent="bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" />
      <KpiCard title="Shipped" :value="statusCount('SHIPPED')" :icon="PackageCheck" accent="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" />
    </div>

    <div class="flex flex-col gap-6 lg:flex-row">
      <!-- Filter panel -->
      <aside
        :class="['lg:block lg:w-64 lg:shrink-0', showFilters ? 'block' : 'hidden']"
        aria-label="Search filters"
      >
        <div class="space-y-5 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5 shadow-sm lg:sticky lg:top-6">
          <div class="flex items-center justify-between">
            <h2 class="flex items-center gap-2 text-sm font-semibold text-stone-900 dark:text-stone-100">
              <SlidersHorizontal class="h-4 w-4 text-stone-500 dark:text-stone-400" aria-hidden="true" />
              Filters
            </h2>
            <button
              v-if="hasActiveFilters"
              class="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-400"
              @click="resetFilters"
            >
              <RotateCcw class="h-3.5 w-3.5" aria-hidden="true" />
              Reset
            </button>
          </div>

          <fieldset>
            <legend class="mb-2 text-xs font-semibold tracking-wide text-stone-500 dark:text-stone-400 uppercase">Status</legend>
            <div class="space-y-2">
              <label v-for="s in STATUSES" :key="s" class="flex cursor-pointer items-center gap-2.5 text-sm text-stone-700 dark:text-stone-300">
                <input
                  type="checkbox"
                  :checked="filters.statuses.includes(s)"
                  class="h-4 w-4 rounded border-stone-300 dark:border-stone-700 accent-indigo-600"
                  @change="toggleStatus(s)"
                />
                <StatusBadge :status="s" />
              </label>
            </div>
          </fieldset>

          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="mb-1 block text-xs font-semibold tracking-wide text-stone-500 dark:text-stone-400 uppercase" for="f-date-from">
                Date from
              </label>
              <input
                id="f-date-from"
                v-model="filters.date_from"
                type="date"
                class="w-full rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-2.5 py-2 text-sm text-stone-900 dark:text-stone-100 transition-soft focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs font-semibold tracking-wide text-stone-500 dark:text-stone-400 uppercase" for="f-date-to">
                Date to
              </label>
              <input
                id="f-date-to"
                v-model="filters.date_to"
                type="date"
                class="w-full rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-2.5 py-2 text-sm text-stone-900 dark:text-stone-100 transition-soft focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="mb-1 block text-xs font-semibold tracking-wide text-stone-500 dark:text-stone-400 uppercase" for="f-min-total">
                Min total
              </label>
              <input
                id="f-min-total"
                v-model="filters.min_total"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                class="w-full rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-2.5 py-2 text-sm text-stone-900 dark:text-stone-100 tabular-nums transition-soft focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs font-semibold tracking-wide text-stone-500 dark:text-stone-400 uppercase" for="f-max-total">
                Max total
              </label>
              <input
                id="f-max-total"
                v-model="filters.max_total"
                type="number"
                min="0"
                step="0.01"
                placeholder="∞"
                class="w-full rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-2.5 py-2 text-sm text-stone-900 dark:text-stone-100 tabular-nums transition-soft focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
            </div>
          </div>

          <div>
            <label class="mb-1 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-stone-500 dark:text-stone-400 uppercase" for="f-sort">
              <ArrowDownWideNarrow class="h-3.5 w-3.5" aria-hidden="true" />
              Sort
            </label>
            <select
              id="f-sort"
              v-model="filters.sort"
              class="w-full rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-2.5 py-2 text-sm text-stone-900 dark:text-stone-100 transition-soft focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            >
              <option v-for="o in SORT_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </div>
        </div>
      </aside>

      <!-- Results -->
      <section class="min-w-0 flex-1">
        <div class="relative mb-4">
          <Search class="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-stone-400 dark:text-stone-500" aria-hidden="true" />
          <input
            v-model="filters.q"
            type="search"
            placeholder='Search orders — try "wireless" to match products and customers…'
            aria-label="Search orders"
            class="w-full rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 py-3 pr-4 pl-10 text-sm text-stone-900 dark:text-stone-100 shadow-sm placeholder-stone-400 dark:placeholder-stone-500 transition-soft focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            @input="onQInput"
            @keydown.enter.prevent="() => { filters.page = 1; runSearch() }"
          />
        </div>

        <div class="overflow-hidden rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 shadow-sm">
          <!-- Loading -->
          <div v-if="loading" class="space-y-3 p-5" aria-label="Loading results">
            <Skeleton cls="h-10 w-full" />
            <Skeleton cls="h-10 w-full" />
            <Skeleton cls="h-10 w-full" />
            <Skeleton cls="h-10 w-full" />
            <Skeleton cls="h-10 w-full" />
          </div>

          <!-- Error -->
          <div v-else-if="error" class="p-8 text-center" role="alert">
            <p class="font-semibold text-red-700 dark:text-red-200">Search failed</p>
            <p class="mt-1 text-sm text-red-600 dark:text-red-400">{{ error }}</p>
            <button
              class="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-soft hover:bg-indigo-700"
              @click="runSearch"
            >
              Retry
            </button>
          </div>

          <!-- Empty -->
          <div v-else-if="orders.length === 0" class="p-10 text-center">
            <SearchX class="mx-auto h-12 w-12 text-stone-300 dark:text-stone-600" aria-hidden="true" />
            <p class="mt-3 font-semibold text-stone-800">No orders match your search</p>
            <p class="mt-1 text-sm text-stone-500 dark:text-stone-400">Try a different term, or widen the filters.</p>
            <button
              v-if="hasActiveFilters"
              class="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-soft hover:bg-indigo-700"
              @click="resetFilters"
            >
              Clear filters
            </button>
          </div>

          <!-- Table -->
          <div v-else class="overflow-x-auto">
            <table class="w-full min-w-180 text-sm">
              <thead>
                <tr class="border-b border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-800 text-left text-xs font-semibold tracking-wide text-stone-500 dark:text-stone-400 uppercase">
                  <th class="px-5 py-3">Order</th>
                  <th class="px-5 py-3">Date</th>
                  <th class="px-5 py-3">Customer</th>
                  <th class="px-5 py-3 text-right">Total</th>
                  <th class="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-stone-100 dark:divide-stone-800">
                <tr v-for="o in orders" :key="o.order_id" class="transition-soft hover:bg-stone-50 dark:hover:bg-stone-800">
                  <td class="px-5 py-3.5">
                    <router-link
                      :to="`/admin/orders/${o.order_id}`"
                      class="font-semibold text-indigo-600 dark:text-indigo-400 tabular-nums hover:text-indigo-700 dark:hover:text-indigo-400 hover:underline"
                    >
                      #{{ o.order_id }}
                    </router-link>
                  </td>
                  <td class="px-5 py-3.5 whitespace-nowrap text-stone-600 dark:text-stone-300">{{ formatDateTime(o.order_date) }}</td>
                  <td class="px-5 py-3.5">
                    <p class="font-medium text-stone-900 dark:text-stone-100">{{ o.customer?.name }}</p>
                    <p class="text-xs text-stone-500 dark:text-stone-400">{{ o.customer?.email }}</p>
                  </td>
                  <td class="px-5 py-3.5 text-right font-semibold text-stone-900 dark:text-stone-100 tabular-nums">
                    {{ formatMoney(o.total_amount) }}
                  </td>
                  <td class="px-5 py-3.5"><StatusBadge :status="o.status" /></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-if="!loading && !error && orders.length > 0" class="border-t border-stone-200 dark:border-stone-800 px-5 py-4">
            <Pagination
              :page="filters.page"
              :total-pages="totalPages"
              :total="total"
              :page-size="filters.page_size"
              @update:page="onPage"
            />
          </div>
        </div>

        <p class="mt-3 text-xs text-stone-400 dark:text-stone-500">
          Hits, filters, and all KPI aggregations above come from the Elasticsearch
          <code class="rounded bg-stone-100 px-1">orders</code> index — PostgreSQL and MongoDB are never
          queried on this screen.
        </p>
      </section>
    </div>
  </AdminLayout>
</template>
