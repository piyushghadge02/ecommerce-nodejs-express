<script setup>
import { computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowRight, Minus, Plus, ShoppingCart, Trash2, X } from 'lucide-vue-next'
import { cart, cartCount, cartSubtotal, removeLine, setLineQty } from '../stores/cart.js'
import { formatMoney } from '../utils/format.js'

const props = defineProps({
  open: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])

const router = useRouter()

const isEmpty = computed(() => cart.lines.length === 0)

function close() {
  emit('close')
}

function goCheckout() {
  close()
  router.push('/checkout')
}

// Lock body scroll while the drawer is open
watch(
  () => props.open,
  (open) => {
    document.body.style.overflow = open ? 'hidden' : ''
  },
  { immediate: true },
)
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Shopping cart">
    <div class="absolute inset-0 bg-stone-900/40" @click="close"></div>

    <aside
      class="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-2xl dark:bg-stone-900"
      @keydown.esc="close"
    >
      <header class="flex items-center justify-between border-b border-stone-200 px-5 py-4 dark:border-stone-800">
        <h2 class="flex items-center gap-2 text-base font-semibold text-stone-900 dark:text-stone-100">
          <ShoppingCart class="h-5 w-5 text-indigo-600" aria-hidden="true" />
          Your Cart
          <span class="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-700 tabular-nums">
            {{ cartCount }}
          </span>
        </h2>
        <button
          class="rounded-lg p-1.5 text-stone-500 transition-soft hover:bg-stone-100 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"
          aria-label="Close cart"
          @click="close"
        >
          <X class="h-5 w-5" />
        </button>
      </header>

      <div v-if="isEmpty" class="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <ShoppingCart class="h-12 w-12 text-stone-300 dark:text-stone-600" aria-hidden="true" />
        <p class="font-medium text-stone-700 dark:text-stone-200">Your cart is empty</p>
        <p class="text-sm text-stone-500 dark:text-stone-400">Browse the catalog and add products to get started.</p>
        <button
          class="mt-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-soft hover:bg-indigo-700"
          @click="close"
        >
          Continue shopping
        </button>
      </div>

      <template v-else>
        <ul class="nice-scroll flex-1 divide-y divide-stone-100 overflow-y-auto px-5 dark:divide-stone-800">
          <li v-for="line in cart.lines" :key="line.product_id" class="flex gap-3 py-4">
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-semibold text-stone-900 dark:text-stone-100" :title="line.title">{{ line.title }}</p>
              <p class="mt-0.5 text-sm text-stone-500 tabular-nums dark:text-stone-400">{{ formatMoney(line.price) }} each</p>
              <div class="mt-2 flex items-center gap-2">
                <div class="flex items-center rounded-lg border border-stone-200 dark:border-stone-700">
                  <button
                    class="px-2 py-1 text-stone-500 transition-soft hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
                    aria-label="Decrease quantity"
                    @click="setLineQty(line.product_id, line.qty - 1)"
                  >
                    <Minus class="h-3.5 w-3.5" />
                  </button>
                  <span class="w-8 text-center text-sm font-semibold tabular-nums">{{ line.qty }}</span>
                  <button
                    class="px-2 py-1 text-stone-500 transition-soft hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
                    aria-label="Increase quantity"
                    @click="setLineQty(line.product_id, line.qty + 1)"
                  >
                    <Plus class="h-3.5 w-3.5" />
                  </button>
                </div>
                <button
                  class="rounded-lg p-1.5 text-stone-400 transition-soft hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
                  aria-label="Remove item"
                  @click="removeLine(line.product_id)"
                >
                  <Trash2 class="h-4 w-4" />
                </button>
              </div>
            </div>
            <p class="text-sm font-bold text-stone-900 tabular-nums dark:text-stone-100">
              {{ formatMoney(Number(line.price) * line.qty) }}
            </p>
          </li>
        </ul>

        <footer class="border-t border-stone-200 px-5 py-4 dark:border-stone-800">
          <div class="flex items-center justify-between text-sm">
            <span class="text-stone-500 dark:text-stone-400">Subtotal</span>
            <span class="text-lg font-bold text-stone-900 tabular-nums dark:text-stone-100">{{ formatMoney(cartSubtotal) }}</span>
          </div>
          <p class="mt-1 text-xs text-stone-400 dark:text-stone-500">Final total is calculated securely on the server at checkout.</p>
          <button
            class="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-soft hover:bg-indigo-700"
            @click="goCheckout"
          >
            Proceed to Checkout
            <ArrowRight class="h-4 w-4" aria-hidden="true" />
          </button>
        </footer>
      </template>
    </aside>
  </div>
</template>
