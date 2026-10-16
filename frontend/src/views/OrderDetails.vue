<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  CloudOff,
  Loader2,
  Receipt,
  Save,
  User,
} from 'lucide-vue-next'
import AdminLayout from '../components/AdminLayout.vue'
import Skeleton from '../components/Skeleton.vue'
import StatusBadge from '../components/StatusBadge.vue'
import { apiError, ordersApi } from '../api/client.js'
import { toast } from '../stores/toast.js'
import { formatDateTime, formatMoney } from '../utils/format.js'

const props = defineProps({
  id: { type: [String, Number], required: true },
})

const router = useRouter()

const STATUSES = ['PENDING', 'PROCESSING', 'SHIPPED']

const order = ref(null)
const loading = ref(false)
const error = ref(null)
const draftStatus = ref('')
const saving = ref(false)

const dirty = computed(() => order.value && draftStatus.value !== order.value.status)

async function fetchOrder() {
  loading.value = true
  error.value = null
  order.value = null
  try {
    const { data } = await ordersApi.get(props.id)
    order.value = data
    draftStatus.value = data.status
  } catch (err) {
    error.value = apiError(err, `Could not load order #${props.id}`)
  } finally {
    loading.value = false
  }
}

async function saveStatus() {
  if (!dirty.value || saving.value) return
  saving.value = true
  try {
    const { data } = await ordersApi.updateStatus(props.id, draftStatus.value)
    order.value = { ...order.value, status: data.status, updated_at: data.updated_at }
    if (data.es_sync) {
      toast(
        data.es_sync.status === 'synced'
          ? `Status updated to ${data.status} — search index is in sync.`
          : `Status saved in PostgreSQL; search sync is ${data.es_sync.status.replace('_', ' ')}.`,
        data.es_sync.status === 'synced' ? 'success' : 'warning',
      )
    } else {
      toast(`Status updated to ${data.status}.`, 'success')
    }
  } catch (err) {
    toast(apiError(err, 'Could not update status'), 'error')
  } finally {
    saving.value = false
  }
}

/** Sync badge derived from GET /api/orders/{id}.sync */
const syncMeta = computed(() => {
  const sync = order.value?.sync
  if (!sync || sync.es_in_sync === null || sync.es_in_sync === undefined) {
    return { icon: CloudOff, label: 'ES unreachable', cls: 'bg-stone-100 text-stone-700 ring-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:ring-stone-700' }
  }
  if (sync.es_in_sync) {
    return { icon: CheckCircle2, label: 'In sync', cls: 'bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-900' }
  }
  return { icon: Clock, label: 'Pending sync', cls: 'bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900' }
})

const lineTotal = (item) => Number(item.unit_price || 0) * item.quantity

onMounted(fetchOrder)
watch(() => props.id, fetchOrder)
</script>

<template>
  <AdminLayout>
    <button
      class="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-stone-500 dark:text-stone-400 transition-soft hover:text-stone-900 dark:hover:text-stone-100"
      @click="router.push('/admin')"
    >
      <ArrowLeft class="h-4 w-4" aria-hidden="true" />
      Back to dashboard
    </button>

    <!-- Loading -->
    <div v-if="loading" class="space-y-4">
      <Skeleton cls="h-8 w-64" />
      <div class="grid gap-4 sm:grid-cols-2">
        <Skeleton cls="h-44 w-full" />
        <Skeleton cls="h-44 w-full" />
      </div>
      <Skeleton cls="h-64 w-full" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="mx-auto max-w-md rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/60 p-8 text-center" role="alert">
      <p class="font-semibold text-red-800 dark:text-red-200">Couldn't load this order</p>
      <p class="mt-1 text-sm text-red-700 dark:text-red-200">{{ error }}</p>
      <button
        class="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-soft hover:bg-indigo-700"
        @click="fetchOrder"
      >
        Retry
      </button>
    </div>

    <!-- Order -->
    <div v-else-if="order" class="space-y-6">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 class="text-xl font-bold text-stone-900 dark:text-stone-100 tabular-nums sm:text-2xl">Order #{{ order.order_id }}</h1>
          <p class="mt-1 text-sm text-stone-500 dark:text-stone-400">
            Placed {{ formatDateTime(order.order_date) }} · Last updated {{ formatDateTime(order.updated_at) }}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <StatusBadge :status="order.status" />
          <span
            class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset"
            :class="syncMeta.cls"
            :title="`PostgreSQL updated at ${formatDateTime(order.sync?.pg_updated_at)}${order.sync?.es_updated_at ? ` · Elasticsearch updated at ${formatDateTime(order.sync.es_updated_at)}` : ''}`"
          >
            <component :is="syncMeta.icon" class="h-3.5 w-3.5" aria-hidden="true" />
            {{ syncMeta.label }}
          </span>
        </div>
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <!-- Customer -->
        <section class="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5 shadow-sm">
          <h2 class="flex items-center gap-2 text-sm font-semibold text-stone-900 dark:text-stone-100">
            <User class="h-4 w-4 text-indigo-600" aria-hidden="true" />
            Customer
          </h2>
          <dl class="mt-3 space-y-2 text-sm">
            <div class="flex justify-between gap-4">
              <dt class="text-stone-500">Name</dt>
              <dd class="font-medium text-stone-900 dark:text-stone-100">{{ order.customer?.name }}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-stone-500">Email</dt>
              <dd class="font-medium text-stone-900 dark:text-stone-100">{{ order.customer?.email }}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-stone-500">Customer ID</dt>
              <dd class="text-stone-900 tabular-nums">{{ order.customer?.id ?? order.user_id }}</dd>
            </div>
          </dl>
        </section>

        <!-- Status update -->
        <section class="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5 shadow-sm">
          <h2 class="flex items-center gap-2 text-sm font-semibold text-stone-900 dark:text-stone-100">
            <Receipt class="h-4 w-4 text-indigo-600" aria-hidden="true" />
            Fulfillment status
          </h2>
          <p class="mt-1 text-xs text-stone-500 dark:text-stone-400">
            Saved to PostgreSQL first, then synced to Elasticsearch. Historical snapshots are never rewritten.
          </p>
          <div class="mt-4 flex flex-col gap-2 sm:flex-row">
            <select
              v-model="draftStatus"
              aria-label="Order status"
              class="w-full rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2.5 text-sm font-medium text-stone-900 dark:text-stone-100 transition-soft focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100 sm:max-w-56"
            >
              <option v-for="s in STATUSES" :key="s" :value="s">{{ s }}</option>
            </select>
            <button
              :disabled="!dirty || saving"
              class="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-soft hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              @click="saveStatus"
            >
              <Loader2 v-if="saving" class="h-4 w-4 animate-spin" aria-hidden="true" />
              <Save v-else class="h-4 w-4" aria-hidden="true" />
              {{ saving ? 'Saving…' : 'Save Status' }}
            </button>
          </div>
          <p v-if="!dirty && !saving" class="mt-2 text-xs text-stone-400 dark:text-stone-500">No pending changes.</p>
        </section>
      </div>

      <!-- Receipt -->
      <section class="overflow-hidden rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 shadow-sm">
        <h2 class="border-b border-stone-200 dark:border-stone-800 px-5 py-4 text-sm font-semibold text-stone-900 dark:text-stone-100">
          Receipt — canonical data from PostgreSQL
        </h2>
        <div class="overflow-x-auto">
          <table class="w-full min-w-150 text-sm">
            <thead>
              <tr class="text-left text-xs font-medium tracking-wide text-stone-500 dark:text-stone-400 uppercase">
                <th class="px-5 py-3">Product (checkout-time snapshot)</th>
                <th class="px-5 py-3 text-center">Qty</th>
                <th class="px-5 py-3 text-right">Unit price</th>
                <th class="px-5 py-3 text-right">Line total</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-stone-100 dark:divide-stone-800">
              <tr v-for="item in order.items ?? []" :key="item.product_id + '-' + item.title">
                <td class="px-5 py-3.5">
                  <p class="font-medium text-stone-900 dark:text-stone-100">{{ item.title }}</p>
                  <p class="text-xs text-stone-400 dark:text-stone-500 tabular-nums">{{ item.product_id }}</p>
                </td>
                <td class="px-5 py-3.5 text-center tabular-nums">{{ item.quantity }}</td>
                <td class="px-5 py-3.5 text-right text-stone-600 dark:text-stone-300 tabular-nums">{{ formatMoney(item.unit_price) }}</td>
                <td class="px-5 py-3.5 text-right font-semibold text-stone-900 dark:text-stone-100 tabular-nums">
                  {{ formatMoney(lineTotal(item)) }}
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr class="border-t-2 border-stone-200 dark:border-stone-800">
                <td colspan="3" class="px-5 py-4 text-sm font-semibold text-stone-900 dark:text-stone-100">Order total</td>
                <td class="px-5 py-4 text-right text-lg font-bold text-stone-900 dark:text-stone-100 tabular-nums">
                  {{ formatMoney(order.total_amount) }}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  </AdminLayout>
</template>
