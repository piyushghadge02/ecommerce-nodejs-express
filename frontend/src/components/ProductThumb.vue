<script setup>
import { computed, ref, watch } from 'vue'
import { Cable, Headphones, Keyboard, LampDesk, Package } from 'lucide-vue-next'
import { productImage } from '../utils/productImages.js'

/**
 * Product photo with graceful fallback: shows the resolved product
 * photograph (API `image` field or the seeded SKU map) and falls back
 * to the soft-tinted category icon tile while loading or if the photo
 * fails (offline / broken URL) — so the catalog never shows a broken
 * image.
 */
const props = defineProps({
  category: { type: String, default: '' },
  title: { type: String, default: '' },
  size: { type: String, default: 'md' }, // sm | md | lg
  sku: { type: String, default: '' },
  image: { type: String, default: '' },
})

const src = computed(() =>
  props.image?.trim() ? props.image.trim() : productImage({ sku: props.sku }),
)
const failed = ref(false)
const loaded = ref(false)
watch(src, () => {
  failed.value = false
  loaded.value = false
})

const meta = computed(() => {
  switch ((props.category || '').toLowerCase()) {
    case 'peripherals':
      return { icon: Keyboard, tint: 'bg-indigo-50 text-indigo-500 dark:bg-indigo-950 dark:text-indigo-400' }
    case 'audio':
      return { icon: Headphones, tint: 'bg-violet-50 text-violet-500 dark:bg-violet-950 dark:text-violet-400' }
    case 'cables':
      return { icon: Cable, tint: 'bg-sky-50 text-sky-500 dark:bg-sky-950 dark:text-sky-400' }
    case 'office':
      return { icon: LampDesk, tint: 'bg-amber-50 text-amber-500 dark:bg-amber-950 dark:text-amber-400' }
    default:
      return { icon: Package, tint: 'bg-stone-100 text-stone-400 dark:bg-stone-800 dark:text-stone-500' }
  }
})

const sizes = {
  sm: 'h-12 w-12 rounded-lg',
  md: 'h-24 w-full rounded-xl',
  lg: 'h-40 w-full rounded-xl',
}
const iconSizes = { sm: 'h-5 w-5', md: 'h-10 w-10', lg: 'h-14 w-14' }
</script>

<template>
  <div
    class="relative flex items-center justify-center overflow-hidden bg-stone-100 dark:bg-stone-800"
    :class="[sizes[size] ?? sizes.md]"
    role="img"
    :aria-label="title || 'Product image'"
    :title="title"
  >
    <img
      v-if="src && !failed"
      :src="src"
      :alt="title || 'Product photo'"
      loading="lazy"
      referrerpolicy="no-referrer"
      class="absolute inset-0 h-full w-full object-cover transition-opacity duration-300"
      :class="loaded ? 'opacity-100' : 'opacity-0'"
      @load="loaded = true"
      @error="failed = true"
    />
    <div
      v-show="!src || failed || !loaded"
      class="flex h-full w-full items-center justify-center"
      :class="meta.tint"
    >
      <component :is="meta.icon" :class="iconSizes[size] ?? iconSizes.md" aria-hidden="true" />
    </div>
  </div>
</template>
