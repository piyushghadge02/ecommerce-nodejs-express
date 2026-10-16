<script setup>
import { ref } from 'vue'
import { Minus, Plus, ShoppingCart } from 'lucide-vue-next'
import ProductThumb from './ProductThumb.vue'
import { formatMoney } from '../utils/format.js'
import { toast } from '../stores/toast.js'
import { addToCart } from '../stores/cart.js'

const props = defineProps({
  product: { type: Object, required: true },
})

const emit = defineEmits(['added'])

const qty = ref(1)

function step(delta) {
  qty.value = Math.min(99, Math.max(1, qty.value + delta))
}

function onAdd() {
  addToCart(props.product, qty.value)
  toast(`Added ${qty.value} × ${props.product.title} to cart`, 'success')
  qty.value = 1
  emit('added')
}

const categoryLabel = (c) => (c ? c.charAt(0).toUpperCase() + c.slice(1) : '—')
</script>

<template>
  <article
    class="flex flex-col overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm transition-soft hover:-translate-y-0.5 hover:shadow-md dark:border-stone-800 dark:bg-stone-900"
  >
    <ProductThumb
      :category="product.category"
      :title="product.title"
      :sku="product.sku"
      :image="product.image"
      size="lg"
      class="m-3 mb-0"
    />

    <div class="flex flex-1 flex-col gap-2 p-4">
      <div class="flex items-center justify-between gap-2">
        <span
          class="inline-flex items-center rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-600 dark:bg-stone-800 dark:text-stone-300"
        >
          {{ categoryLabel(product.category) }}
        </span>
        <span v-if="product.sku" class="text-[11px] text-stone-400 tabular-nums dark:text-stone-500">{{ product.sku }}</span>
      </div>

      <h3 class="text-sm font-semibold text-stone-900 line-clamp-1 dark:text-stone-100" :title="product.title">
        {{ product.title }}
      </h3>
      <p class="text-xs text-stone-500 line-clamp-2 dark:text-stone-400">{{ product.description }}</p>

      <div v-if="product.tags?.length" class="flex flex-wrap gap-1">
        <span
          v-for="tag in product.tags.slice(0, 4)"
          :key="tag"
          class="rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
        >
          {{ tag }}
        </span>
      </div>

      <div class="mt-auto flex items-end justify-between gap-2 pt-2">
        <p class="text-lg font-bold text-stone-900 tabular-nums dark:text-stone-100">{{ formatMoney(product.price) }}</p>
      </div>

      <div class="flex items-center gap-2">
        <div class="flex items-center rounded-lg border border-stone-200 dark:border-stone-700">
          <button
            class="px-2 py-1.5 text-stone-500 transition-soft hover:text-stone-900 disabled:opacity-40 dark:text-stone-400 dark:hover:text-stone-100"
            :disabled="qty <= 1"
            aria-label="Decrease quantity"
            @click="step(-1)"
          >
            <Minus class="h-4 w-4" />
          </button>
          <span class="w-8 text-center text-sm font-semibold tabular-nums" aria-live="polite">{{ qty }}</span>
          <button
            class="px-2 py-1.5 text-stone-500 transition-soft hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
            aria-label="Increase quantity"
            @click="step(1)"
          >
            <Plus class="h-4 w-4" />
          </button>
        </div>
        <button
          class="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition-soft hover:bg-indigo-700 active:scale-[0.98]"
          @click="onAdd"
        >
          <ShoppingCart class="h-4 w-4" aria-hidden="true" />
          Add to Cart
        </button>
      </div>
    </div>
  </article>
</template>
