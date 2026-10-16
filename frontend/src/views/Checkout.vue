<script setup>
import { computed, ref } from 'vue'
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Lock,
  Package,
  ShieldCheck,
  ShoppingCart,
  User,
} from 'lucide-vue-next'
import { apiError, ordersApi } from '../api/client.js'
import { cart, cartSubtotal, clearCart } from '../stores/cart.js'
import { selectedUser } from '../stores/user.js'
import { toast } from '../stores/toast.js'
import { formatMoney } from '../utils/format.js'

const placing = ref(false)
const placed = ref(null) // created order payload
const placeError = ref(null)

const isEmpty = computed(() => cart.lines.length === 0)

function lineTotal(line) {
  return Number(line.price || 0) * line.qty
}

async function placeOrder() {
  if (placing.value || isEmpty.value) return
  if (!selectedUser.value) {
    toast('Pick a demo user on the storefront first.', 'warning')
    return
  }
  placing.value = true
  placeError.value = null
  // Fresh idempotency key per submission; the button is disabled while
  // the request is in flight so double-clicks can't create duplicates.
  const idempotencyKey =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  try {
    const { data } = await ordersApi.create({
      user_id: selectedUser.value.id,
      items: cart.lines.map((l) => ({ product_id: l.product_id, quantity: l.qty })),
      idempotency_key: idempotencyKey,
    })
    placed.value = data
    clearCart()
    toast(`Order #${data.order_id} placed successfully.`, 'success')
  } catch (err) {
    placeError.value = apiError(err, 'Checkout failed')
    toast(placeError.value, 'error')
  } finally {
    placing.value = false
  }
}

function startNewOrder() {
  placed.value = null
  placeError.value = null
}
</script>

<template>
  <div class="min-h-screen bg-stone-50">
    <header class="border-b border-stone-200 bg-white">
      <div class="mx-auto flex max-w-5xl items-center gap-3 px-4 py-4 sm:px-6">
        <router-link to="/" class="flex items-center gap-2.5">
          <div class="rounded-lg bg-indigo-600 p-2">
            <Package class="h-5 w-5 text-white" aria-hidden="true" />
          </div>
          <p class="text-sm font-bold text-stone-900">Polyglot Commerce</p>
        </router-link>
        <span class="text-sm text-stone-400">/</span>
        <p class="text-sm font-medium text-stone-600">Checkout</p>
      </div>
    </header>

    <main class="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:py-8">
      <!-- Success state -->
      <div v-if="placed" class="mx-auto max-w-2xl">
        <div class="rounded-xl border border-emerald-200 bg-white p-8 text-center shadow-sm sm:p-10">
          <CheckCircle2 class="mx-auto h-14 w-14 text-emerald-500" aria-hidden="true" />
          <h1 class="mt-4 text-xl font-bold text-stone-900">Order confirmed</h1>
          <p class="mt-2 text-sm text-stone-600">
            Your order was saved transactionally in PostgreSQL and queued for search indexing.
          </p>
          <div class="mx-auto mt-6 max-w-sm rounded-xl bg-stone-50 p-5">
            <p class="text-xs font-medium tracking-wide text-stone-500 uppercase">Order ID</p>
            <p class="mt-1 text-3xl font-bold text-stone-900 tabular-nums">#{{ placed.order_id }}</p>
            <p class="mt-2 text-sm text-stone-600">
              Total <strong class="tabular-nums">{{ formatMoney(placed.total_amount) }}</strong>
              · Status <strong>{{ placed.status }}</strong>
            </p>
          </div>
          <div class="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            <router-link
              :to="`/admin/orders/${placed.order_id}`"
              class="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-soft hover:bg-indigo-700"
            >
              <ShieldCheck class="h-4 w-4" aria-hidden="true" />
              View in Admin
            </router-link>
            <router-link
              to="/"
              class="inline-flex items-center justify-center gap-2 rounded-lg border border-stone-200 px-4 py-2.5 text-sm font-semibold text-stone-700 transition-soft hover:bg-stone-50"
              @click="startNewOrder"
            >
              Continue shopping
            </router-link>
          </div>
        </div>
      </div>

      <!-- Empty cart -->
      <div v-else-if="isEmpty" class="mx-auto max-w-md rounded-xl border border-stone-200 bg-white p-10 text-center shadow-sm">
        <ShoppingCart class="mx-auto h-12 w-12 text-stone-300" aria-hidden="true" />
        <p class="mt-3 font-semibold text-stone-800">Your cart is empty</p>
        <p class="mt-1 text-sm text-stone-500">Add some products from the storefront before checking out.</p>
        <router-link
          to="/"
          class="mt-4 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-soft hover:bg-indigo-700"
        >
          <ArrowLeft class="h-4 w-4" aria-hidden="true" />
          Back to storefront
        </router-link>
      </div>

      <!-- Checkout form -->
      <div v-else class="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section class="rounded-xl border border-stone-200 bg-white shadow-sm">
          <h1 class="border-b border-stone-200 px-5 py-4 text-base font-semibold text-stone-900">Order summary</h1>
          <div class="overflow-x-auto">
            <table class="w-full min-w-130 text-sm">
              <thead>
                <tr class="text-left text-xs font-medium tracking-wide text-stone-500 uppercase">
                  <th class="px-5 py-3">Product</th>
                  <th class="px-5 py-3 text-center">Qty</th>
                  <th class="px-5 py-3 text-right">Unit price</th>
                  <th class="px-5 py-3 text-right">Line total</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-stone-100">
                <tr v-for="line in cart.lines" :key="line.product_id">
                  <td class="px-5 py-3.5 font-medium text-stone-900">{{ line.title }}</td>
                  <td class="px-5 py-3.5 text-center tabular-nums">{{ line.qty }}</td>
                  <td class="px-5 py-3.5 text-right text-stone-600 tabular-nums">{{ formatMoney(line.price) }}</td>
                  <td class="px-5 py-3.5 text-right font-semibold text-stone-900 tabular-nums">
                    {{ formatMoney(lineTotal(line)) }}
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr class="border-t-2 border-stone-200">
                  <td colspan="3" class="px-5 py-4 text-sm font-semibold text-stone-900">Total</td>
                  <td class="px-5 py-4 text-right text-lg font-bold text-stone-900 tabular-nums">
                    {{ formatMoney(cartSubtotal) }}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p class="flex items-center gap-1.5 border-t border-stone-100 px-5 py-3 text-xs text-stone-500">
            <Lock class="h-3.5 w-3.5" aria-hidden="true" />
            Prices are re-validated against the live MongoDB catalog on the server — client totals are never trusted.
          </p>
        </section>

        <aside class="space-y-4">
          <section class="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 class="flex items-center gap-2 text-sm font-semibold text-stone-900">
              <User class="h-4 w-4 text-indigo-600" aria-hidden="true" />
              Customer
            </h2>
            <div v-if="selectedUser" class="mt-3">
              <p class="text-sm font-semibold text-stone-900">{{ selectedUser.name }}</p>
              <p class="text-sm text-stone-500">{{ selectedUser.email }}</p>
              <router-link to="/" class="mt-2 inline-block text-xs font-medium text-indigo-600 hover:text-indigo-700">
                Change demo user
              </router-link>
            </div>
            <p v-else class="mt-3 text-sm text-amber-700">
              No demo user selected. Go back to the storefront and pick one from the “Log In As” dropdown.
            </p>
          </section>

          <section class="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
            <button
              :disabled="placing || !selectedUser"
              class="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition-soft hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              @click="placeOrder"
            >
              <Loader2 v-if="placing" class="h-4 w-4 animate-spin" aria-hidden="true" />
              {{ placing ? 'Placing order…' : 'Place Order' }}
            </button>
            <p v-if="placeError" class="mt-3 text-sm text-red-600" role="alert">{{ placeError }}</p>
            <p class="mt-3 text-xs leading-relaxed text-stone-500">
              The order and its items are written in a single PostgreSQL transaction, then synced to
              Elasticsearch. If search indexing is temporarily down, your order is still safe.
            </p>
          </section>
        </aside>
      </div>
    </main>
  </div>
</template>
